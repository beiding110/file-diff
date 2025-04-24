const { v4: uuidv4 } = require('uuid');

class WorkerMultiThreading {
    constructor() {
        this.worker = [];
        this.waiting = [];
    }

    register(worker) {
        this.worker.push({
            id: uuidv4(),
            worker,
            busy: false,
        });
    }

    handle(task) {
        return new Promise((resolve, reject) => {
            this.waiting.push({
                id: uuidv4(),
                task,
                success: resolve,
                error: reject,
            });

            this.solve();
        });
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
