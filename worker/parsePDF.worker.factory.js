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
            log('parsePDF.worker.factory.js', '_getPageTexts', '文字按字体分组');
            const fontGroups = _groupDifferentFonts(textContent);

            log(
                'parsePDF.worker.factory.js',
                '_getPageTexts',
                '文字按字体分组完毕：',
                fontGroups.length,
                '开始按标点切割'
            );
            let fonts = [];

            fontGroups.forEach((font) => {
                let text = font
                    .map((item) => item.str)
                    .join('')
                    .trim(); // 这里之前使用的 /n 改为了空字符串，后续看看是否需要改为' '

                if (!text) {
                    return;
                }

                let page = {
                    pageNumber,
                    text,
                };

                // 将页面中的文字按标点切割
                let pageSplitByPunctuation = _splitByPunctuation(page);

                fonts = [...fonts, ...pageSplitByPunctuation];
            });

            log('parsePDF.worker.factory.js', '_getPageTexts', '解析页面文字完毕：', fonts.length);

            return fonts;
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
        function _groupDifferentFonts(textContent) {
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

        // 按标点符号切割
        function _splitByPunctuation(page) {
            // 统一全角字符为半角
            const normalized = page.text
                .normalize('NFKC')
                .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
                .replace(/\s+/g, ' ')
                .trim();

            // 将断句进一步拆分
            const sentences = _splitSentences(normalized)
                .map((s) => s.replace(/^\s+|\s+$/g, ''))
                .filter((s) => s.length > 0);

            return sentences.map((s) => {
                return {
                    ...page,
                    text: s,
                };
            });
        }

        // 按句子拆分文本
        function _splitSentences(text) {
            // 支持中文/英文/日文分句
            const sentenceRegex =
                /([^\n.!?;。！？；\u203C\u203D\u2047-\u2049]+([.!?;。！？；\u203C\u203D\u2047-\u2049]|$))/gmu;

            return text.match(sentenceRegex) || [];
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
