const path = require('path');
const CacheFile = require('./CacheFile.js');
const parseResources = require('./parseResources.js');

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
    // 传输纯文本数组（extractMany 的块级语义与串行形态一致）
    const entities = await workerPool.handle(
        texts.map(({ text }) => text),
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
