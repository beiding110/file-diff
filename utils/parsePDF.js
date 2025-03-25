async function parsePDF(filePath) {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const pdf = await pdfjsLib.getDocument(filePath).promise;
    const metadata = await pdf.getMetadata();

    const texts = [];
    const images = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 });

        // 按字体划分后的句组
        const textContent = await page.getTextContent();
        const fontGroups = groupDifferentFonts(textContent);

        fontGroups.forEach((font) => {
            texts.push({
                pageNumber: i,
                text: font.map((item) => item.str).join(''), // 这里之前使用的 /n 改为了空字符串，后续看看是否需要改为' '
                viewport,
            });
        });

        // 本页中的图片
        const imgs = await extractImages(page);

        imgs.forEach((img) => {
            images.push({
                pageNumber: i,
                image: img,
                viewport,
            });
        });
    }

    return {
        metadata: metadata.info,
        texts,
        images,
        filePath,
    };
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
    const ops = await page.getOperatorList();

    // 提取图片
    const imgs = ops.fnArray.reduce((acc, curr, i) => {
        if ([pdfjsLib.OPS.paintImageXObject, pdfjsLib.OPS.paintJpegXObject].includes(curr)) {
            let imgIndex = ops.argsArray[i][0];

            page.objs.get(imgIndex, (imgRef) => {
                const bytes = imgRef.data;

                const buffer = Buffer.from(bytes);

                acc.push(buffer);
            });
        }

        return acc;
    }, []);

    return imgs;
}

module.exports = parsePDF;
