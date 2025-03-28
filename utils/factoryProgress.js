// 调用进度条
module.exports = function factoryProgress(total, cb) {
    let current = 0;

    let lastTime = 0;

    return () => {
        current++;

        let percentage = (current / total).toFixed(4);

        let now = Date.now();

        if (now - lastTime >= 1000) {
            lastTime = now;

            cb && cb(percentage, `${current} / ${total}`);
        }
    };
};
