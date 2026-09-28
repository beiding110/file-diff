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

        return {
            parsePDF(filePath) {
                return new Promise((resolve, reject) => {
                    pendingReject = reject;

                    // 解析在途时保持 ref，防止进程在无其他句柄时提前退出
                    port1.ref();

                    eventCetner.post('parsePDF', filePath);

                    eventCetner.once('parsePDF', (res) => {
                        pendingReject = null;

                        port1.unref();

                        if (res && res.__error) {
                            reject(new Error(res.message));
                            return;
                        }

                        resolve(res);
                    });
                });
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
        const path = require('path');
        const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
        const { workerData } = require('worker_threads');

        const CacheFile = require('../utils/CacheFile.js');
        const { log, setCustomHandler } = require('../utils/log.js');
        const factoryProgress = require('../utils/factoryProgress.js');

        const EventCenter = require('./EventCenter.js');

        // 主线程通过 MessageChannel 移交的端口通信
        const eventCetner = new EventCenter(workerData.port);

        async function parsePDF(filePath) {
            log('parsePDF.worker.factory.js', 'parsePDF', '开始解析PDF文件：', filePath);

            var cacheFile = new CacheFile();

            // 缓存pdf文档
            log('parsePDF.worker.factory.js', 'parsePDF', '开始缓存PDF文件');

            const { pdfPath, hash } = await cacheFile.savePdf(filePath);

            // 先检查缓存
            log('parsePDF.worker.factory.js', 'parsePDF', '开始检查解析缓存是否存在');

            const cache = cacheFile.checkIsCached();

            if (cache) {
                log('parsePDF.worker.factory.js', 'parsePDF', '存在解析结果缓存，直接返回缓存结果：', filePath);

                return cache;
            }

            log('parsePDF.worker.factory.js', 'parsePDF', '不存在解析结果缓存，开始解析PDF文件');

            const pdf = await pdfjsLib.getDocument(filePath).promise;
            const metadata = await pdf.getMetadata();

            let progress = factoryProgress(pdf.numPages, (...args) => {
                eventCetner.post('progress', filePath, ...args);
            });

            // 预分配数组大小，避免频繁扩容。估算每页平均约50个文本和10个图片
            const estimatedTexts = pdf.numPages * 50;
            const estimatedImages = pdf.numPages * 10;

            let texts = new Array(estimatedTexts);
            let images = new Array(estimatedImages);
            let textIndex = 0;
            let imageIndex = 0;

            log('parsePDF.worker.factory.js', 'parsePDF', '开始逐页解析PDF文件');

            for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
                const page = await pdf.getPage(pageNumber);

                const [pageTexts, pageImages] = await Promise.all([
                    _getPageTexts({ page, pageNumber, cacheFile }), // 本页中文字
                    _getPageImages({ page, pageNumber, cacheFile }), // 本页中的图片
                ]);

                // 直接赋值而非使用展开运算符，避免创建临时数组
                for (let i = 0; i < pageTexts.length; i++) {
                    texts[textIndex++] = pageTexts[i];
                }
                for (let i = 0; i < pageImages.length; i++) {
                    images[imageIndex++] = pageImages[i];
                }

                page.cleanup();

                progress();

                // 每处理10页主动清理一次，避免内存累积
                if (pageNumber % 10 === 0) {
                    // 垃圾回收
                    if (global.gc) {
                        global.gc();
                    }
                }
            }

            // 截取实际使用的部分
            texts.length = textIndex;
            images.length = imageIndex;

            pdf.cleanup();

            log('parsePDF.worker.factory.js', 'parsePDF', '逐页解析PDF文件完毕');

            const resloved = {
                fileName: path.basename(filePath),
                filePath: pdfPath,
                fileHash: hash,
                metadata: metadata.info,
                texts,
                images,
            };

            log('parsePDF.worker.factory.js', 'parsePDF', '开始缓存解析结果');

            // 缓存文件解析后的信息
            await cacheFile.saveParseInfo(resloved);

            log('parsePDF.worker.factory.js', 'parsePDF', '缓存解析结果完毕', filePath);

            return resloved;
        }

        async function _getPageTexts({ page, pageNumber, cacheFile }) {
            log('parsePDF.worker.factory.js', '_getPageTexts', '开始解析页面文字：', pageNumber);

            const textContent = await page.getTextContent();

            // 按字体划分后的句组
            log(
                'parsePDF.worker.factory.js',
                '_getPageTexts',
                '开始主动处理文字，处理前数量：',
                textContent.items.length
            );
            let fontGroups = _groupDifferentByFonts(textContent); // 文字按字体分组
            fontGroups = _reUnionLinesByXY(fontGroups); // 按坐标重组行
            fontGroups = _groupDifferentByFullRow(fontGroups, page.view[2]); // 按内容是否占满整行分组段落
            fontGroups = _splitByPunctuation(fontGroups); // 按标点切割语句
            log('parsePDF.worker.factory.js', '_getPageTexts', '结束主动处理文字，处理后数量：', fontGroups.length);

            let pageTexts = [];

            fontGroups.forEach((text) => {
                if (!text) {
                    return;
                }

                pageTexts.push({
                    pageNumber,
                    text,
                });
            });

            log('parsePDF.worker.factory.js', '_getPageTexts', '解析页面文字完毕：', pageTexts.length);

            return pageTexts;
        }

        async function _getPageImages({ page, pageNumber, cacheFile }) {
            log('parsePDF.worker.factory.js', '_getPageImages', '开始解析页面图片：', pageNumber);

            const imgs = await _extractImages(page);

            log('parsePDF.worker.factory.js', '_getPageImages', '获取页面内全部图片：', imgs.length);

            log('parsePDF.worker.factory.js', '_getPageImages', '开始缓存图片');

            // 页内按对象名+尺寸去重（pdfjs 同页内同名必同图）
            const seen = new Set();

            const uniqueImgs = imgs.filter(({ name, width, height }) => {
                const key = `${name}_${width}x${height}`;

                if (seen.has(key)) {
                    return false;
                }

                seen.add(key);

                return true;
            });

            // 并行落盘：sharp 为异步原生调用，串行 await 会放大每张图的编码等待。
            // 图片像素数据此时已全部驻留内存（_extractImages 一次性取出），
            // 并行保存不会增加内存峰值
            const saved = await Promise.all(
                uniqueImgs.map(async ({ data, width, height, name }) => {
                    // 缓存图片。pdfjs 的对象名（img_N）在每页都会重置编号，
                    // 跨页同名可能指向不同图片，文件名中附加页号避免互相覆盖
                    const uniqueName = `${name}_p${pageNumber}`;

                    const imgInfo = await cacheFile.saveImage({ data, width, height, name: uniqueName });

                    if (!imgInfo) {
                        return null;
                    }

                    return {
                        name,
                        pageNumber,
                        ...imgInfo,
                        width,
                        height,
                    };
                })
            );

            const images = saved.filter((img) => img !== null);

            log('parsePDF.worker.factory.js', '_getPageImages', '解析页面图片完毕：', images.length);

            return images;
        }

        // 按字体、字号对内容进行分组
        function _groupDifferentByFonts(textContent) {
            const textInDifferentFonts = [];
            let lastText = null;

            textContent.items.forEach((text) => {
                if (!text.height || !text.str) {
                    // 空的
                    return;
                }

                if (!lastText) {
                    // 首个
                    textInDifferentFonts.push([text]);

                    lastText = text;

                    return;
                }

                const lastStyle = textContent.styles[lastText.fontName] || {};
                const currStyle = textContent.styles[text.fontName] || {};

                if (
                    (lastStyle.fontFamily || lastText.fontName) === (currStyle.fontFamily || text.fontName) && // 字体相同
                    lastText.height === text.height // 字号相同
                ) {
                    textInDifferentFonts[textInDifferentFonts.length - 1].push(text);
                } else {
                    textInDifferentFonts.push([text]);
                }

                lastText = text;
            });

            return textInDifferentFonts;
        }

        // 根据坐标，按行重组
        function _reUnionLinesByXY(texts) {
            const result = [];

            texts.forEach((fontGroup) => {
                const lines = [];

                let lineFirstText = null; // 这组文字段
                let lastText = null; // 上个段

                fontGroup.forEach((text, index) => {
                    if (!lineFirstText) {
                        // 第一个
                        lineFirstText = {
                            ...text,
                        };
                    } else {
                        // 非第一个
                        let x = text.transform[4],
                            y = text.transform[5],
                            width = text.width,
                            height = text.height,
                            lineY = lineFirstText.transform[5],
                            lastX = lastText.transform[4],
                            lastWidth = lastText.width;

                        if (
                            y === lineY && // y坐标相同
                            Math.abs(lastX + lastWidth - x) < height // x方向间隔不远
                        ) {
                            // 同一行

                            lineFirstText.str += text.str;
                            lineFirstText.width += width; // 重新计算宽度
                        } else {
                            // 不同行

                            lines.push({
                                ...lineFirstText,
                                x_s: lineFirstText.transform[4],
                                x_e: lineFirstText.transform[4] + lineFirstText.width,
                                y_s: lineFirstText.transform[5],
                                y_e: lineFirstText.transform[5] + lineFirstText.height,
                            });

                            lineFirstText = {
                                ...text,
                            };
                        }
                    }

                    // 只读引用，无需拷贝
                    lastText = text;

                    // 最后一个
                    if (index === fontGroup.length - 1) {
                        lines.push({
                            ...lineFirstText,
                            x_s: lineFirstText.transform[4],
                            x_e: lineFirstText.transform[4] + lineFirstText.width,
                            y_s: lineFirstText.transform[5],
                            y_e: lineFirstText.transform[5] + lineFirstText.height,
                        });
                    }
                });

                result.push(lines);
            });

            return result;
        }

        // 根据缩进分段
        function _groupDifferentByFullRow(texts, pageWidth, tolerance = 10) {
            const result = [];

            texts.forEach((fontGroup) => {
                const lines = [];

                let sentence = null,
                    lastRow = null;

                fontGroup.forEach((text, index) => {
                    if (!sentence) {
                        // 第一个
                        sentence = {
                            str: text.str,
                        };
                    } else {
                        // 非第一个
                        let x_e = lastRow.x_e,
                            x_s = lastRow.x_s;

                        if (Math.abs(x_e + x_s - pageWidth) < text.height * 2 + tolerance) {
                            // 上一个占满整行

                            sentence.str += text.str;
                        } else {
                            // 上一个没占满整行

                            lines.push({
                                ...sentence,
                            });

                            sentence = {
                                str: text.str,
                            };
                        }
                    }

                    lastRow = text;

                    // 最后一个
                    if (index === fontGroup.length - 1) {
                        lines.push({
                            ...sentence,
                        });
                    }
                });

                result.push(lines);
            });

            return result;
        }

        // 按标点符号切割
        function _splitByPunctuation(texts) {
            let result = [];

            texts.forEach((fontGroup) => {
                fontGroup.forEach(({ str }) => {
                    // 统一全角字符为半角
                    const normalized = str
                        .normalize('NFKC')
                        .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
                        .replace(/\s+/g, ' ')
                        .trim();

                    // 将断句按标点拆分
                    const sentences = (normalized.match(
                            /([^\n!?;。！？；\u203C\u203D\u2047-\u2049]+([!?;。！？；\u203C\u203D\u2047-\u2049]|$))/gmu
                        ) || [])
                        .map((s) => s.replace(/^\s+|\s+$/g, ''))
                        .filter((s) => s.length > 0);

                    result = [...result, ...sentences];
                });
            });

            return result;
        }

        async function _extractImages(page) {
            log('parsePDF.worker.factory.js', '_extractImages', '开始获取页面内全部图片');

            const { fnArray, argsArray } = await page.getOperatorList();

            log(
                'parsePDF.worker.factory.js',
                '_extractImages',
                'page.getOperatorList已获取全部页面操作：',
                fnArray.length
            );

            // 提取图片
            let imgs = [],
                promiseList = [];

            for (let i = 0; i < fnArray.length; i++) {
                let curr = fnArray[i];

                if (
                    [
                        pdfjsLib.OPS.paintImageXObject,
                        pdfjsLib.OPS.paintInlineImageXObject,
                        pdfjsLib.OPS.paintInlineImageXObjectGroup,
                        pdfjsLib.OPS.paintImageXObjectRepeat,
                        pdfjsLib.OPS.paintXObject,
                    ].includes(curr)
                ) {
                    let imgIndex = argsArray[i][0];

                    if (!/^(img_)/.test(imgIndex)) {
                        // 过滤不是图片的情况
                        continue;
                    }

                    promiseList.push(function () {
                        return new Promise((resolve) => {
                            page.objs.get(imgIndex, async (imgRef) => {
                                if (!imgRef) {
                                    // 存在无法获取imgRef的情况，这时直接跳过该图片
                                    resolve();

                                    return;
                                }

                                const { data, width, height } = imgRef;

                                imgs.push({ data, width, height, name: imgIndex });

                                resolve();
                            });
                        });
                    });
                }
            }

            log('parsePDF.worker.factory.js', '_extractImages', '截取到页面内疑似图片对象：', promiseList.length);

            await Promise.all(promiseList.map((p) => p()));

            log('parsePDF.worker.factory.js', '_extractImages', '获取到页面内图片对象：', promiseList.length);

            promiseList = null;

            return imgs;
        }

        eventCetner.on('parsePDF', async (filePath) => {
            try {
                const res = await parsePDF(filePath);

                eventCetner.post('parsePDF', res);
            } catch (error) {
                // 回传错误，避免线程崩溃导致主线程调用方永久挂起
                eventCetner.post('parsePDF', {
                    __error: true,
                    message: error && (error.stack || error.message),
                });
            }
        });

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
