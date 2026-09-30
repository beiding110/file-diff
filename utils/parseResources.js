/**
 * 分片解析的资源治理：分片并行的调参总开关集中在此。
 *
 * 两个算式语义不同，勿合并成一个函数——shardsFor 是并行度取小
 * （收益上限 = 实际可用 worker 数与理性上限的较小者，超出的分片只有
 * 每片一次 getDocument 的重复开销与内存峰值，没有速度收益），
 * imagePendingBudgetPerShard 是预算均分（全局在途像素预算按片分摊，
 * 并行时总峰值恒定，不随分片数膨胀）。
 */

// 分片数上限：贴 CPU 核数/解析池规模（4 核 i5-7400 实测最优）。
// 防御未来扩池后分片数跟着池规模无脑膨胀——收益由核数封顶，只有开销
const SHARD_LIMIT = 4;

// 在途图片像素的全局预算：sharp 编码落盘前多页像素并存的峰值控制
const IMAGE_PENDING_BUDGET_BYTES = 96 * 1024 * 1024;

/**
 * 实际分片数 = min(池存活 worker 数, 上限)。
 * 存活数不足时自动退化（单线程调试模式/线程崩溃后），至少 1 片
 * @param {Number} aliveCount 解析 worker 池的存活线程数
 * @returns {Number} 分片数（>= 1）
 */
function shardsFor(aliveCount) {
    return Math.max(1, Math.min(aliveCount, SHARD_LIMIT));
}

/**
 * 片内在途像素上限 = 全局预算 ÷ 分片数。
 * shards=1 时为完整预算（与串行形态一致）；分摊的代价是片数越多
 * flush 等待越频繁（内存安全优先，实测无速度损失）
 * @param {Number} shards 分片数
 * @returns {Number} 单片在途像素字节上限
 */
function imagePendingBudgetPerShard(shards) {
    return IMAGE_PENDING_BUDGET_BYTES / shards;
}

module.exports = {
    SHARD_LIMIT,
    IMAGE_PENDING_BUDGET_BYTES,
    shardsFor,
    imagePendingBudgetPerShard,
};
