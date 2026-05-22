const { v4: uuidv4 } = require('uuid');

class WorkerMultiThreading {
    constructor(options = {}) {
        this.worker = [];
        this.waiting = [];
        // 限制等待队列的最大长度，防止内存爆炸
        // 默认为 worker 数量的 3 倍
        this.maxQueueSize = options.maxQueueSize || 60;
    }

    register(worker) {
        this.worker.push({
            id: uuidv4(),
            worker,
            busy: false,
        });
    }

    logoff(num) {
        this.worker.splice(num);
    }

    handle(task) {
        return new Promise((resolve, reject) => {
            const taskItem = {
                id: uuidv4(),
                task,
                success: resolve,
                error: reject,
            };

            // 如果队列已满，等待直到有空间
            if (this.waiting.length >= this.maxQueueSize) {
                // 使用 setImmediate 避免阻塞事件循环
                setImmediate(() => {
                    this._enqueueOrExecute(taskItem);
                });
            } else {
                this._enqueueOrExecute(taskItem);
            }
        });
    }

    _enqueueOrExecute(taskItem) {
        // 等待直到队列有空间
        if (this.waiting.length >= this.maxQueueSize) {
            // 继续等待
            setImmediate(() => {
                this._enqueueOrExecute(taskItem);
            });
            return;
        }

        this.waiting.push(taskItem);
        this.solve();
    }

    solve() {
        // 首个空闲worker
        const workerItem = this.worker.find((w) => !w.busy);

        if (!workerItem) {
            return;
        }

        if (!this.waiting.length) {
            return;
        }

        // 列队头部第一个
        const headWaiting = this.waiting.shift();

        workerItem.busy = true;

        workerItem
            .worker(headWaiting.task)
            .then((result) => {
                headWaiting.success(result);
            })
            .catch((e) => {
                headWaiting.error(e);
            })
            .finally(() => {
                workerItem.busy = false;

                this.solve();
            });
    }
}

module.exports = WorkerMultiThreading;
