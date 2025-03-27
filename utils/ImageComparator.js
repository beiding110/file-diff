const sharp = require('sharp');
const factoryProgress = require('./factoryProgress.js');

const SIMILARITY = 0.9;
const RESIZE = { width: 300 };

class ImageComparator {
    static processHandler = null;

    static async getImageHash(imageBuffer) {
        try {
            const resized = await sharp(imageBuffer).resize(RESIZE).grayscale().raw().toBuffer();

            const avg = resized.reduce((sum, val) => sum + val, 0) / resized.length;

            return resized.map((val) => (val > avg ? '1' : '0')).join('');
        } catch (error) {
            console.log(error);
            return '';
        }
    }

    static compareHashes(hashA, hashB) {
        let distance = 0;

        for (let i = 0; i < hashA.length; i++) {
            if (hashA[i] === hashB[i]) {
                distance++;
            }
        }
        return distance / Math.max(hashA.length, hashB.length);
    }

    static async compareImages(bidA, bidB) {
        const matches = [];

        let progress = factoryProgress(bidA.length * bidB.length, this.processHandler);

        for (const imgA of bidA) {
            for (const imgB of bidB) {
                let { image: imageA, pageNumber: pageNumberA } = imgA;
                let { image: imageB, pageNumber: pageNumberB } = imgB;

                const similarity = this.compareHashes(await this.getImageHash(imageA), await this.getImageHash(imageB));

                if (similarity > SIMILARITY) {
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
