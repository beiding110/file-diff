module.exports = function (thisFileName) {
    const { Worker, parentPort, workerData, isMainThread } = require('worker_threads');

    if (isMainThread) {
        const { log } = require('../utils/log.js');

        const worker = new Worker(thisFileName);

        worker.on('error', (error) => {
            log(error);
        });

        return {
            diffWords(json) {
                return new Promise((resolve, reject) => {
                    worker.postMessage(json);

                    worker.once('message', (diff) => {
                        resolve(diff);
                    });
                });
            },
        };
    } else {
        const Diff = require('diff');
        const vectorComparator = require('../utils/vectorComparator.js');

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

        parentPort.on('message', ({ a, vectorA, b, vectorB, threshold }) => {
            if (vectorA && vectorB) {
                const vsimilarity = vectorComparator.calculateCosineSimilarity(vectorA, vectorB);

                if (vsimilarity < threshold) {
                    parentPort.postMessage({
                        similarity: vsimilarity,
                    });

                    return;
                }
            }

            const diff = Diff.diffWords(a, b);

            const res = calculateSentenceSimilarity(diff, a, b);

            parentPort.postMessage(res);
        });

        return null;
    }
};
