const { diffWords: diffWords0 } = require('../worker/diff.worker.0.js');
const { diffWords: diffWords1 } = require('../worker/diff.worker.1.js');
const { diffWords: diffWords2 } = require('../worker/diff.worker.2.js');
const { diffWords: diffWords3 } = require('../worker/diff.worker.3.js');
const { diffWords: diffWords4 } = require('../worker/diff.worker.4.js');
const { diffWords: diffWords5 } = require('../worker/diff.worker.5.js');
const { diffWords: diffWords6 } = require('../worker/diff.worker.6.js');
const { diffWords: diffWords7 } = require('../worker/diff.worker.7.js');
const { diffWords: diffWords8 } = require('../worker/diff.worker.8.js');
const { diffWords: diffWords9 } = require('../worker/diff.worker.9.js');
const { diffWords: diffWords10 } = require('../worker/diff.worker.10.js');
const { diffWords: diffWords11 } = require('../worker/diff.worker.11.js');
const { diffWords: diffWords12 } = require('../worker/diff.worker.12.js');
const { diffWords: diffWords13 } = require('../worker/diff.worker.13.js');
const { diffWords: diffWords14 } = require('../worker/diff.worker.14.js');
const { diffWords: diffWords15 } = require('../worker/diff.worker.15.js');
const { diffWords: diffWords16 } = require('../worker/diff.worker.16.js');
const { diffWords: diffWords17 } = require('../worker/diff.worker.17.js');
const { diffWords: diffWords18 } = require('../worker/diff.worker.18.js');
const { diffWords: diffWords19 } = require('../worker/diff.worker.19.js');

const factoryProgress = require('./factoryProgress.js');
const WorkerMultiThreading = require('./WorkerMultiThreading.js');
const { log } = require('./log.js');

const workerMultiThreading = new WorkerMultiThreading();

function regWorker(type = 'multi') {
    if (!workerMultiThreading.worker.length) {
        workerMultiThreading.register(diffWords0);
    }

    if (type === 'multi' && workerMultiThreading.worker.length === 1) {
        workerMultiThreading.register(diffWords1);
        workerMultiThreading.register(diffWords2);
        workerMultiThreading.register(diffWords3);
        workerMultiThreading.register(diffWords4);
        workerMultiThreading.register(diffWords5);
        workerMultiThreading.register(diffWords6);
        workerMultiThreading.register(diffWords7);
        workerMultiThreading.register(diffWords8);
        workerMultiThreading.register(diffWords9);
        workerMultiThreading.register(diffWords10);
        workerMultiThreading.register(diffWords11);
        workerMultiThreading.register(diffWords12);
        workerMultiThreading.register(diffWords13);
        workerMultiThreading.register(diffWords14);
        workerMultiThreading.register(diffWords15);
        workerMultiThreading.register(diffWords16);
        workerMultiThreading.register(diffWords17);
        workerMultiThreading.register(diffWords18);
        workerMultiThreading.register(diffWords19);
    }

    if (type === 'single' && workerMultiThreading.worker.length > 1) {
        workerMultiThreading.logoff(1);
    }
}

regWorker('multi');

class TextComparator {
    constructor(biddingContent, options = {}) {
        this.biddingContent = biddingContent;

        this.options = {
            threshold: 0.7,
            minLength: 10,
            ...options,
        };

        // 移除招标文件内容进度
        this.removeProgressHandler = null;
        // 对比进度
        this.progressHandler = null;
    }

    static regWorker = regWorker;

    async findSimilarities(textsA, textsB) {
        const sentencesA = textsA.filter((textItem) => {
            return textItem.text.length >= this.options.minLength;
        });

        const sentencesB = textsB.filter((textItem) => {
            return textItem.text.length >= this.options.minLength;
        });

        let progress = factoryProgress(sentencesA.length + sentencesB.length, this.removeProgressHandler);

        const cleanA = await this.removeBiddingContent(sentencesA, progress);
        const cleanB = await this.removeBiddingContent(sentencesB, progress);

        const result = await this.compareTexts(cleanA, cleanB);

        return result;
    }

    // 清除投标文件中，招标文件部分
    async removeBiddingContent(texts, progress) {
        if (!this.biddingContent) {
            return texts;
        }

        const clearedArr = [];
        const { texts: biddingTexts } = this.biddingContent;

        for (let textItem of texts) {
            let { text: bidText } = textItem;

            let allBiddingTextsNotSimilarToTextIem = true;

            for (let { text: biddingText } of biddingTexts) {
                const lengthRatio = biddingText.length / bidText.length;

                // 先过滤一遍，长度相差太多就过滤掉
                if (
                    lengthRatio < this.options.threshold 
                    || lengthRatio > (2 - this.options.threshold)
                ) {
                    continue;
                }

                const { similarity } = await workerMultiThreading.handle({ a: biddingText, b: bidText });

                if (similarity >= this.options.threshold) {
                    // 只要投标文件中有任意句段与招标文件中的任意句段相似，则直接列入带比较列队，同时不再与剩余招标文件中的句段继续比对
                    allBiddingTextsNotSimilarToTextIem = false;

                    break;
                }
            }

            if (allBiddingTextsNotSimilarToTextIem) {
                clearedArr.push(textItem);
            }

            progress && progress();
        }

        return clearedArr;
    }

    async compareTexts(sentencesA, sentencesB) {
        const threadList = [];

        log('TextComparator.js', 'compareTexts', '即将生成任务列队');

        // 构建任务列表
        // todo: 保证列队中不超过100个
        for (let pa of sentencesA) {
            for (let pb of sentencesB) {
                const lengthRatio = pa.text.length / pb.text.length;

                // 先过滤一遍，长度相差太多就过滤掉
                if (
                    lengthRatio < this.options.threshold 
                    || lengthRatio > (2 - this.options.threshold)
                ) {
                    continue;
                }

                threadList.push({ a: pa.text, b: pb.text, pageA: pa.pageNumber, pageB: pb.pageNumber });
            }
        }

        log('TextComparator.js', 'compareTexts', '生成任务列队完毕：', threadList.length);

        // 构建进度回调
        let progress = factoryProgress(threadList.length, this.progressHandler);

        log('TextComparator.js', 'compareTexts', '开始对比文字');

        // 处理任务
        const result = await Promise.all(
            threadList.map((threadItem) => {
                return new Promise((resolve) => {
                    workerMultiThreading.handle(threadItem).then(({ a, b, similarity }) => {
                        progress();

                        if (similarity >= this.options.threshold) {
                            resolve({
                                a: {
                                    text: threadItem.a,
                                    textB: a,
                                    pageNumber: threadItem.pageA,
                                    // viewport: pa.viewport,
                                },
                                b: {
                                    text: threadItem.b,
                                    textB: b,
                                    pageNumber: threadItem.pageB,
                                    // viewport: pb.viewport,
                                },
                                similarity,
                            });
                        } else {
                            resolve(null);
                        }
                    });
                });
            })
        );

        log('TextComparator.js', 'compareTexts', '对比文字完毕：', result.length);

        return result.filter((item) => item);
    }
}

module.exports = TextComparator;
