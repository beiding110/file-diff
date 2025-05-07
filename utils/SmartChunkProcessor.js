class SmartChunkProcessor {
    constructor(initialChunk = 1000) {
        this.memoryThreshold = 0.7; // 内存使用率阈值

        this.currentChunkSize = initialChunk;
    }

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
}

module.exports = new SmartChunkProcessor;
