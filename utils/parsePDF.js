const CacheFile = require('./CacheFile.js');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

async function parsePDF(filePath) {
    var cacheFile = new CacheFile();

    // 缓存pdf文档
    const pdfPath = await cacheFile.savePdf(filePath);

    // 先检查缓存
    const cache = cacheFile.checkIsCached();

    if (cache) {
        return cache;
    }

    const pdf = await pdfjsLib.getDocument(filePath).promise;
    const metadata = await pdf.getMetadata();

    let texts = [];
    let images = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.0 });

        const textContent = await page.getTextContent();
        // 按字体划分后的句组
        const fontGroups = _groupDifferentFonts(textContent);

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
                viewport,
            };

            // 将页面中的文字按标点切割
            let pageSplitByPunctuation = _splitByPunctuation(page);

            texts = [
                ...texts,
                ...pageSplitByPunctuation,
            ];
        });

        // 本页中的图片
        const imgs = await _extractImages(page);

        for (let i = 0; i < imgs.length; i++) {
            let { data, width, height, name } = imgs[i];

            // 缓存图片
            let imgPath = await cacheFile.saveImage({ data, width, height, name });

            images.push({
                pageNumber,
                image: imgPath,
                width,
                height,
                viewport,
            });
        }
    }

    const resloved = {
        filePath: pdfPath,
        metadata: metadata.info,
        texts,
        images,
    };

    // 缓存文件解析后的信息
    await cacheFile.saveParseInfo(resloved);

    return resloved;
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
            textContent.styles[lastText.fontName].textContent === textContent.styles[text.fontName].textContent && // 字体相同
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
    const sentenceRegex = /([^\n.!?;。！？；\u203C\u203D\u2047-\u2049]+([.!?;。！？；\u203C\u203D\u2047-\u2049]|$))/gmu;

    return text.match(sentenceRegex) || [];
}

async function _extractImages(page) {
    const ops = await page.getOperatorList(),
        { fnArray, argsArray } = ops;

    // 提取图片
    let imgs = [];

    for (let i = 0; i < fnArray.length; i++) {
        let curr = fnArray[i];

        if ([pdfjsLib.OPS.paintImageXObject, pdfjsLib.OPS.paintJpegXObject].includes(curr)) {
            let imgIndex = argsArray[i][0];

            page.objs.get(imgIndex, async (imgRef) => {
                const { data, width, height } = imgRef;

                imgs.push({ data, width, height, name: imgIndex });
            });
        }
    }

    return imgs;
}

module.exports = parsePDF;
