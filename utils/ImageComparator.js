const sharp = require('sharp');
const factoryProgress = require('./factoryProgress.js');

class ImageComparator {
    static processHandler = null

    static async getImageHash(imageBuffer) {
        try {
            const resized = await sharp(imageBuffer).resize(8, 8).grayscale().raw().toBuffer();

            const avg = resized.reduce((sum, val) => sum + val, 0) / resized.length;
            return resized.map((val) => (val > avg ? '1' : '0')).join('');
        } catch (error) {
            return '';
        }
    }

    static compareHashes(hashA, hashB) {
        let distance = 0;

        for (let i = 0; i < hashA.length; i++) {
            if (hashA[i] !== hashB[i]) distance++;
        }
        return 1 - distance / hashA.length;
    }

    static async compareImages(bidA, bidB) {
        const matches = [];

        let progress = factoryProgress(bidA.length * bidB.length, this.processHandler);

        for (const imgA of bidA.flatMap((p) => p.image)) {
            for (const imgB of bidB.flatMap((p) => p.image)) {
                const similarity = this.compareHashes(await this.getImageHash(imgA), await this.getImageHash(imgB));

                if (similarity > 0.9) {
                    matches.push({
                        pages: [imgA.pageNumber, imgB.pageNumber],
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
