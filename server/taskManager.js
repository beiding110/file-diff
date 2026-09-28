'use strict';

/**
 * 内存任务管理器
 *
 * 代替 server 分支的 Bull + Redis 方案：
 * - 零外部依赖（对比是 CPU 密集型单机任务，无需跨进程队列）
 * - 串行/受控并发执行，任务结果本身持久化在 cache 目录，
 *   服务重启后已完成的结果仍可通过 groupId 查询
 * - 进度更新经时间窗合并后广播，避免高频回调打爆 SSE 连接
 *
 * 事件：每个任务对应 `update:<taskId>` 事件，参数为任务对象。
 * 状态变化（入队/开始/完成/失败/取消）立即广播；
 * 进度更新（setProgress）在 progressFlushMs 窗口内合并后广播。
 */

const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');

const STATUS = {
    WAITING: 'waiting',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELED: 'canceled',
};

// 终态集合
const FINISHED_STATUSES = [STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELED];

class TaskManager extends EventEmitter {
    /**
     * @param {Object} options
     * @param {Number} options.concurrency        最大并发执行任务数（默认 1，串行）
     * @param {Number} options.maxFinishedTasks   内存中保留的终态任务数上限
     * @param {Number} options.progressFlushMs    进度广播合并窗口（毫秒）
     */
    constructor({ concurrency = 1, maxFinishedTasks = 200, progressFlushMs = 250 } = {}) {
        super();

        this.concurrency = Math.max(1, concurrency || 1);
        this.maxFinishedTasks = Math.max(1, maxFinishedTasks || 200);
        this.progressFlushMs = Math.max(50, progressFlushMs || 250);

        this.tasks = new Map(); // id -> task
        this.queue = []; // waiting 状态的任务 id（按提交顺序）
        this.runningCount = 0;

        this.closed = false; // 停止接受新任务（优雅关闭中）

        this._dirty = new Set(); // 待广播进度的任务 id
        this._flushTimer = null;
    }

    /**
     * 提交任务
     * @param {Object} meta          任务描述（会原样出现在任务信息里，勿放函数）
     * @param {Function} handler     async (task) => result，抛错即任务失败
     * @returns {Object} 任务对象
     */
    submit(meta, handler) {
        if (this.closed) {
            throw new Error('服务正在关闭，不再接受新任务');
        }

        const task = {
            id: randomUUID(),
            status: STATUS.WAITING,
            createdAt: Date.now(),
            startedAt: null,
            finishedAt: null,
            error: null,
            result: null,
            progress: {
                phase: 'queued', // queued | parsing | comparing | done
                parseFile: null,
                parseProgress: 0,
                pairId: null,
                text: 0,
                image: 0,
                donePairs: 0,
                totalPairs: 0,
            },
            meta: meta || {},
            _handler: handler,
        };

        this.tasks.set(task.id, task);
        this.queue.push(task.id);

        this._emit(task.id);
        this._schedule();

        return task;
    }

    // 调度：有空闲槽位时按序取出 waiting 任务执行
    _schedule() {
        while (this.runningCount < this.concurrency && this.queue.length) {
            const id = this.queue.shift();
            const task = this.tasks.get(id);

            // 已被取消的跳过
            if (!task || task.status !== STATUS.WAITING) {
                continue;
            }

            task.status = STATUS.RUNNING;
            task.startedAt = Date.now();
            this.runningCount++;

            this._emit(id);

            Promise.resolve()
                .then(() => task._handler(task))
                .then((result) => {
                    task.result = result === undefined ? null : result;
                    task.status = STATUS.COMPLETED;
                })
                .catch((e) => {
                    task.error = (e && e.message) ? e.message : String(e);
                    task.status = STATUS.FAILED;
                })
                .finally(() => {
                    task.finishedAt = Date.now();
                    task.progress.phase = 'done';
                    this.runningCount--;

                    this._emit(id);
                    this._evictFinished();
                    this._schedule();
                });
        }
    }

