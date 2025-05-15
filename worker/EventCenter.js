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

    // 触发事件
    post(name, ...args) {
        this._worker.postMessage({
            event: name,
            args,
        });
    }
}

module.exports = EventCenter;
