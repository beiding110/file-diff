async function parsePDF(filePath) {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const pdf = await pdfjsLib.getDocument(filePath).promise;
    const metadata = await pdf.getMetadata();

    const pages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });

        pages.push({
            pageNumber: i,
            text: textContent.items.map((item) => item.str).join('\n'),
            viewport,
            // images: await extractImages(page),
        });
    }

    return {
        metadata: metadata.info,
        pages,
        filePath,
    };
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
