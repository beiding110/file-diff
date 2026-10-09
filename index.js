const { v4: uuidv4 } = require('uuid');

// 每个 factory 在主线程执行返回任务 API 对象（parseShard / extractEntities 等），
// 注册整个对象而非解构出的单个方法——池子靠对象上的 onDead/terminate 管理线程死活
const pdfWorkers = [
    require('./worker/parsePDF.worker.0.js'),
    require('./worker/parsePDF.worker.1.js'),
    require('./worker/parsePDF.worker.2.js'),
    require('./worker/parsePDF.worker.3.js'),
];

const TextComparator = require('./utils/TextComparator.js');
const ImageComparator = require('./utils/ImageComparator.js');
const CacheFile = require('./utils/CacheFile.js');
const WorkerMultiThreading = require('./utils/WorkerMultiThreading.js');
// 单文件解析编排（hash → 分片并行 → 合并 → 实体 → 写缓存），preload/across/processFiles 共用
const parseFile = require('./utils/parsePipeline.js');
const { log, setCustomHandler } = require('./utils/log.js');

const workerMultiThreading = new WorkerMultiThreading();

pdfWorkers.forEach((pdfWorker) => workerMultiThreading.register(pdfWorker));

class BidComparator {
    constructor() {
        this.bidDocsMatrix = [];

        // across() 暂存的解析结果，供 processFiles 复用后清空
        this._parsedDocs = null;

        this.textComparator = null;
        this.imageComparator = null;
    }

    static preload(file) {
        return parseFile(file, workerMultiThreading);
    }

    static async history(file) {
        return await CacheFile.getResult(file);
    }

    async across(bidFiles) {
        const bidDocs = await Promise.all(
            bidFiles.map(async (file) => {
                return await parseFile(file, workerMultiThreading);
            }),
        );

        // 暂存 worker 返回的完整解析结果，processFiles 直接复用，
        // 避免再从磁盘重复读取 parse.json（读取后即清空，不长期占用内存）
        this._parsedDocs = new Map();

        const matrix = [];

        // 两两对比投标文件
        for (let i = 0; i < bidDocs.length; i++) {
            for (let j = i + 1; j < bidDocs.length; j++) {
                const fileL = bidDocs[i],
                    fileR = bidDocs[j];

                this._parsedDocs.set(fileL.fileHash, fileL);
                this._parsedDocs.set(fileR.fileHash, fileR);

                matrix.push({
                    id: uuidv4(),
                    files: [
                        {
                            fileName: fileL.fileName,
                            fileHash: fileL.fileHash,
                        },
                        {
                            fileName: fileR.fileName,
                            fileHash: fileR.fileHash,
                        },
                    ],
                });
            }
        }

        this.bidDocsMatrix = matrix;

        log('index.js', 'across', '投标文件对比矩阵:', matrix.length, '个');

        return matrix;
    }

