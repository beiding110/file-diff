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
const smartChunkProcessor = require('./SmartChunkProcessor.js');
const { log } = require('./log.js');

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
    constructor({
        similarity = 0.9, // 相似度目标
        minSize = 100, // 最小图片宽高，小于的不参与对比
    }) {
        this.options = {
            similarity,
            minSize,
        };

        this.processHandler = null;
    }

    static regWorker = regWorker;

    async compareImages(bidA, bidB) {
        log('ImageComparator.js', 'compareImages', '开始对比图片');

        // 定义过滤函数
        const filterFn = (imgA, imgB) => {
            const { width: widthA, height: heightA } = imgA;
            const { width: widthB, height: heightB } = imgB;

            // 图片尺寸小于最小尺寸，跳过
            if (
                widthA < this.options.minSize ||
                heightA < this.options.minSize ||
                widthB < this.options.minSize ||
                heightB < this.options.minSize
            ) {
                return false;
            }

            const sizeRatio = heightA / widthA / (heightB / widthB);

            // 尺寸比例相差过大，跳过
            if (sizeRatio < this.options.similarity || sizeRatio > 2 - this.options.similarity) {
                return false;
            }

            return true;
        };

        // 定义任务创建函数
        const taskCreator = (imgA, imgB) => {
            const { pageNumber: pageA, imageHash: imageHashA } = imgA;
            const { pageNumber: pageB, imageHash: imageHashB } = imgB;

            return new Promise((resolve) => {
                workerMultiThreading
                    .handle({
                        hashA: imageHashA,
                        hashB: imageHashB,
                        pageA,
                        pageB,
                    })
                    .then((similarity) => {
                        if (similarity > this.options.similarity) {
                            resolve({
                                images: [imgA.image, imgB.image],
                                pages: [imgA.pageNumber, imgB.pageNumber],
                                similarity,
                            });
                        } else {
                            resolve(null);
                        }
                    });
            });
        };

        // 统计任务总数（用于进度条）
        let totalTasks = 0;
        for (const imgA of bidA) {
            for (const imgB of bidB) {
                if (filterFn(imgA, imgB)) {
                    totalTasks++;
                }
            }
        }

        // 构建进度回调
        const progressCallback = factoryProgress(totalTasks, this.processHandler);

        // 使用流式处理
        const result = await smartChunkProcessor.processDoubleLoop(bidA, bidB, taskCreator, filterFn, {
            chunkSize: 500,
            onProgress: progressCallback,
            estimatedTotal: totalTasks,
        });

        log('ImageComparator.js', 'compareImages', '对比图片结束：', result.length);

        return result;
    }
}

module.exports = ImageComparator;
