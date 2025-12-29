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
const smartChunkProcessor = require('./SmartChunkProcessor.js');
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
            log('TextComparator.js', 'removeBiddingContent', '没有检测到招标文件，无需排除内容');

            return texts;
        }

        log('TextComparator.js', 'removeBiddingContent', '开始排除文字');

        const { texts: biddingTexts } = this.biddingContent;

        // 定义过滤函数
        const filterFn = (pa, pb) => {
            const lengthRatio = pa.text.length / pb.text.length;
            return lengthRatio >= this.options.threshold && lengthRatio <= 2 - this.options.threshold;
        };

        // 定义任务创建函数
        const taskCreator = (pa, pb) => {
            return new Promise((resolve) => {
                workerMultiThreading
                    .handle({
                        a: pa.text,
                        pageA: pa.pageNumber,
                        b: pb.text,
                        pageB: pb.pageNumber,
                    })
                    .then(({ similarity }) => {
                        // 返回比对结果
                        resolve({
                            textA: pa.text,
                            pageA: pa.pageNumber,
                            similarity,
                        });
                    });
            });
        };

        // 统计任务总数（用于进度条）
        let totalTasks = 0;
        for (const pa of texts) {
            for (const pb of biddingTexts) {
                if (filterFn(pa, pb)) {
                    totalTasks++;
                }
            }
        }

        // 构建进度回调
        const progressCallback = factoryProgress(totalTasks, progress);

        // 使用流式处理获取所有比对结果
        const allComparisons = await smartChunkProcessor.processDoubleLoop(texts, biddingTexts, taskCreator, filterFn, {
            chunkSize: 500,
            onProgress: progressCallback,
            estimatedTotal: totalTasks,
        });

        // 按投标文本分组，找出没有与任何招标文本相似的文本
        const textSimilarityMap = new Map();

        for (const comparison of allComparisons) {
            const key = `${comparison.pageA}_${comparison.textA}`;

            if (!textSimilarityMap.has(key)) {
                textSimilarityMap.set(key, false);
            }

            // 如果发现相似度达标，标记为 true
            if (comparison.similarity >= this.options.threshold) {
                textSimilarityMap.set(key, true);
            }
        }

        // 过滤出没有相似度的文本
        const result = [];
        const seenKeys = new Set();

        for (const comparison of allComparisons) {
            const key = `${comparison.pageA}_${comparison.textA}`;

            // 只保留没有相似度的文本，且每个文本只保留一次
            if (!textSimilarityMap.get(key) && !seenKeys.has(key)) {
                result.push({
                    text: comparison.textA,
                    pageNumber: comparison.pageA,
                });
                seenKeys.add(key);
            }
        }

        log('TextComparator.js', 'removeBiddingContent', '排除文字完毕：', result.length);

        return result;
    }

    async compareTexts(sentencesA, sentencesB) {
        log('TextComparator.js', 'compareTexts', '开始对比文字');

        // 定义过滤函数
        const filterFn = (pa, pb) => {
            const lengthRatio = pa.text.length / pb.text.length;
            return lengthRatio >= this.options.threshold && lengthRatio <= 2 - this.options.threshold;
        };

        // 定义任务创建函数
        const taskCreator = (pa, pb) => {
            const threadItem = {
                a: pa.text,
                b: pb.text,
                pageA: pa.pageNumber,
                pageB: pb.pageNumber,
            };

            return new Promise((resolve) => {
                workerMultiThreading.handle(threadItem).then(({ a, b, similarity }) => {
                    if (similarity >= this.options.threshold) {
                        resolve({
                            a: {
                                text: threadItem.a,
                                textB: a,
                                pageNumber: threadItem.pageA,
                            },
                            b: {
                                text: threadItem.b,
                                textB: b,
                                pageNumber: threadItem.pageB,
                            },
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
        for (const pa of sentencesA) {
            for (const pb of sentencesB) {
                if (filterFn(pa, pb)) {
                    totalTasks++;
                }
            }
        }

        // 构建进度回调
        const progressCallback = factoryProgress(totalTasks, this.progressHandler);

        // 使用流式处理
        const result = await smartChunkProcessor.processDoubleLoop(sentencesA, sentencesB, taskCreator, filterFn, {
            chunkSize: 1000,
            onProgress: progressCallback,
            estimatedTotal: totalTasks,
        });

        log('TextComparator.js', 'compareTexts', '对比文字完毕：', result.length);

        return result;
    }
}

module.exports = TextComparator;