    async processFiles(bidFiles, biddingFile) {
        let biddingDoc = null;

        if (biddingFile) {
            biddingDoc = await parseFile(biddingFile, workerMultiThreading);
        }

        this.textComparator = new TextComparator(biddingDoc, _STORE_SETTINGS_TEXT);

        this.imageComparator = new ImageComparator(_STORE_SETTINGS_IMAGE);

        if (!this.bidDocsMatrix.length) {
            await this.across(bidFiles);
        }

        const GROUPID = uuidv4();

        // 文档缓存：优先复用 across() 已取得的解析结果，磁盘只作为兜底。
        // 引用计数（每个文件参与的对比对数）归零即释放；同时限制缓存文档
        // 数量上限——文件很多时内存仍有界，超限按"已无用优先、最久未用次之"
        // 淘汰，被淘汰的文档下次使用时自动从磁盘重新加载
        const MAX_CACHED_DOCS = 20;

        const pairCount = new Map();

        for (const { files } of this.bidDocsMatrix) {
            for (const file of files) {
                pairCount.set(file.fileHash, (pairCount.get(file.fileHash) || 0) + 1);
            }
        }

        const docCache = new Map(); // hash -> { doc, remaining, lastUsed }

        if (this._parsedDocs) {
            for (const [hash, doc] of this._parsedDocs) {
                docCache.set(hash, { doc, remaining: pairCount.get(hash) || 0, lastUsed: Date.now() });
            }

            // 灌入后清空暂存，避免长期双份引用
            this._parsedDocs.clear();
            this._parsedDocs = null;
        }

        // 分批处理：每批处理的对比对数量
        // 这有助于在大量文件时控制内存使用
        const BATCH_SIZE = 10;

        for (let batchStart = 0; batchStart < this.bidDocsMatrix.length; batchStart += BATCH_SIZE) {
            const batchEnd = Math.min(batchStart + BATCH_SIZE, this.bidDocsMatrix.length);
            const batch = this.bidDocsMatrix.slice(batchStart, batchEnd);

            log('index.js', 'processFiles', `处理批次 ${batchStart + 1}-${batchEnd} / ${this.bidDocsMatrix.length}`);

            // 处理当前批次
            for (let i = 0; i < batch.length; i++) {
                let { id, files } = batch[i];

                // 排除招标文件内容进度回调
                if (this.textCompareRemoveProgressHandlerFactory) {
                    this.textComparator.removeProgressHandler = this.textCompareRemoveProgressHandlerFactory(id);
                }

                // 文字对比进度回调
                if (this.textCompareProgressHandlerFactory) {
                    this.textComparator.progressHandler = this.textCompareProgressHandlerFactory(id);
                }

                // 图片对比进度回调
                if (this.imageCompareProgressHandlerFactory) {
                    this.imageComparator.processHandler = this.imageCompareProgressHandlerFactory(id);
                }

                // 从缓存读取或从文件加载
                const getFile = async (fileHash) => {
                    let entry = docCache.get(fileHash);

                    if (entry) {
                        entry.lastUsed = Date.now();

                        return entry.doc;
                    }

                    const data = await CacheFile.readCacheByHash(fileHash);

                    if (!data) {
                        throw new Error(`未找到文件 ${fileHash} 的解析缓存，请先 preload 后再对比`);
                    }

                    // 数量超限时淘汰：已无剩余对比对的优先，其次最久未用的
                    if (docCache.size >= MAX_CACHED_DOCS) {
                        let victimKey = null;
                        let victimScore = null;

                        for (const [key, item] of docCache) {
                            // 分数越小越先淘汰：引用耗尽排最前，同状态下取最久未用
                            const score = (item.remaining > 0 ? Number.MAX_SAFE_INTEGER : 0) + item.lastUsed;

                            if (victimScore === null || score < victimScore) {
                                victimScore = score;
                                victimKey = key;
                            }
                        }

                        if (victimKey !== null) {
                            docCache.delete(victimKey);
                        }
                    }

                    entry = { doc: data, remaining: pairCount.get(fileHash) || 0, lastUsed: Date.now() };
                    docCache.set(fileHash, entry);

                    return entry.doc;
                };

                const fileL = await getFile(files[0].fileHash);
                const fileR = await getFile(files[1].fileHash);

                // 进行比对
                const result = await this.compareBids(fileL, fileR, id);

                log('index.js', 'processFiles', '对比完毕');

                result.groupid = GROUPID;

                // 增量保存单个结果，避免内存累积
                await CacheFile.appendResult(result, GROUPID, result.uuid);

                // 引用计数递减，归零即释放该文档占用的内存
                for (const file of files) {
                    const entry = docCache.get(file.fileHash);

                    if (entry) {
                        entry.remaining -= 1;

                        if (entry.remaining <= 0) {
                            docCache.delete(file.fileHash);
                        }
                    }
                }
            }

            // 批次之间稍作等待，让 GC 有机会回收内存
            if (batchEnd < this.bidDocsMatrix.length) {
                await new Promise((resolve) => setImmediate(resolve));
                if (global.gc) {
                    global.gc();
                }
            }
        }

        // 调用方可以通过 CacheFile.getResult(GROUPID) 按需读取
        return GROUPID;
    }