    /**
     * 更新任务进度
     * @param {String} id
     * @param {Object} patch            合并进 task.progress 的字段
     * @param {Object} options
     * @param {Boolean} options.immediate  true 时跳过合并窗口立即广播
     */
    setProgress(id, patch, { immediate = false } = {}) {
        const task = this.tasks.get(id);

        if (!task || task.status !== STATUS.RUNNING) {
            return;
        }

        Object.assign(task.progress, patch);

        if (immediate) {
            this._emit(id);
        } else {
            this._dirty.add(id);

            if (!this._flushTimer) {
                this._flushTimer = setTimeout(() => {
                    this._flushTimer = null;

                    const ids = [...this._dirty];

                    this._dirty.clear();
                    ids.forEach((flushId) => this._emit(flushId));
                }, this.progressFlushMs);

                // 不阻止进程退出
                if (typeof this._flushTimer.unref === 'function') {
                    this._flushTimer.unref();
                }
            }
        }
    }

    // 立即广播某任务当前快照
    _emit(id) {
        const task = this.tasks.get(id);

        if (task) {
            this.emit(`update:${id}`, task);
        }
    }

    // 终态任务超限时淘汰最旧的（结果已持久化在磁盘，仍可通过 groupId 查询）
    _evictFinished() {
        let finishedIds = [];

        for (const [id, task] of this.tasks) {
            if (FINISHED_STATUSES.includes(task.status)) {
                finishedIds.push({ id, finishedAt: task.finishedAt || 0 });
            }
        }

        const overflow = finishedIds.length - this.maxFinishedTasks;

        if (overflow > 0) {
            finishedIds.sort((a, b) => a.finishedAt - b.finishedAt);

            for (let i = 0; i < overflow; i++) {
                this.tasks.delete(finishedIds[i].id);
            }
        }
    }

    get(id) {
        return this.tasks.get(id) || null;
    }

    /**
     * 取消任务：仅 waiting 状态可取消（库未提供运行中中止机制）
     * @returns {{ok: Boolean, reason: String|null}}
     */
    cancel(id) {
        const task = this.tasks.get(id);

        if (!task) {
            return { ok: false, reason: 'not_found' };
        }

        if (task.status === STATUS.WAITING) {
            const index = this.queue.indexOf(id);

            if (index >= 0) {
                this.queue.splice(index, 1);
            }

            task.status = STATUS.CANCELED;
            task.finishedAt = Date.now();

            this._emit(id);

            return { ok: true, reason: null };
        }

        if (task.status === STATUS.RUNNING) {
            return { ok: false, reason: 'running' };
        }

        return { ok: false, reason: 'finished' };
    }

    /**
     * 任务列表（进行中在前按提交时间排，终态按结束时间倒序）
     */
    list() {
        const pending = [];
        const finished = [];

        for (const task of this.tasks.values()) {
            if (FINISHED_STATUSES.includes(task.status)) {
                finished.push(task);
            } else {
                pending.push(task);
            }
        }

        pending.sort((a, b) => a.createdAt - b.createdAt);
        finished.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));

        return [...pending, ...finished];
    }

    stats() {
        let completed = 0;
        let failed = 0;
        let canceled = 0;

        for (const task of this.tasks.values()) {
            if (task.status === STATUS.COMPLETED) {
                completed++;
            } else if (task.status === STATUS.FAILED) {
                failed++;
            } else if (task.status === STATUS.CANCELED) {
                canceled++;
            }
        }

        return {
            waiting: this.queue.length,
            running: this.runningCount,
            completed,
            failed,
            canceled,
        };
    }

    // 停止接受新任务（优雅关闭第一步）
    close() {
        this.closed = true;
    }

    // 取消全部 waiting 任务（优雅关闭第二步，返回被取消的任务列表）
    cancelAllWaiting() {
        const canceled = [];

        for (const id of [...this.queue]) {
            if (this.cancel(id).ok) {
                canceled.push(this.tasks.get(id));
            }
        }

        return canceled;
    }

    /**
     * 等待运行中任务全部结束
     * @param {Number} timeoutMs 超时毫秒数
     * @returns {Promise<Boolean>} true=全部结束，false=超时
     */
    waitForIdle(timeoutMs = 10 * 60 * 1000) {
        return new Promise((resolve) => {
            const startedAt = Date.now();

            const check = () => {
                if (this.runningCount === 0) {
                    resolve(true);
                    return;
                }

                if (Date.now() - startedAt >= timeoutMs) {
                    resolve(false);
                    return;
                }

                setTimeout(check, 500);
            };

            check();
        });
    }
}

module.exports = TaskManager;
module.exports.STATUS = STATUS;
module.exports.FINISHED_STATUSES = FINISHED_STATUSES;
