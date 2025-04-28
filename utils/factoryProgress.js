// 调用进度条
module.exports = function factoryProgress(total, cb) {
    if (!total) {
        return cb(1, '0 / 0');
    }

    let current = 0;

    let lastTime = 0;

    return () => {
        current++;

        let percentage = (current / total).toFixed(4);

        let now = Date.now();

        if (Number(percentage) === 1) {
            // 立即执行一次
            lastTime = now;

            cb && cb(percentage, `${current} / ${total}`);

            return;
        }

        if (now - lastTime >= 1000) {
            lastTime = now;

            cb && cb(percentage, `${current} / ${total}`);
        }
    };
};
