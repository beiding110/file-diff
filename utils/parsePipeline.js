const path = require('path');
const CacheFile = require('./CacheFile.js');
const parseResources = require('./parseResources.js');
const { isTocLine } = require('./tocLineFilter.js');

// ---- 分片进度聚合 ----
// worker 侧只上报片内事实（shard/done/shards/numPages），文件级的聚合值
// （全局已完成页数、进度、剩余时间）单个分片算不了——各片并行、互不知晓，
// 只有主线程能看到全部分片的事件流，因此在这里汇总后随明细一并发给外层，
// 类库对外即输出完整可用的进度信息：明细供分片粒度的可视化（如散点图），
// 聚合值供直接展示，外层无需再做任何计算。
// 状态按 filePath 分组，多文件并行解析互不干扰；每次 parseFile 开始时重置，
// 同一文件再次冷解析不会带上上次的计数
const _shardProgress = new Map(); // filePath -> { doneByShard: Map<shard, done>, numPages, startTime }

function resetShardProgress(filePath) {
    _shardProgress.delete(filePath);
}

/**
 * 汇总单条分片进度，输出带聚合值的完整进度事件
 * @param {Object} info worker 上报的片内事实 { filePath, shard, shards, done, numPages }
 * @returns {Object} 对外进度事件：明细原样透传，外加聚合值 doneAll/progress/remain
 */
function aggregateShardProgress({ filePath, shard, shards, done, numPages }) {
    let state = _shardProgress.get(filePath);

    if (!state) {
        state = { doneByShard: new Map(), numPages, startTime: Date.now() };
        _shardProgress.set(filePath, state);
    }

    // 分片上报的是片内累计值而非增量，覆盖写即最新计数
    state.doneByShard.set(shard, done);

    const doneAll = [...state.doneByShard.values()].reduce((sum, n) => sum + n, 0);

    // 剩余时间估算：均摊每页耗时 × 剩余页数，基于聚合后的总完成数——
    // 分片速度不均时不会被最快的片带偏
    const elapsed = Date.now() - state.startTime;
    const remainMs = doneAll > 0 ? Math.round((elapsed / doneAll) * (numPages - doneAll)) : 0;

    return {
        // 明细（页码字段省略：该片处理的页码序列可由 shard+shards 推导）
        filePath,
        shard,
        shards,
        done,
        numPages,
        // 聚合值
        doneAll, // 全局累计已完成页数
        progress: numPages > 0 ? (doneAll / numPages).toFixed(4) : 1, // 全局进度（4 位小数）
        remain: _formatRemain(remainMs), // 全局剩余时间估算
    };
}

// 毫秒格式化为剩余时间文本
function _formatRemain(ms) {
    if (!ms || ms <= 0) {
        return '0秒';
    }

    const seconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(seconds / 60);

    if (minutes > 0) {
        return `${minutes}分${seconds % 60}秒`;
    }

    return `${seconds}秒`;
}

/**
 * 单文件解析编排（主线程）：hash 预检缓存 → 副本复制与分片解析并行 →
 * 按页序合并 → 实体提取 → 写解析缓存。
 *
 * 旧路径是单 worker 串行页循环（hash/缓存读写/实体/落盘全在 worker 的
 * 一次任务里完成）。分片并行后，"每文件只执行一次"的步骤（流式 hash、
 * 缓存预检、副本复制、写解析缓存）不能再放进任何分片 worker——N 片并行
 * 会重复执行或互相踩写，主线程是唯一天然只存在一份的协调者，这些步骤
 * 因此上提至此；worker 侧只保留每片重复的部分（parseShard 逐页解析、
 * extractEntities 实体提取，见 worker/parsePDF.worker.factory.js）。
 *
 * 分片合并严格恢复页序（页不跨片、sort 稳定），texts/images 与串行页循环
 * 逐元素一致，下游（对比/实体）看到的合并结果无形态差异。
 *
 * @param {String} file 源 PDF 文件路径
 * @param {Object} workerPool 解析 worker 线程池（WorkerMultiThreading 实例）
 */
async function parseFile(file, workerPool) {
    // 重置该文件的分片进度聚合状态（防同文件二次冷解析残留旧计数）
    resetShardProgress(file);

    // 主线程流式 hash 一次，分片 worker 直接复用（不再各自重复计算）
    const cacheFile = new CacheFile();

    await cacheFile.hashFile(file);

    // 预检解析缓存：命中直接返回
    const cache = await CacheFile.readCacheByHash(cacheFile.hash);

    if (cache) {
        return cache;
    }

    // 副本复制与分片解析并行进行
    const savePdfPromise = cacheFile.savePdf(file); // hash 已算，仅建目录+复制

    // 分片数与片内内存预算的取值策略见 utils/parseResources.js（调参总开关）
    const shards = parseResources.shardsFor(workerPool.aliveCount);

    const results = await Promise.all(
        Array.from({ length: shards }, (_, shard) =>
            workerPool.handle({ filePath: file, hash: cacheFile.hash, shard, shards }, 'parseShard'),
        ),
    );

    const { pdfPath } = await savePdfPromise;

    // 按页序合并：取模分片下同页只属于一片，sort 稳定保证同页内保持片内顺序，
    // 合并结果与单 worker 串行页循环完全一致
    const texts = results.flatMap((r) => r.texts).sort((a, b) => a.pageNumber - b.pageNumber);
    const images = results.flatMap((r) => r.images).sort((a, b) => a.pageNumber - b.pageNumber);

    // 实体提取必须是合并后的独立往返，两个约束决定它拆不开：
    // ① extractMany 的判据是语料级的（跨块词频、reg 在拼接全文上取值），
    //    分片各只有 1/N 页，片内各自提取会让频次退化为分片级而漂移，
    //    全量文本只在主线程合并（Promise.all）后才存在；
    // ② jieba 词典只在解析 worker 加载（主线程不引入），不能就地在主线程跑。
    // 传输纯文本数组（extractMany 的块级语义与串行形态一致）。
    // 目录点线行无条件不进实体语料：实体提取的目标是正文实体，目录行只是
    // 章节标题的重复（与对比设置 excludeToc 解耦——texts 本身保留目录行）
    const entities = await workerPool.handle(
        texts.map(({ text }) => text).filter((text) => !isTocLine(text)),
        'extractEntities',
    );

    const resloved = {
        fileName: path.basename(file),
        filePath: pdfPath,
        fileHash: cacheFile.hash,
        metadata: results[0].metadata,
        texts,
        images,
        entities,
    };

    await cacheFile.saveParseInfo(resloved);

    return resloved;
}

module.exports = parseFile;
module.exports.aggregateShardProgress = aggregateShardProgress;
