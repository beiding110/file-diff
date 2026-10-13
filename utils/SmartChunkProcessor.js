class SmartChunkProcessor {
    constructor(initialChunk = 1000) {
        this.memoryThreshold = 0.7; // 内存使用率阈值

        this.currentChunkSize = initialChunk;
    }

    /**
     * 按内存使用情况，动态执行任务列队
     * @param {Array} array - Promise 数组
     * @returns {Promise<Array>}
     */
    async process(array) {
        let results = [],
            pointer = 0;

        while (pointer < array.length) {
            const chunk = array.slice(pointer, pointer + this.currentChunkSize);
            const chunkResults = await this._processChunk(chunk);

            results = [...results, ...chunkResults];

            pointer += this.currentChunkSize;

            // 动态调整分块大小
            this._adjustChunkSize();
        }

        return results;
    }

    async _processChunk(chunk) {
        try {
            return await Promise.all(chunk);
        } finally {
            chunk.length = 0; // 立即释放内存
        }
    }

    _adjustChunkSize() {
        const memoryUsage = process.memoryUsage();
        const memoryUsageRage = memoryUsage.heapUsed / memoryUsage.heapTotal;

        if (memoryUsageRage > this.memoryThreshold) {
            this.currentChunkSize = Math.max(100, Math.floor(this.currentChunkSize * 0.8));
        } else {
            this.currentChunkSize = Math.min(10000, Math.floor(this.currentChunkSize * 1.2));
        }
    }

    /**
     * 双重循环流式处理（用于 A×B 的对比场景）
     * @param {Array} arrayA - 第一个数组
     * @param {Array} arrayB - 第二个数组
     * @param {Function} taskCreator - 任务创建函数 (itemA, itemB) => Promise
     * @param {Function} filterFn - 过滤函数 (itemA, itemB) => boolean，返回 false 则跳过该对
     * @param {Object} options - 配置选项
     * @param {number} options.chunkSize - 每批处理的任务数
     * @param {Function} options.onProgress - 进度回调函数（无参数，每次任务完成后调用；带 setTotal 时会先被校准为预统计的精确总数）
     * @param {Function} options.onResult - 结果回调函数 (result) => Promise|void，每个结果产生时立即调用
     * @returns {Promise<Array>} 当 onResult 为空时返回所有结果，否则返回空数组
     */
    async processDoubleLoop(arrayA, arrayB, taskCreator, filterFn = null, options = {}) {
        const {
            chunkSize = 1000,
            onProgress = null,
            onResult = null
        } = options;

        // 预统计精确任务总数：filterFn 是纯内存判断，多跑一遍仅毫秒级。
        // 此前用"按已处理均值外推 + 中途 setTotal 修正"替代预统计，但剪枝
        // 密度前疏后密时外推值会低于最终实际数，total 被中途改小后，后续
        // 实际计数超过它，进度会冲破 100%。预统计后 total 恒不小于实际
        // 计数，进度全程单调有界
        let totalTasks = 0;

        for (const itemA of arrayA) {
            for (const itemB of arrayB) {
                if (!filterFn || filterFn(itemA, itemB)) {
                    totalTasks++;
                }
            }
        }

        // 校准调用方以全组合粗估构造的进度分母
        if (onProgress && onProgress.setTotal) {
            onProgress.setTotal(totalTasks);
        }

        // 流式模式：使用 onResult 回调，不累积结果
        const streamingMode = onResult !== null;
        const results = streamingMode ? null : [];
        const chunkPromises = [];

        // 执行遍的实际任务数：filterFn 为纯函数时与 totalTasks 严格相等；
        // 任务执行带副作用使 filterFn 更严时（如 removeBiddingContent 的
        // 已命中剪枝）会小于它，结束时以此收口，保证进度收敛到 1
        let actualTasksProcessed = 0;

        // 外层循环：遍历数组 A
        for (const itemA of arrayA) {
            // 内层循环：遍历数组 B
            for (const itemB of arrayB) {
                // 如果有过滤函数且不满足条件，跳过
                if (filterFn && !filterFn(itemA, itemB)) {
                    continue;
                }

                // 统计实际任务数
                actualTasksProcessed++;

                // 创建任务并添加到批次中
                const task = taskCreator(itemA, itemB);
                chunkPromises.push(task);

                // 当积累到 chunkSize 个任务时，处理这批任务
                if (chunkPromises.length >= chunkSize) {
                    await this._processChunk(chunkPromises, streamingMode, results, onResult, onProgress);
                }
            }
        }

        // 处理剩余的任务
        if (chunkPromises.length > 0) {
            await this._processChunk(chunkPromises, streamingMode, results, onResult, onProgress);
        }

        // 最终收口：执行遍与预统计不一致时（任务副作用导致的额外剪枝），
        // 用实际执行数修正分母，使进度精确收敛到 1
        if (onProgress && onProgress.setTotal && actualTasksProcessed !== totalTasks) {
            onProgress.setTotal(actualTasksProcessed);
        }

        return results || [];
    }

    /**
     * 处理一批任务（内部方法）
     * @param {Array} chunkPromises - 任务 Promise 数组
     * @param {Boolean} streamingMode - 是否流式模式
     * @param {Array} results - 结果数组（非流式模式使用）
     * @param {Function} onResult - 结果回调（流式模式使用）
     * @param {Function} onProgress - 进度回调
     */
    async _processChunk(chunkPromises, streamingMode, results, onResult, onProgress) {
        const currentChunkSize = chunkPromises.length;
        const chunkResults = await Promise.all(chunkPromises);

        if (streamingMode) {
            // 流式模式：立即处理每个结果，不累积
            for (const result of chunkResults) {
                if (result != null) {
                    await onResult(result);
                }
            }
        } else {
            // 传统模式：累积结果到数组
            for (const result of chunkResults) {
                if (result != null) {
                    results.push(result);
                }
            }
        }

        // 更新进度
        if (onProgress) {
            for (let i = 0; i < currentChunkSize; i++) {
                onProgress();
            }
        }

        // 清空数组，释放内存
        chunkPromises.length = 0;
    }
}

module.exports = new SmartChunkProcessor();
