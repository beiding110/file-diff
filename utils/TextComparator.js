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
        workerMultiThreading.keep(1);
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

        const cleanA = await this.removeBiddingContent(sentencesA);
        const cleanB = await this.removeBiddingContent(sentencesB);

        const result = await this.compareTexts(cleanA, cleanB);

        return result;
    }

    // 清除投标文件中，招标文件部分
    async removeBiddingContent(texts, progressHandler) {
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

        // 与招标文件内容相似（达到阈值）的文本集合，最后统一剔除。
        // 以输入 texts 为基准构建结果，保证从未参与对比的文本
        // （与所有招标文本长度比都不符、被 filterFn 跳过的）不会被误删
        const similarTexts = new Set();

        // 定义任务创建函数
        const taskCreator = (pa, pb) => {
            return workerMultiThreading
                .handle({
                    a: pa.text,
                    b: pb.text,

                    threshold: this.options.threshold,
                })
                .then(({ similarity }) => ({
                    textA: pa.text,
                    similarity,
                }));
        };

        // 使用 texts.length * biddingTexts.length 作为粗略估计用于进度显示
        const estimatedTotal = texts.length * biddingTexts.length;

        // 构建进度回调（直接使用用户回调，避免 factoryProgress 嵌套导致计数错乱）
        const progressCallback = factoryProgress(estimatedTotal, progressHandler || this.removeProgressHandler);

        // 使用流式处理：onResult 回调直接更新集合，不累积结果数组
        await smartChunkProcessor.processDoubleLoop(texts, biddingTexts, taskCreator, filterFn, {
            chunkSize: 500,
            onProgress: progressCallback,
            estimatedTotal: estimatedTotal,
            onResult: ({ textA, similarity }) => {
                // 与任一招标文本相似度达到阈值，即认为属于招标文件内容
                if (similarity >= this.options.threshold) {
                    similarTexts.add(textA);
                }
            },
        });

        // 只保留与招标文件内容不相似的文本
        const result = texts.filter((textItem) => !similarTexts.has(textItem.text));

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
            return workerMultiThreading
                .handle({
                    a: pa.text,
                    pageA: pa.pageNumber,

                    b: pb.text,
                    pageB: pb.pageNumber,

                    threshold: this.options.threshold,
                })
                .then(({ a, b, similarity }) => {
                    if (similarity >= this.options.threshold) {
                        return {
                            a: {
                                text: pa.text,
                                textB: a,
                                pageNumber: pa.pageNumber,
                            },
                            b: {
                                text: pb.text,
                                textB: b,
                                pageNumber: pb.pageNumber,
                            },
                            similarity,
                        };
                    }

                    return null;
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
