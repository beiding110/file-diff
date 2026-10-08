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

const os = require('os');

const workerMultiThreading = new WorkerMultiThreading();

// 可注册的 diff worker 实例上限
const WORKER_CLASSES = [
    diffWords0, diffWords1, diffWords2, diffWords3, diffWords4,
    diffWords5, diffWords6, diffWords7, diffWords8, diffWords9,
    diffWords10, diffWords11, diffWords12, diffWords13, diffWords14,
    diffWords15, diffWords16, diffWords17, diffWords18, diffWords19,
];

function regWorker(type = 'multi') {
    // 文字对比是纯计算任务，线程数超过 CPU 核数只会带来
    // 上下文切换和每线程的内存开销，不会增加吞吐。
    // 默认按逻辑核数注册；也接受数字精确指定
    let target;

    if (typeof type === 'number') {
        target = Math.max(1, Math.min(WORKER_CLASSES.length, Math.floor(type)));
    } else if (type === 'single') {
        target = 1;
    } else {
        target = Math.max(2, Math.min(WORKER_CLASSES.length, os.cpus().length));
    }

    while (workerMultiThreading.worker.length < target) {
        // 每线程允许多个在途任务，使 worker 侧能把它们合并成一批消息，
        // 减少主线程与 worker 的往返次数（计算密集型线程的吞吐关键）
        workerMultiThreading.register(WORKER_CLASSES[workerMultiThreading.worker.length], { maxConcurrent: 70 });
    }

    if (workerMultiThreading.worker.length > target) {
        workerMultiThreading.keep(target);
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

    // 关闭文字对比线程池（进程结束前回收线程资源用）
    static shutdown() {
        workerMultiThreading.shutdown();
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

        // 参与对比的文字总量（剔除招标内容后的口径），作为文件级相似度的分母
        const sumLen = (texts) => texts.reduce((sum, textItem) => sum + textItem.text.length, 0);

        const stats = {
            totalLenA: sumLen(cleanA),
            totalLenB: sumLen(cleanB),
        };

        const { similarities, matchedLenA, matchedLenB } = await this.compareTexts(cleanA, cleanB);

        stats.matchedLenA = matchedLenA;
        stats.matchedLenB = matchedLenB;

        return { similarities, stats };
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
            // 已命中任一招标文本即被剔除，后续对比不再需要，直接剪枝。
            // 投标文件大量复制招标文件时，这一步能跳过大部分任务
            if (similarTexts.has(pa)) {
                return false;
            }

            const lengthRatio = pa.text.length / pb.text.length;

            if (!(lengthRatio >= this.options.threshold && lengthRatio <= 2 - this.options.threshold)) {
                // 句长差值过大
                return false;
            }

            return true;
        };

        // 与招标文件内容相似（达到阈值）的文本集合，最后统一剔除。
        // 以输入 texts 为基准构建结果，保证从未参与对比的文本
        // （与所有招标文本长度比都不符、被 filterFn 跳过的）不会被误删。
        // 存对象引用而非文本字符串：省内存，且 O(1) 引用比较快于字符串比较
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
                    itemA: pa,
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
            onResult: ({ itemA, similarity }) => {
                // 与任一招标文本相似度达到阈值，即认为属于招标文件内容
                if (similarity >= this.options.threshold) {
                    similarTexts.add(itemA);
                }
            },
        });

        // 只保留与招标文件内容不相似的文本
        const result = texts.filter((textItem) => !similarTexts.has(textItem));

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
                    b: pb.text,

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

        // 文件级相似度聚合：一个句块可与对面多个句块达标（cross match），
        // 直接按对求和会重复计数，按句文本去重后统计命中文字量。
        // 结果项的 a/b 是重新构造的对象，无法用引用去重，只能按文本串
        const matchedA = new Set();
        const matchedB = new Set();

        for (const { a, b } of result) {
            matchedA.add(a.text);
            matchedB.add(b.text);
        }

        const sumSetLen = (set) => {
            let sum = 0;

            for (const text of set) {
                sum += text.length;
            }

            return sum;
        };

        return {
            similarities: result,
            matchedLenA: sumSetLen(matchedA),
            matchedLenB: sumSetLen(matchedB),
        };
    }
}

module.exports = TextComparator;
