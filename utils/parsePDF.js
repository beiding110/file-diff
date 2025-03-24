async function parsePDF(filePath) {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const pdf = await pdfjsLib.getDocument(filePath).promise;
    const metadata = await pdf.getMetadata();

    const pages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });

        const fontGroups = groupDifferentFonts(textContent);

        fontGroups.forEach(font => {
            pages.push({
                pageNumber: i,
                text: font.map((item) => item.str).join(''), // 这里之前使用的 /n 改为了空字符串，后续看看是否需要改为' '
                viewport,
                // images: await extractImages(page),
            });
        });
    }

    return {
        metadata: metadata.info,
        pages,
        filePath,
    };
}

// 按字体、字号对内容进行分组
function groupDifferentFonts(textContent) {
    const textInDifferentFonts = [];
    let lastText = null;

    textContent.items.forEach(text => {
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
            textContent.styles[lastText.fontName].textContent === textContent.styles[text.fontName].textContent // 字体相同
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

async function extractImages(page) {
    const images = [];
    const ops = await page.getOperatorList();

    // todo: 没这个pageResources
    const pageResources = page.pageResources;

    for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] === pdfjsLib.OPS.paintImageXObject) {
            const imageName = ops.argsArray[i][0];
            const xobj = await pageResources.getXObject(imageName);

            if (xobj instanceof pdfjsLib.Image) {
                const imgData = await xobj.getImageData();
                images.push({
                    width: imgData.width,
                    height: imgData.height,
                    data: imgData.data,
                    pageNumber: page.pageNumber,
                });
            }
        }
    }

    return images;
}

module.exports = parsePDF;
