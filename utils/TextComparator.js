const { diffWords: diffWords0 } = require('../worker/diff.work.0.js');
const { diffWords: diffWords1 } = require('../worker/diff.work.1.js');
const { diffWords: diffWords2 } = require('../worker/diff.work.2.js');
const { diffWords: diffWords3 } = require('../worker/diff.work.3.js');
const { diffWords: diffWords4 } = require('../worker/diff.work.4.js');
const { diffWords: diffWords5 } = require('../worker/diff.work.5.js');

const factoryProgress = require('./factoryProgress.js');
const WorkerMultiThreading = require('./WorkerMultiThreading.js');

const workerMultiThreading = new WorkerMultiThreading();

workerMultiThreading.register(diffWords0);
workerMultiThreading.register(diffWords1);
workerMultiThreading.register(diffWords2);
workerMultiThreading.register(diffWords3);
workerMultiThreading.register(diffWords4);
workerMultiThreading.register(diffWords5);

class TextComparator {
    constructor(biddingContent, options = {}) {
        this.biddingContent = biddingContent;

        this.options = {
            threshold: 0.7,
            minLength: 10,
            ...options,
        };

        // 对比进度
        this.progressHandler = null;
    }

    async findSimilarities(textsA, textsB) {
        const sentencesA = textsA.filter((textItem) => {
            return textItem.text.length >= this.options.minLength;
        });

        const sentencesB = textsB.filter((textItem) => {
            return textItem.text.length >= this.options.minLength;
        });

        const cleanA = await this.removeBiddingContent(sentencesA);
        const cleanB = await this.removeBiddingContent(sentencesB);

        const result = await this.compareTexts(cleanA, cleanB);

        return result;
    }

    // 清除投标文件中，招标文件部分
    async removeBiddingContent(texts) {
        if (!this.biddingContent) {
            return texts;
        }

        const clearedArr = [];
        const { texts: biddingTexts } = this.biddingContent;

        for (let textItem of texts) {
            let { text: bidText } = textItem;

            let allBiddingTextsNotSimilarToTextIem = true;

            for (let { text: biddingText } of biddingTexts) {
                const { similarity } = await diffWords({ a: biddingText, b: bidText });

                if (similarity >= this.options.threshold) {
                    // 只要投标文件中有任意句段与招标文件中的任意句段相似，则直接列入带比较列队，同时不再与剩余招标文件中的句段继续比对
                    allBiddingTextsNotSimilarToTextIem = false;

                    break;
                }
            }

            if (allBiddingTextsNotSimilarToTextIem) {
                clearedArr.push(textItem);
            }
        }

        return clearedArr;
    }

    async compareTexts(sentencesA, sentencesB) {
        const threadList = [];

        // 构建任务列表
        for (let pa of sentencesA) {
            for (let pb of sentencesB) {
                threadList.push({ a: pa.text, b: pb.text, pageA: pa.pageNumber, pageB: pb.pageNumber });
            }
        }

        // 构建进度回调
        let progress = factoryProgress(threadList.length, this.progressHandler);

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

        return result.filter((item) => item);
    }
}

module.exports = TextComparator;
