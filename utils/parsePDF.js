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

    const texts = [];
    const images = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 });

        // 按字体划分后的句组
        const textContent = await page.getTextContent();
        const fontGroups = groupDifferentFonts(textContent);

        fontGroups.forEach((font) => {
            let text = font
                .map((item) => item.str)
                .join('')
                .trim(); // 这里之前使用的 /n 改为了空字符串，后续看看是否需要改为' '

            if (!text) {
                return;
            }

            texts.push({
                pageNumber,
                text,
                viewport,
            });
        });

        // 本页中的图片
        const imgs = await extractImages(page);

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
function groupDifferentFonts(textContent) {
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

async function extractImages(page) {
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
