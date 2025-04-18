const { Worker, parentPort, workerData, isMainThread } = require('worker_threads');

if (isMainThread) {
    const diffWorker = new Worker(__filename);

    module.exports = {
        diffWords(a, b) {
            return new Promise((resolve, reject) => {
                diffWorker.postMessage({
                    a,
                    b,
                });
    
                diffWorker.once('message', (diff) => {
                    resolve(diff);
                });
    
                diffWorker.once('error', (error) => {
                    reject(error);
                });
            });
        },
    };
} else {
    const Diff = require('diff');

    parentPort.on('message', ({ a, b }) => {
        const diff = Diff.diffWords(a, b);

        parentPort.postMessage(diff);
    });
}