    async compareBids(bidA, bidB, id) {
        const startTime = new Date().getTime();

        log('index.js', 'compareBids', '即将开始对比文字:', bidA.fileName, bidB.fileName);

        // 文字对比走 diff 线程池、图片对比在主线程纯内存计算，
        // 两者互不争抢资源，并行执行缩短单对耗时
        const [textResult, imageResult] = await Promise.all([
            this.textComparator.findSimilarities(bidA.texts, bidB.texts),
            this.imageComparator.compareImages(bidA.images, bidB.images),
        ]);

        const { similarities: textSimilarities, stats: textStats } = textResult;
        const { matches: imageMatches, stats: imageStats } = imageResult;

        log('index.js', 'compareBids', '文字对比结束：', textSimilarities.length);
        log('index.js', 'compareBids', '即将开始对比图片：:', bidA.fileName, bidB.fileName);
        log('index.js', 'compareBids', '图片对比结束：', imageMatches.length);
        log('index.js', 'compareBids', '即将开始对比属性：:', bidA.fileName, bidB.fileName);

        const metadataMatches = this.compareMetadata(bidA.metadata, bidB.metadata);

        log('index.js', 'compareBids', '属性对比结束');

        const similarity = this.calculateSimilarity(textStats, imageStats, metadataMatches);

        const endTime = new Date().getTime();

        return {
            groupid: '',
            uuid: id || uuidv4(),
            names: [bidA.fileName, bidB.fileName],
            files: [bidA.filePath, bidB.filePath],
            textSimilarities,
            imageMatches,
            metadataMatches,
            similarity,
            starttime: startTime,
            addtime: endTime,
            duration: endTime - startTime,
            settings: {
                text: {
                    threshold: this.textComparator.options.threshold,
                    minLength: this.textComparator.options.minLength,
                    excludeToc: this.textComparator.options.excludeToc,
                },
                image: {
                    similarity: this.imageComparator.options.similarity,
                    minSize: this.imageComparator.options.minSize,
                    ratioTolerance: this.imageComparator.options.ratioTolerance,
                },
            },
        };
    }

    // 文件级相似度：把文字/图片/属性统一换算为字节，按内容体量自动分配权重——
    // 两侧各自的命中率 = 该侧命中字节 / 该侧总字节，合并值（score）为总体 Dice 系数。
    // 哪类内容在文件对中体量大就自然主导总分，无需人工拍权重；
    // 某类内容缺失时其字节为 0，权重自动归零（连续降权，无二元跳变）。
    //
    // 字节换算率（隐式决定各类内容的相对权重，需要时调整这两个系数）：
    // - 文字：字符数 × 2（UTF-16，JS 字符串的真实内存口径）
    // - 图片：width × height × 4（RGBA 未压缩位图，sharp 解码时的真实像素缓冲口径）
    // - 属性：值字符串长度 × 2
    // 注意该口径下一张中等图片即抵近百万字文字，含图对的分数主要由图片体量决定
    calculateSimilarity(textStats, imageStats, metadataMatches) {
        const CHAR_BYTES = 2;
        const PIXEL_BYTES = 4;

        // 属性只在两侧都有值的项上统计：双方都空缺的项不构成相似证据
        const metaEffective = metadataMatches.filter((item) => item.a && item.b);

        let totalMetaBytesA = 0;
        let totalMetaBytesB = 0;
        let matchedMetaBytesA = 0;
        let matchedMetaBytesB = 0;

        for (const item of metaEffective) {
            const bytesA = String(item.a).length * CHAR_BYTES;
            const bytesB = String(item.b).length * CHAR_BYTES;

            totalMetaBytesA += bytesA;
            totalMetaBytesB += bytesB;

            if (item.same) {
                matchedMetaBytesA += bytesA;
                matchedMetaBytesB += bytesB;
            }
        }

        // 两侧各自的字节构成：文字 + 图片 + 属性
        const totalBytesA = textStats.totalLenA * CHAR_BYTES + imageStats.totalPixelsA * PIXEL_BYTES + totalMetaBytesA;
        const totalBytesB = textStats.totalLenB * CHAR_BYTES + imageStats.totalPixelsB * PIXEL_BYTES + totalMetaBytesB;

        const matchedBytesA =
            textStats.matchedLenA * CHAR_BYTES + imageStats.matchedPixelsA * PIXEL_BYTES + matchedMetaBytesA;
        const matchedBytesB =
            textStats.matchedLenB * CHAR_BYTES + imageStats.matchedPixelsB * PIXEL_BYTES + matchedMetaBytesB;

        const ratio = (matched, total) => (total > 0 ? matched / total : null);

        // 分项明细：文字/图片各为 Dice 系数，附带单向覆盖率（判断重合的方向）
        const dice = (matchedA, matchedB, totalA, totalB) => {
            if (totalA + totalB <= 0) {
                return null;
            }

            return (matchedA + matchedB) / (totalA + totalB);
        };

        const coverage = (matched, total) => (total > 0 ? matched / total : 0);

        return {
            // 总相似度（0~1），按三类内容的字节体量自动加权：
            // a/b 为该文件的内容在对方文件中重复的比例，score 为两文件合并的总体命中率
            overall: {
                score: ratio(matchedBytesA + matchedBytesB, totalBytesA + totalBytesB) ?? 0,
                a: ratio(matchedBytesA, totalBytesA),
                b: ratio(matchedBytesB, totalBytesB),
            },
            text: {
                score: dice(textStats.matchedLenA, textStats.matchedLenB, textStats.totalLenA, textStats.totalLenB),
                a: textStats.totalLenA > 0 ? coverage(textStats.matchedLenA, textStats.totalLenA) : null,
                b: textStats.totalLenB > 0 ? coverage(textStats.matchedLenB, textStats.totalLenB) : null,
            },
            image: {
                score: dice(
                    imageStats.matchedPixelsA,
                    imageStats.matchedPixelsB,
                    imageStats.totalPixelsA,
                    imageStats.totalPixelsB,
                ),
                a: imageStats.totalPixelsA > 0 ? coverage(imageStats.matchedPixelsA, imageStats.totalPixelsA) : null,
                b: imageStats.totalPixelsB > 0 ? coverage(imageStats.matchedPixelsB, imageStats.totalPixelsB) : null,
            },
            metadata: {
                score:
                    metaEffective.length > 0
                        ? metaEffective.filter((item) => item.same).length / metaEffective.length
                        : null,
                same: metaEffective.filter((item) => item.same).length,
                compared: metaEffective.length,
            },
        };
    }

