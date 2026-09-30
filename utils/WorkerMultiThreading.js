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

        // 关闭标志：shutdown 后拒绝新任务，避免调用方永久挂起
        this.closed = false;
    }

    // 单个 worker 允许的最大并发在途任务数。
    // >1 时同一线程可积压多个任务，配合 worker 内的微批合并
    // 大幅减少消息往返；计算密集的 diff worker 使用较大值
    static DEFAULT_MAX_CONCURRENT = 1;

    // 注册一个 worker。worker 可以是任务函数（handle 不带方法名时直接调用它），
    // 也可以是带多个任务方法的 API 对象（handle 时用第二个参数指定方法名）；
    // 两种形态都可用 onDead/terminate 方法（若存在）通知线程死活与终止线程
    register(worker, { maxConcurrent = 1 } = {}) {
        const workerItem = {
            id: uuidv4(),
            worker,
            inflight: 0,
            maxConcurrent: Math.max(1, maxConcurrent),
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

    // 存活的 worker 数量：分片解析等调用方据此决定并行度
    get aliveCount() {
        return this.worker.filter((w) => !w.dead).length;
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

    // 关闭线程池：终止全部线程并释放等待中的任务。
    // 用于进程结束前主动回收资源；关闭后再 handle 会直接 reject。
    shutdown() {
        if (this.closed) {
            return;
        }

        this.closed = true;

        const error = new Error('thread pool has been closed');

        this.waiting.forEach((taskItem) => {
            taskItem.error(error);
        });

        this.waiting.length = 0;

        this.worker.forEach((item) => {
            item.dead = true;

            if (item.worker && typeof item.worker.terminate === 'function') {
                Promise.resolve(item.worker.terminate()).catch(() => {});
            }
        });
    }

    /**
     * 提交任务到队列。
     * @param {*} task 任务参数（原样传给 worker）
     * @param {String} [method] worker 为 API 对象时的任务方法名（如
     *   'parseShard'/'extractEntities'）；省略时 worker 按任务函数调用
     * @returns {Promise} 任务结果
     */
    handle(task, method) {
        if (this.closed) {
            return Promise.reject(new Error('thread pool has been closed'));
        }

        return new Promise((resolve, reject) => {
            const taskItem = {
                id: uuidv4(),
                task,
                method,
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
        // 持续分发：优先分给在途任务最少的 worker（负载均衡）。
        // 每个线程可有多个在途任务，供 worker 侧微批合并成一次消息
        while (this.waiting.length) {
            let candidate = null;

            for (const w of this.worker) {
                if (w.dead || w.inflight >= w.maxConcurrent) {
                    continue;
                }

                if (!candidate || w.inflight < candidate.inflight) {
                    candidate = w;
                }
            }

            if (!candidate) {
                return;
            }

            // 列队头部第一个
            const headWaiting = this.waiting.shift();

            candidate.inflight++;

            // 指定了方法名的任务调用 API 对象上的对应方法，否则 worker 本身即任务函数
            const invoke = headWaiting.method ? candidate.worker[headWaiting.method] : candidate.worker;

            Promise.resolve(invoke(headWaiting.task))
                .then((result) => {
                    headWaiting.success(result);
                })
                .catch((e) => {
                    headWaiting.error(e);
                })
                .finally(() => {
                    candidate.inflight--;

                    // 任务完成释放队列空间，唤醒等待提交的任务
                    this._notifySlot();

                    this.solve();
                });
        }
    }
}

module.exports = WorkerMultiThreading;
