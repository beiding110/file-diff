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

            if (!(lengthRatio >= this.options.threshold && lengthRatio <= 2 - this.options.threshold)) {
                // 句长差值过大
                return false;
            }

            return true;
        };

        // 流式处理：使用 Map 跟踪每个文本的最大相似度
        const textSimilarityMap = new Map();

        // 定义任务创建函数
        const taskCreator = (pa, pb) => {
            return new Promise((resolve) => {
                workerMultiThreading
                    .handle({
                        a: pa.text,
                        pageA: pa.pageNumber,
                        vectorA: pa.vector,

                        b: pb.text,
                        pageB: pb.pageNumber,
                        vectorB: pb.vector,

                        threshold: this.options.threshold,
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

        // 使用 texts.length * biddingTexts.length 作为粗略估计用于进度显示
        const estimatedTotal = texts.length * biddingTexts.length;

        // 构建进度回调（使用估计值）
        const progressCallback = factoryProgress(estimatedTotal, progress);

        // 使用流式处理：onResult 回调直接更新 Map，不累积结果数组
        await smartChunkProcessor.processDoubleLoop(texts, biddingTexts, taskCreator, filterFn, {
            chunkSize: 500,
            onProgress: progressCallback,
            estimatedTotal: estimatedTotal,
            onResult: (comparison) => {
                // 流式处理：立即更新 Map，不存储所有比较结果
                const key = `${comparison.pageA}<_>${comparison.textA}`;

                if (!textSimilarityMap.has(key)) {
                    textSimilarityMap.set(key, comparison.similarity);
                } else {
                    // 保留最大相似度
                    const currentMax = textSimilarityMap.get(key);
                    if (comparison.similarity > currentMax) {
                        textSimilarityMap.set(key, comparison.similarity);
                    }
                }
            },
        });

        // 根据 Map 构建结果：只保留没有相似度的文本
        const result = [];
        const seenKeys = new Set();

        for (const [key, maxSimilarity] of textSimilarityMap) {
            // 只保留没有相似度的文本，且每个文本只保留一次
            if (maxSimilarity < this.options.threshold && !seenKeys.has(key)) {
                const [page, text] = key.split('<_>');
                result.push({
                    text: text,
                    pageNumber: parseInt(page, 10),
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

            if (!(lengthRatio >= this.options.threshold && lengthRatio <= 2 - this.options.threshold)) {
                // 句长差值过大
                return false;
            }

            return true;
        };

        // 定义任务创建函数
        const taskCreator = (pa, pb) => {
            const threadItem = {
                a: pa.text,
                pageA: pa.pageNumber,
                vectorA: pa.vector,

                b: pb.text,
                pageB: pb.pageNumber,
                vectorB: pb.vector,

                threshold: this.options.threshold,
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

        // 移除预先统计：使用粗略估计
        const estimatedTotal = sentencesA.length * sentencesB.length;

        // 构建进度回调
        const progressCallback = factoryProgress(estimatedTotal, this.progressHandler);

        // 使用较小的 chunkSize 降低内存峰值
        const result = await smartChunkProcessor.processDoubleLoop(sentencesA, sentencesB, taskCreator, filterFn, {
            chunkSize: 200,
            onProgress: progressCallback,
            estimatedTotal: estimatedTotal,
        });

        log('TextComparator.js', 'compareTexts', '对比文字完毕：', result.length);

        return result;
    }
}

module.exports = TextComparator;
