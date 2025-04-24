const { diffWords } = require('../worker/diff.work.0.js');
const { diffWords: diffWords2 } = require('../worker/diff.work.1.js');

const WorkerMultiThreading = require('../utils/WorkerMultiThreading.js');

const workerMultiThreading = new WorkerMultiThreading();
workerMultiThreading.register(diffWords);
// workerMultiThreading.register(diffWords2);

console.time();

for (let i = 0; i < 1000; i++) {
    workerMultiThreading
        .handle({
            a: 'restaurant',
            b: 'aura',
        })
        .then((res) => {
            // console.log(i);

            if (i >= 999) {
                console.timeEnd();
            }
        });
}
