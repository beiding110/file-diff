const { compareImg } = require('../worker/sharp.worker.js');
const factoryProgress = require('./factoryProgress.js');

class ImageComparator {
    static SIMILARITY = 0.9;
    static RESIZE = { width: 300 };

    static processHandler = null;

    static async compareImages(bidA, bidB) {
        const matches = [];

        let progress = factoryProgress(bidA.length * bidB.length, this.processHandler);

        for (const imgA of bidA) {
            for (const imgB of bidB) {
                let { image: imageA, pageNumber: pageNumberA } = imgA;
                let { image: imageB, pageNumber: pageNumberB } = imgB;

                const similarity = await compareImg({ imgA: imageA, imgB: imageB, resize: this.RESIZE });

                if (similarity > this.SIMILARITY) {
                    matches.push({
                        images: [imageA, imageB],
                        pages: [pageNumberA, pageNumberB],
                        similarity,
                    });
                }

                progress();
            }
        }

        return matches;
    }
}

module.exports = ImageComparator;
