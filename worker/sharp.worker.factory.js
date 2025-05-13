module.exports = function(thisFileName) {
    const { Worker, parentPort, workerData, isMainThread } = require('worker_threads');
    
    if (isMainThread) {
        const { log } = require('../utils/log.js');
        
        const worker = new Worker(thisFileName);
    
        worker.on('error', (error) => {
            log(error);
        });
    
        return {
            compareImg({ imgA, imgB, resize }) {
                return new Promise((resolve, reject) => {
                    worker.postMessage({
                        imgA,
                        imgB,
                        resize,
                    });
    
                    worker.once('message', (diff) => {
                        resolve(diff);
                    });
                });
            },
        };
    } else {
        const sharp = require('sharp');
    
        async function getImageHash(imageBuffer, resize) {
            try {
                const resized = await sharp(imageBuffer).resize(resize).grayscale().raw().toBuffer();
    
                const avg = resized.reduce((sum, val) => sum + val, 0) / resized.length;
    
                return resized.map((val) => (val > avg ? '1' : '0')).join('');
            } catch (error) {
                console.log(error);
                return '';
            }
        }
    
        function compareHashes(hashA, hashB) {
            let distance = 0;
    
            for (let i = 0; i < hashA.length; i++) {
                if (hashA[i] === hashB[i]) {
                    distance++;
                }
            }
    
            return distance / Math.max(hashA.length, hashB.length);
        }
    
        parentPort.on('message', async ({ imgA, imgB, resize }) => {
            const hashA = await getImageHash(imgA, resize);
            const hashB = await getImageHash(imgB, resize);
    
            const similarity = compareHashes(hashA, hashB);
    
            parentPort.postMessage(similarity);
        });

        return null;
    }
}