    compareMetadata(metaA, metaB) {
        const list = [
            { key: 'Author', label: '作者' },
            { key: 'CreationDate', label: '创建时间' },
            { key: '', label: '版本' },
            { key: 'Creator', label: '应用程序' },
            { key: '', label: '属性【标题】' },
            { key: 'ModDate', label: '最后修改日期' },
            { key: '', label: '属性【主题】' },
            { key: '', label: '属性【公司】' },
            { key: '', label: '属性【关键词】' },
            { key: '', label: '最后修改者' },
        ];

        return list.reduce((arr, item) => {
            let { key, label } = item;

            if (!key) {
                return arr;
            }

            let i = {
                label,
                a: metaA[key],
                b: metaB[key],
                same: false,
            };

            if (metaA[key] === metaB[key]) {
                i.same = true;
            }

            arr.push(i);

            return arr;
        }, []);
    }

    static setCachePath(path) {
        CacheFile.setCachePath(path);

        pdfWorkers.forEach((pdfWorker) => pdfWorker.setCachePath(path));
    }

    // 释放全部线程资源（PDF 解析池 + 文字对比池）。
    // 空闲 worker 已通过 unref 不阻止进程退出，正常场景无需调用；
    // 长驻进程（如常驻服务）用完对比功能后可调用以回收线程内存。
    // 注意：关闭后再发起对比会直接报错而非挂起
    static dispose() {
        workerMultiThreading.shutdown();
        TextComparator.shutdown();
    }

    static setLogCustomHandler(handler, { path, funName }) {
        setCustomHandler(handler);

        if (path) {
            pdfWorkers.forEach((pdfWorker) => pdfWorker.setCustomLogHandler({ path, funName }));
        }
    }

    static setPreloadProgressHandler(handler) {
        pdfWorkers.forEach((pdfWorker) => pdfWorker.setProgressHandler(handler));
    }

    static updateSettings({ text, image, workers = 'multi' }) {
        if (text) {
            const { threshold, minLength, excludeToc } = text;

            if (threshold) {
                _STORE_SETTINGS_TEXT.threshold = threshold;
            }

            if (minLength) {
                _STORE_SETTINGS_TEXT.minLength = minLength;
            }

            // boolean 参数：显式类型判断，false 也是合法配置不能被真值判断跳过
            if (typeof excludeToc === 'boolean') {
                _STORE_SETTINGS_TEXT.excludeToc = excludeToc;
            }
        }

        if (image) {
            const { similarity, minSize, ratioTolerance } = image;

            if (similarity) {
                _STORE_SETTINGS_IMAGE.similarity = similarity;
            }

            if (minSize) {
                _STORE_SETTINGS_IMAGE.minSize = minSize;
            }

            if (ratioTolerance) {
                _STORE_SETTINGS_IMAGE.ratioTolerance = ratioTolerance;
            }
        }

        if (workers) {
            TextComparator.regWorker(workers);
            ImageComparator.regWorker(workers);
        }
    }
}

// 对比的设置缓存，在实例化时传入
const _STORE_SETTINGS_TEXT = {};
const _STORE_SETTINGS_IMAGE = {};

module.exports = BidComparator;
