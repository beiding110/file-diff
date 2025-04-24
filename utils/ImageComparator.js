const { compareImg: compareImg0 } = require('../worker/sharp.worker.0.js');
const { compareImg: compareImg1 } = require('../worker/sharp.worker.1.js');
const { compareImg: compareImg2 } = require('../worker/sharp.worker.2.js');
const { compareImg: compareImg3 } = require('../worker/sharp.worker.3.js');
const { compareImg: compareImg4 } = require('../worker/sharp.worker.4.js');
const { compareImg: compareImg5 } = require('../worker/sharp.worker.5.js');

const factoryProgress = require('./factoryProgress.js');
const WorkerMultiThreading = require('./WorkerMultiThreading.js');

const workerMultiThreading = new WorkerMultiThreading();

workerMultiThreading.register(compareImg0);
workerMultiThreading.register(compareImg1);
workerMultiThreading.register(compareImg2);
workerMultiThreading.register(compareImg3);
workerMultiThreading.register(compareImg4);
workerMultiThreading.register(compareImg5);

class ImageComparator {
    static SIMILARITY = 0.9;
    static RESIZE = { width: 300 };

    static processHandler = null;

    static async compareImages(bidA, bidB) {
        const threadList = [];

        // 构建任务列表
        for (const imgA of bidA) {
            for (const imgB of bidB) {
                let { image: imageA, pageNumber: pageNumberA } = imgA;
                let { image: imageB, pageNumber: pageNumberB } = imgB;

                threadList.push({
                    imgA: imageA,
                    imgB: imageB,
                    resize: this.RESIZE,
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

                        if (similarity > this.SIMILARITY) {
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
