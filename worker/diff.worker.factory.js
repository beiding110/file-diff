module.exports = function (thisFileName) {
    const { Worker, parentPort, workerData, isMainThread } = require('worker_threads');

    if (isMainThread) {
        const { log } = require('../utils/log.js');
        
        const worker = new Worker(thisFileName);

        worker.on('error', (error) => {
            log(error);
        });

        return {
            diffWords({ a, b }) {
                return new Promise((resolve, reject) => {
                    worker.postMessage({
                        a,
                        b,
                    });

                    worker.once('message', (diff) => {
                        resolve(diff);
                    });
                });
            },
        };
    } else {
        const Diff = require('diff');

        function calculateSentenceSimilarity(diff, a, b) {
            let sameCount = 0;

            let strA = '',
                strB = '';

            diff.forEach((part) => {
                if (part.removed) {
                    // 被移除的，属于左边
                    strA += part.value;
                } else if (part.added) {
                    // 新增的，属于右边
                    strB += part.value;
                } else {
                    // 两边相同的部分
                    sameCount += part.value.length;

                    strA += `<b>${part.value}</b>`;
                    strB += `<b>${part.value}</b>`;
                }
            });

            return {
                a: strA.replaceAll('</b><b>', ''),
                b: strB.replaceAll('</b><b>', ''),
                similarity: sameCount / Math.max(a.length, b.length),
            };
        }

        parentPort.on('message', ({ a, b }) => {
            const diff = Diff.diffWords(a, b);

            const res = calculateSentenceSimilarity(diff, a, b);

            parentPort.postMessage(res);
        });


        return null;
    }
};
