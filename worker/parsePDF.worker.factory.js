module.exports = function (thisFileName) {
    const { Worker, MessageChannel, isMainThread } = require('worker_threads');

    if (isMainThread) {
        const { log } = require('../utils/log.js');
        const EventCenter = require('./EventCenter.js');

        // 用独立 MessageChannel 通信：Worker 自带的内部端口无法单独 unref，
        // 空闲线程会阻止进程退出；自有 port 空闲时 unref、任务在途时 ref
        const { port1, port2 } = new MessageChannel();

        const worker = new Worker(thisFileName, {
            workerData: { port: port2 },
            transferList: [port2],
        });

        worker.unref();

        // 当前挂起任务的 reject；worker 崩溃/退出时用于释放调用方
        let pendingReject = null;
        let deadCallback = null;
        let currentProgressHandler = null;

        worker.on('error', (error) => {
            log('parsePDF.worker error:', error && (error.stack || error.message));

            port1.unref();

            if (pendingReject) {
                pendingReject(error instanceof Error ? error : new Error(String(error)));
                pendingReject = null;
            }
        });

        worker.on('exit', (code) => {
            port1.unref();

            if (pendingReject) {
                pendingReject(new Error(`parsePDF.worker 意外退出，exit code: ${code}`));
                pendingReject = null;
            }

            if (typeof deadCallback === 'function') {
                deadCallback();
            }
        });

        const eventCetner = new EventCenter(port1);

        // 注意：EventCenter 构造中注册 on('message') 会使 port 重新 ref，
        // 空闲 unref 必须放在构造之后才生效
        port1.unref();

        // 任务调用骨架：事件名即任务名（worker 侧按事件名路由到各自的处理函数），
        // 结果按同名事件回传配对。同一 port 同时只允许一个在途任务
        // （池 maxConcurrent=1 保证），once 配对依赖此前提
        const callTask = (event, payload) =>
            new Promise((resolve, reject) => {
                pendingReject = reject;

                // 解析在途时保持 ref，防止进程在无其他句柄时提前退出
                port1.ref();

                eventCetner.post(event, payload);

                eventCetner.once(event, (res) => {
                    pendingReject = null;

                    port1.unref();

                    if (res && res.__error) {
                        reject(new Error(res.message));
                        return;
                    }

                    resolve(res);
                });
            });

        return {
            // 分片解析：只解析页码满足 (pageNumber-1)%shards===shard 的页；
            // 单文件冷解析由主线程编排多分片并行（见 utils/parsePipeline.js）
            parseShard(task) {
                return callTask('parseShard', task);
            },
            // 实体提取：输入为全文档句块文本。为何是独立任务（而非随分片
            // 一遍执行完）见 utils/parsePipeline.js——需要合并后的全量文本
            extractEntities(texts) {
                return callTask('extractEntities', texts);
            },
            // worker中的CacheFile的全局变量和主进程中的不一样，即主进程设置的cachePath传递过来，需要手动传递一次
            setCachePath(path) {
                eventCetner.post('setCachePath', path);
            },
            setCustomLogHandler({ path, funName }) {
                eventCetner.post('setCustomLogHandler', path, funName);
            },
            setProgressHandler(cb) {
                // 先移除旧监听，避免重复设置时回调叠加
                if (currentProgressHandler) {
                    eventCetner.off('progress', currentProgressHandler);

                    currentProgressHandler = null;
                }

                if (cb) {
                    currentProgressHandler = (...args) => cb(...args);

                    eventCetner.on('progress', currentProgressHandler);
                }
            },
            // 终止 worker 线程
            terminate() {
                port1.unref();

                return worker.terminate();
            },
            // 线程退出（含主动 terminate）后的回调，供线程池移除引用
            onDead(cb) {
                deadCallback = cb;
            },
        };
    } else {
        const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
        const { workerData } = require('worker_threads');

        const CacheFile = require('../utils/CacheFile.js');
        const parseResources = require('../utils/parseResources.js');
        const { getPageTexts, getPageImages } = require('../utils/parsePage.js');
        const { log, setCustomHandler } = require('../utils/log.js');
        const EntityExtracter = require('../utils/EntityExtracter/index.js');

        const EventCenter = require('./EventCenter.js');

        // 主线程通过 MessageChannel 移交的端口通信
        const eventCetner = new EventCenter(workerData.port);

        /**
         * 分片解析：只处理页码满足 (pageNumber-1) % shards === shard 的页。
         * 单文件冷解析由主线程编排为 N 个分片并行（见 utils/parsePipeline.js），
         * 各分片在独立 worker 线程各自 getDocument 后按取模挑页——pdfjs 在 Node 下
         * 跑 fake worker（同线程串行解释），页级真并行只能靠跨线程获得。
         * 缓存副本复制、解析缓存读写与实体提取均在主线程/独立任务完成，本函数只产出原始分片
         * @param {String} filePath 源文件路径（分片直接读原文件，不依赖缓存副本）
         * @param {String} hash 主线程已算好的文件 hash（图片落盘定位缓存目录用）
         * @param {Number} shard 分片序号（0 起）
         * @param {Number} shards 分片总数
         */
        async function parseShard({ filePath, hash, shard = 0, shards = 1 }) {
            log('parsePDF.worker.factory.js', 'parseShard', `开始解析分片 ${shard + 1}/${shards}：`, filePath);

            const pdf = await pdfjsLib.getDocument(filePath).promise;
            const metadata = await pdf.getMetadata();

            // 图片落盘任务（跨页流水线）：sharp 的 hash/编码/写盘是异步原生调用，
            // 逐页同步 await 会把编码等待串进页循环；改为攒任务后台执行，
            // 与后续页的 pdfjs 解析重叠。多页图片像素因此并存，设字节上限控制峰值
            // （全局预算按分片数分摊，见 utils/parseResources.js）
            const pendingImageBytesLimit = parseResources.imagePendingBudgetPerShard(shards);

            const cacheFile = new CacheFile();

            cacheFile.hash = hash; // 主线程已算好，注入以定位图片缓存目录

            const texts = [];
            const images = [];

            let pendingImageSaves = [];
            let pendingImageBytes = 0;

            const flushImages = async () => {
                if (!pendingImageSaves.length) {
                    return;
                }

                const saved = await Promise.all(pendingImageSaves);

                images.push(...saved.filter((img) => img !== null));

                pendingImageSaves = [];
                pendingImageBytes = 0;
            };

            // 片内进度只上报片内事实（不拼全局页码与剩余时间）：
            // 取模分片下各片页码（1,5,9… / 2,6,10…）交错到达会让 UI 页码
            // 乱跳，全局进度与剩余时间由类库主线程按文件聚合
            // （parsePipeline.aggregateShardProgress）随明细一并发给外层。
            // 不带页码字段：该片处理的页码序列可由 shard+shards 推导。
            // 1s 节流减少跨线程消息，本片最后一页强制上报保证聚合收敛到满页数
            let done = 0;
            let lastPost = 0;

            const postProgress = (pageNumber) => {
                done++;

                const isShardLastPage = pageNumber + shards > pdf.numPages;

                if (!isShardLastPage && Date.now() - lastPost < 1000) {
                    return;
                }

                lastPost = Date.now();

                eventCetner.post('progress', {
                    filePath,
                    shard,
                    shards,
                    done, // 本片累计已完成页数
                    numPages: pdf.numPages,
                });
            };

            if (!pdf.numPages) {
                eventCetner.post('progress', {
                    filePath,
                    shard,
                    shards,
                    done: 0,
                    numPages: 0,
                });
            }

            const shardPages = pdf.numPages ? Math.floor((pdf.numPages - shard - 1) / shards) + 1 : 0;

            log('parsePDF.worker.factory.js', 'parseShard', `总页数 ${pdf.numPages}，本片处理 ${shardPages} 页`);

            let processed = 0;

            for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
                if ((pageNumber - 1) % shards !== shard) {
                    continue;
                }

                const page = await pdf.getPage(pageNumber);

                const [pageTexts, pageImageSaves] = await Promise.all([
                    getPageTexts({ page, pageNumber }), // 本页中文字
                    getPageImages({ page, pageNumber, cacheFile }), // 本页中的图片（落盘任务化）
                ]);

                // 直接赋值而非使用展开运算符，避免创建临时数组
                for (let i = 0; i < pageTexts.length; i++) {
                    texts.push(pageTexts[i]);
                }

                pendingImageSaves.push(...pageImageSaves.tasks);
                pendingImageBytes += pageImageSaves.bytes;

                page.cleanup();

                postProgress(pageNumber);

                // 每处理10页主动清理一次，避免内存累积
                if (++processed % 10 === 0 && global.gc) {
                    // 垃圾回收（仅 --expose-gc 下生效）
                    global.gc();
                }

                if (pendingImageBytes >= pendingImageBytesLimit) {
                    // 在途像素超限：等一批落盘完成，控制多页图片像素并存的内存峰值
                    await flushImages();
                }
            }

            pdf.cleanup();

            // 收尾：等剩余在途图片全部落盘
            await flushImages();

            log(
                'parsePDF.worker.factory.js',
                'parseShard',
                `分片 ${shard + 1}/${shards} 解析完毕：文本块 ${texts.length}，图片 ${images.length}`,
            );

            return {
                texts,
                images,
                metadata: metadata.info,
                pages: pdf.numPages,
            };
        }

        // 任务执行包装：结果按请求同名事件回传；异常也回传而非让线程崩溃，
        // 避免主线程调用方永久挂起
        const runTask = (event, run) => {
            Promise.resolve()
                .then(run)
                .then((res) => {
                    eventCetner.post(event, res);
                })
                .catch((error) => {
                    eventCetner.post(event, {
                        __error: true,
                        message: error && (error.stack || error.message),
                    });
                });
        };

        // 分片解析任务：参数 {filePath, hash, shard, shards}（并行编排见 index.js _parseFile）
        eventCetner.on('parseShard', (task) => runTask('parseShard', () => parseShard(task)));

        // 实体提取任务：参数为全文档句块文本（语料级判据需合并后的全量文本）
        eventCetner.on('extractEntities', (texts) =>
            runTask('extractEntities', () => EntityExtracter.extractMany(texts)),
        );

        eventCetner.on('setCachePath', (path) => {
            CacheFile.setCachePath(path);
        });

        eventCetner.on('setCustomLogHandler', (path, funName) => {
            const reqM = require(path);
            const fun = reqM[funName];

            setCustomHandler(fun);
        });

        return null;
    }
};
