module.exports = function (thisFileName) {
    const { Worker, parentPort, workerData, isMainThread } = require('worker_threads');

    if (isMainThread) {
        const { log } = require('../utils/log.js');

        const worker = new Worker(thisFileName);

        // 当前挂起任务的 reject；worker 崩溃/退出时用于释放调用方
        let pendingReject = null;
        let deadCallback = null;

        worker.on('error', (error) => {
            log('sharp.worker error:', error && (error.stack || error.message));

            if (pendingReject) {
                pendingReject(error instanceof Error ? error : new Error(String(error)));
                pendingReject = null;
            }
        });

        worker.on('exit', (code) => {
            if (pendingReject) {
                pendingReject(new Error(`sharp.worker 意外退出，exit code: ${code}`));
                pendingReject = null;
            }

            if (typeof deadCallback === 'function') {
                deadCallback();
            }
        });

        return {
            compareImg(json) {
                return new Promise((resolve, reject) => {
                    pendingReject = reject;

                    worker.postMessage(json);

                    worker.once('message', (similarity) => {
                        pendingReject = null;

                        if (similarity && similarity.__error) {
                            reject(new Error(similarity.message));
                            return;
                        }

                        resolve(similarity);
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
        // 计算两个哈希串的相似度：相同位数 / 较长哈希的位数
        function compareHashes(hashA, hashB) {
            if (!hashA || !hashB) {
                return 0;
            }

            const length = Math.max(hashA.length, hashB.length);

            let sameCount = 0;

            for (let i = 0; i < length; i++) {
                if (hashA[i] === hashB[i]) {
                    sameCount++;
                }
            }

            return sameCount / length;
        }

        parentPort.on('message', ({ hashA, hashB }) => {
            try {
                const similarity = compareHashes(hashA, hashB);

                parentPort.postMessage(similarity);
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
