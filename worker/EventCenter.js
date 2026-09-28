const { v4: uuidv4 } = require('uuid');

class EventCenter {
    constructor(worker) {
        this._worker = worker;
        this._bus = {};

        this._worker.on('message', ({ event, args }) => {
            const tasks = this._bus[event];

            if (tasks && tasks.length) {
                tasks.forEach(({ handler }) => {
                    handler(...args);
                });
            }
        });
    }

    // 注册事件
    on(name, cb) {
        this._bus[name] = this._bus[name] || [];

        this._bus[name].push({
            id: uuidv4(),
            handler: cb,
        });
    }

    once(name, cb) {
        this._bus[name] = this._bus[name] || [];

        const id = uuidv4();

        this._bus[name].push({
            id,
            handler: (...args) => {
                cb(...args);

                let index = this._bus[name].findIndex((item) => item.id === id);

                this._bus[name].splice(index, 1);
            },
        });
    }

    // 移除事件监听（不传 cb 时移除该事件的全部监听）
    off(name, cb) {
        if (!this._bus[name]) {
            return;
        }

        if (!cb) {
            this._bus[name].length = 0;
            return;
        }

        this._bus[name] = this._bus[name].filter((item) => item.handler !== cb);
    }

    // 触发事件
    post(name, ...args) {
        this._worker.postMessage({
            event: name,
            args,
        });
    }
}

module.exports = EventCenter;
