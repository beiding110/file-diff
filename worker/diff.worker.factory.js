module.exports = function (thisFileName) {
    const { Worker, parentPort, workerData, isMainThread } = require('worker_threads');

    if (isMainThread) {
        const { log } = require('../utils/log.js');

        const worker = new Worker(thisFileName);

        // 当前挂起任务的 reject；worker 崩溃/退出时用于释放调用方
        let pendingReject = null;
        let deadCallback = null;

        worker.on('error', (error) => {
            log('diff.worker error:', error && (error.stack || error.message));

            if (pendingReject) {
                pendingReject(error instanceof Error ? error : new Error(String(error)));
                pendingReject = null;
            }
        });

        worker.on('exit', (code) => {
            if (pendingReject) {
                pendingReject(new Error(`diff.worker 意外退出，exit code: ${code}`));
                pendingReject = null;
            }

            if (typeof deadCallback === 'function') {
                deadCallback();
            }
        });

        return {
            diffWords(json) {
                return new Promise((resolve, reject) => {
                    pendingReject = reject;

                    worker.postMessage(json);

                    worker.once('message', (diff) => {
                        pendingReject = null;

                        if (diff && diff.__error) {
                            reject(new Error(diff.message));
                            return;
                        }

                        resolve(diff);
                    });
                });
            },
            // 终止 worker 线程
            terminate() {
                return worker.terminate();
            },
            // 线程退出（含主动 terminate）后的回调，供线程池移除引用
            onDead(cb) {
                deadCallback = cb;
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

        // 向量缓存：同一段文字会与多段文字比较，避免重复计算字符频率
        const vectorCache = new Map();
        const VECTOR_CACHE_MAX = 20000;

        function getVectorCached(str) {
            if (vectorCache.has(str)) {
                return vectorCache.get(str);
            }

            const vector = vectorComparator.getVector(str);

            if (vectorCache.size >= VECTOR_CACHE_MAX) {
                vectorCache.clear();
            }

            vectorCache.set(str, vector);

            return vector;
        }

        parentPort.on('message', ({ a, b, threshold }) => {
            try {
                const vectorA = getVectorCached(a);
                const vectorB = getVectorCached(b);
                const vsimilarity = vectorComparator.calculateCosineSimilarity(vectorA, vectorB);

                if (vsimilarity < threshold) {
                    parentPort.postMessage({
                        similarity: vsimilarity,
                    });

                    return;
                }

                const diff = Diff.diffWords(a, b);

                parentPort.postMessage(calculateSentenceSimilarity(diff, a, b));
            } catch (error) {
                // 回传错误，避免线程崩溃导致主线程调用方永久挂起
                parentPort.postMessage({
                    __error: true,
                    message: error && (error.stack || error.message),
                });
            }
        });

        return null;
    }
};
