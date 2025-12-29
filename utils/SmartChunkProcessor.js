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
     * @param {Function} options.onProgress - 进度回调函数（无参数，每次任务完成后调用）
     * @param {number} options.estimatedTotal - 预估任务总数（用于 factoryProgress）
     * @returns {Promise<Array>}
     */
    async processDoubleLoop(arrayA, arrayB, taskCreator, filterFn = null, options = {}) {
        const { chunkSize = 1000, onProgress = null, estimatedTotal = null } = options;

        // 如果没有提供预估总数，需要先遍历统计
        let totalTasks = estimatedTotal;
        if (totalTasks === null && filterFn) {
            totalTasks = 0;
            for (const itemA of arrayA) {
                for (const itemB of arrayB) {
                    if (filterFn(itemA, itemB)) {
                        totalTasks++;
                    }
                }
            }
        } else if (totalTasks === null) {
            totalTasks = arrayA.length * arrayB.length;
        }

        const results = [];
        const chunkPromises = [];

        // 外层循环：遍历数组 A
        for (const itemA of arrayA) {
            // 内层循环：遍历数组 B
            for (const itemB of arrayB) {
                // 如果有过滤函数且不满足条件，跳过
                if (filterFn && !filterFn(itemA, itemB)) {
                    continue;
                }

                // 创建任务并添加到批次中
                const task = taskCreator(itemA, itemB);
                chunkPromises.push(task);

                // 当积累到 chunkSize 个任务时，处理这批任务
                if (chunkPromises.length >= chunkSize) {
                    const currentChunkSize = chunkPromises.length;
                    const chunkResults = await Promise.all(chunkPromises);

                    for (const result of chunkResults) {
                        if (result != null) {
                            results.push(result);
                        }
                    }

                    // 更新进度（每个任务完成后调用一次）
                    if (onProgress) {
                        for (let i = 0; i < currentChunkSize; i++) {
                            onProgress();
                        }
                    }

                    // 清空数组，释放内存
                    chunkPromises.length = 0;
                }
            }
        }

        // 处理剩余的任务
        if (chunkPromises.length > 0) {
            const currentChunkSize = chunkPromises.length;
            const chunkResults = await Promise.all(chunkPromises);

            for (const result of chunkResults) {
                if (result != null) {
                    results.push(result);
                }
            }

            // 更新进度
            if (onProgress) {
                for (let i = 0; i < currentChunkSize; i++) {
                    onProgress();
                }
            }

            chunkPromises.length = 0;
        }

        return results;
    }
}

module.exports = new SmartChunkProcessor();
