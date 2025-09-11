module.exports = function (thisFileName) {
    const { Worker, parentPort, workerData, isMainThread } = require('worker_threads');

    if (isMainThread) {
        const { log } = require('../utils/log.js');
        const EventCenter = require('./EventCenter.js');

        const worker = new Worker(thisFileName, {
            workerData: '',
        });

        worker.on('error', (error) => {
            log(error);
        });

        const eventCetner = new EventCenter(worker);

        return {
            parsePDF(filePath) {
                return new Promise((resolve, reject) => {
                    worker.postMessage({
                        type: 'parsePDF',
                        args: [filePath],
                    });

                    eventCetner.post('parsePDF', filePath);

                    eventCetner.once('parsePDF', (res) => {
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
                eventCetner.on('progress', (...args) => {
                    cb && cb(...args);
                });
            },
        };
    } else {
        const path = require('path');
        const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

        const CacheFile = require('../utils/CacheFile.js');
        const { log, setCustomHandler } = require('../utils/log.js');
        const factoryProgress = require('../utils/factoryProgress.js');

        const EventCenter = require('./EventCenter.js');

        const eventCetner = new EventCenter(parentPort);

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

            let texts = [];
            let images = [];

            log('parsePDF.worker.factory.js', 'parsePDF', '开始逐页解析PDF文件');

            for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
                const page = await pdf.getPage(pageNumber);

                const [pageTexts, pageImages] = await Promise.all([
                    _getPageTexts({ page, pageNumber, cacheFile }), // 本页中文字
                    _getPageImages({ page, pageNumber, cacheFile }), // 本页中的图片
                ]);

                texts = [...texts, ...pageTexts];
                images = [...images, ...pageImages];

                page.cleanup();

                progress();
            }

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

                let page = {
                    pageNumber,
                    text,
                };

                pageTexts.push(page);
            });

            log('parsePDF.worker.factory.js', '_getPageTexts', '解析页面文字完毕：', pageTexts.length);

            return pageTexts;
        }

        async function _getPageImages({ page, pageNumber, cacheFile }) {
            log('parsePDF.worker.factory.js', '_getPageImages', '开始解析页面图片：', pageNumber);

            const imgs = await _extractImages(page);

            log('parsePDF.worker.factory.js', '_getPageImages', '获取页面内全部图片：', imgs.length);

            log('parsePDF.worker.factory.js', '_getPageImages', '开始缓存图片');

            let images = [];

            for (let i = 0; i < imgs.length; i++) {
                let { data, width, height, name } = imgs[i];

                // 缓存图片
                let imgPath = await cacheFile.saveImage({ data, width, height, name });

                images.push({
                    pageNumber,
                    image: imgPath,
                    width,
                    height,
                });
            }

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

                if (
                    textContent.styles[lastText.fontName].textContent ===
                        textContent.styles[text.fontName].textContent && // 字体相同
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

                    lastText = {
                        ...text,
                    };

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
                    const sentences =
                        normalized.match(
                            /([^\n!?;。！？；\u203C\u203D\u2047-\u2049]+([!?;。！？；\u203C\u203D\u2047-\u2049]|$))/gmu
                        ) || [].map((s) => s.replace(/^\s+|\s+$/g, '')).filter((s) => s.length > 0);

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
            const res = await parsePDF(filePath);

            eventCetner.post('parsePDF', res);
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
