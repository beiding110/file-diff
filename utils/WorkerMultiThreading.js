const { v4: uuidv4 } = require('uuid');

class WorkerMultiThreading {
    constructor(options = {}) {
        this.worker = [];
        this.waiting = [];
        // 限制等待队列的最大长度，防止内存爆炸
        // 默认为 worker 数量的 3 倍
        this.maxQueueSize = options.maxQueueSize || 60;

        // 队列空闲信号：队列满时任务挂起等待，由任务完成方唤醒，避免轮询
        this._slotSignal = null;
        this._slotResolve = null;
    }

    register(worker) {
        const workerItem = {
            id: uuidv4(),
            worker,
            busy: false,
            dead: false,
        };

        this.worker.push(workerItem);

        // worker 线程退出（崩溃或主动 terminate）后标记为不可用
        if (typeof worker.onDead === 'function') {
            worker.onDead(() => {
                workerItem.dead = true;
            });
        }

        return workerItem;
    }

    // 保留 num 个 worker，其余注销并终止线程
    keep(num) {
        const removed = this.worker.splice(num);

        removed.forEach((item) => {
            item.dead = true;

            if (item.worker && typeof item.worker.terminate === 'function') {
                Promise.resolve(item.worker.terminate()).catch(() => {});
            }
        });
    }

    handle(task) {
        return new Promise((resolve, reject) => {
            const taskItem = {
                id: uuidv4(),
                task,
                success: resolve,
                error: reject,
            };

            this._enqueueOrExecute(taskItem);
        });
    }

    async _enqueueOrExecute(taskItem) {
        // 队列已满时挂起等待，直到有任务完成腾出空间
        while (this.waiting.length >= this.maxQueueSize) {
            await this._waitForSlot();
        }

        this.waiting.push(taskItem);
        this.solve();
    }

    _waitForSlot() {
        // 所有等待者共享同一个信号，唤醒后重新检查条件
        if (!this._slotSignal) {
            this._slotSignal = new Promise((resolve) => {
                this._slotResolve = resolve;
            });
        }

        return this._slotSignal;
    }

    _notifySlot() {
        if (this._slotResolve) {
            const resolve = this._slotResolve;

            this._slotSignal = null;
            this._slotResolve = null;

            resolve();
        }
    }

    solve() {
        // 首个空闲且未失效的worker
        const workerItem = this.worker.find((w) => !w.busy && !w.dead);

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

                // 任务完成释放队列空间，唤醒等待提交的任务
                this._notifySlot();

                this.solve();
            });
    }
}

module.exports = WorkerMultiThreading;
