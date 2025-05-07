const { compareImg: compareImg0 } = require('../worker/sharp.worker.0.js');
const { compareImg: compareImg1 } = require('../worker/sharp.worker.1.js');
const { compareImg: compareImg2 } = require('../worker/sharp.worker.2.js');
const { compareImg: compareImg3 } = require('../worker/sharp.worker.3.js');
const { compareImg: compareImg4 } = require('../worker/sharp.worker.4.js');
const { compareImg: compareImg5 } = require('../worker/sharp.worker.5.js');
const { compareImg: compareImg6 } = require('../worker/sharp.worker.6.js');
const { compareImg: compareImg7 } = require('../worker/sharp.worker.7.js');
const { compareImg: compareImg8 } = require('../worker/sharp.worker.8.js');
const { compareImg: compareImg9 } = require('../worker/sharp.worker.9.js');
const { compareImg: compareImg10 } = require('../worker/sharp.worker.10.js');
const { compareImg: compareImg11 } = require('../worker/sharp.worker.11.js');
const { compareImg: compareImg12 } = require('../worker/sharp.worker.12.js');
const { compareImg: compareImg13 } = require('../worker/sharp.worker.13.js');
const { compareImg: compareImg14 } = require('../worker/sharp.worker.14.js');
const { compareImg: compareImg15 } = require('../worker/sharp.worker.15.js');
const { compareImg: compareImg16 } = require('../worker/sharp.worker.16.js');
const { compareImg: compareImg17 } = require('../worker/sharp.worker.17.js');
const { compareImg: compareImg18 } = require('../worker/sharp.worker.18.js');
const { compareImg: compareImg19 } = require('../worker/sharp.worker.19.js');

const factoryProgress = require('./factoryProgress.js');
const WorkerMultiThreading = require('./WorkerMultiThreading.js');

const workerMultiThreading = new WorkerMultiThreading();

function regWorker(type = 'multi') {
    if (!workerMultiThreading.worker.length) {
        workerMultiThreading.register(compareImg0);
    }

    if (type === 'multi' && workerMultiThreading.worker.length === 1) {
        workerMultiThreading.register(compareImg1);
        workerMultiThreading.register(compareImg2);
        workerMultiThreading.register(compareImg3);
        workerMultiThreading.register(compareImg4);
        workerMultiThreading.register(compareImg5);
        workerMultiThreading.register(compareImg6);
        workerMultiThreading.register(compareImg7);
        workerMultiThreading.register(compareImg8);
        workerMultiThreading.register(compareImg9);
        workerMultiThreading.register(compareImg10);
        workerMultiThreading.register(compareImg11);
        workerMultiThreading.register(compareImg12);
        workerMultiThreading.register(compareImg13);
        workerMultiThreading.register(compareImg14);
        workerMultiThreading.register(compareImg15);
        workerMultiThreading.register(compareImg16);
        workerMultiThreading.register(compareImg17);
        workerMultiThreading.register(compareImg18);
        workerMultiThreading.register(compareImg19);
    }

    if (type === 'single' && workerMultiThreading.worker.length > 1) {
        workerMultiThreading.logoff(1);
    }
}

regWorker('multi');

class ImageComparator {
    constructor({ similarity = 0.9, resizeWidth = 300 }) {
        this.options = {
            similarity,
            resize: { width: resizeWidth },
        };

        this.processHandler = null;
    }

    static regWorker = regWorker;

    async compareImages(bidA, bidB) {
        const threadList = [];

        // 构建任务列表
        // todo: 先过滤一遍，长度相差太多就过滤掉
        // todo: 保证列队中不超过100个
        for (const imgA of bidA) {
            for (const imgB of bidB) {
                let { image: imageA, pageNumber: pageNumberA } = imgA;
                let { image: imageB, pageNumber: pageNumberB } = imgB;

                threadList.push({
                    imgA: imageA,
                    imgB: imageB,
                    resize: this.options.resize,
                    pageA: pageNumberA,
                    pageB: pageNumberB,
                });
            }
        }

        // 构建进度回调
        let progress = factoryProgress(threadList.length, this.processHandler);

        // 处理任务
        const result = await Promise.all(
            threadList.map((threadItem) => {
                return new Promise((resolve) => {
                    workerMultiThreading.handle(threadItem).then((similarity) => {
                        progress();

                        if (similarity > this.options.similarity) {
                            resolve({
                                images: [threadItem.imgA, threadItem.imgB],
                                pages: [threadItem.pageA, threadItem.pageB],
                                similarity,
                            });
                        } else {
                            resolve(null);
                        }
                    });
                });
            })
        );

        return result.filter((item) => item);
    }
}

module.exports = ImageComparator;
