/**
 * 页级解析（只在解析 worker 线程内加载执行）：一页 pdfjs 页对象 → 句块文本 / 图片落盘任务。
 *
 * 从 parsePDF.worker.factory.js 拆出：工厂文件只保留线程壳（双执行分流、
 * MessageChannel 通信、任务路由）与分片级编排（parseShard 的页循环、图片
 * 落盘流水线、进度上报），"单页内部怎么处理"（字体分组、按坐标拼行、分段、
 * 按标点断句、从操作列表抠图片）集中在本文件。
 * 依赖 pdfjs-dist，只在 worker 线程被 require，切勿引入主线程代码。
 */
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
const { log } = require('./log.js');

async function getPageTexts({ page, pageNumber }) {
    log('parsePage.js', 'getPageTexts', '开始解析页面文字：', pageNumber);

    const textContent = await page.getTextContent();

    // 按字体划分后的句组
    log(
        'parsePage.js',
        'getPageTexts',
        '开始主动处理文字，处理前数量：',
        textContent.items.length,
    );
    let fontGroups = _groupDifferentByFonts(textContent); // 文字按字体分组
    fontGroups = _reUnionLinesByXY(fontGroups); // 按坐标重组行
    fontGroups = _groupDifferentByFullRow(fontGroups, page.view[2]); // 按内容是否占满整行分组段落
    fontGroups = _splitByPunctuation(fontGroups); // 按标点切割语句
    log('parsePage.js', 'getPageTexts', '结束主动处理文字，处理后数量：', fontGroups.length);

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

    log('parsePage.js', 'getPageTexts', '解析页面文字完毕：', pageTexts.length);

    return pageTexts;
}

/**
 * 提取本页图片并返回落盘任务（不等待完成）：
 * sharp 的 hash/PNG编码/写盘是异步原生调用（libuv 线程池），
 * 逐页同步 await 会把编码等待串进页循环；任务由调用方攒批流水线执行，
 * 与后续页的 pdfjs 解析重叠（像素数据此时已驻留内存，任务化不增加峰值，
 * 多页并存的上限由调用方的字节限额控制）
 * @returns {Object} { tasks: Promise<图片条目|null>[], bytes: 本页图片像素字节 }
 */
async function getPageImages({ page, pageNumber, cacheFile }) {
    log('parsePage.js', 'getPageImages', '开始解析页面图片：', pageNumber);

    const imgs = await _extractImages(page);

    log('parsePage.js', 'getPageImages', '获取页面内全部图片：', imgs.length);

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

    const tasks = uniqueImgs.map(({ data, width, height, name }) => {
        // 缓存图片。pdfjs 的对象名（img_N）在每页都会重置编号，
        // 跨页同名可能指向不同图片，文件名中附加页号避免互相覆盖
        const uniqueName = `${name}_p${pageNumber}`;

        // saveImage 失败返回 false（解析中断重跑时已落盘的图会重算哈希返回）
        return cacheFile.saveImage({ data, width, height, name: uniqueName }).then((imgInfo) => {
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
        });
    });

    return {
        tasks,
        bytes: uniqueImgs.reduce((sum, { data }) => sum + data.length, 0),
    };
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
            (lastStyle.fontFamily || lastText.fontName) === (currStyle.fontFamily || text.fontName) // 字体相同
            && lastText.height === text.height // 字号相同
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
                    y === lineY // y坐标相同
                    && Math.abs(lastX + lastWidth - x) < height // x方向间隔不远
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
            const sentences = (
                normalized.match(
                            /([^\n!?;。！？；\u203C\u203D\u2047-\u2049]+([!?;。！？；\u203C\u203D\u2047-\u2049]|$))/gmu,
                ) || []
            )
                .map((s) => s.replace(/^\s+|\s+$/g, ''))
                .filter((s) => s.length > 0);

            result = [...result, ...sentences];
        });
    });

    return result;
}

async function _extractImages(page) {
    log('parsePage.js', '_extractImages', '开始获取页面内全部图片');

    const { fnArray, argsArray } = await page.getOperatorList();

    log(
        'parsePage.js',
        '_extractImages',
        'page.getOperatorList已获取全部页面操作：',
        fnArray.length,
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

    log('parsePage.js', '_extractImages', '截取到页面内疑似图片对象：', promiseList.length);

    await Promise.all(promiseList.map((p) => p()));

    log('parsePage.js', '_extractImages', '获取到页面内图片对象：', promiseList.length);

    promiseList = null;

    return imgs;
}

module.exports = { getPageTexts, getPageImages };
