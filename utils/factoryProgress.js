// 调用进度条
module.exports = function factoryProgress(total, cb) {
    if (!total) {
        return cb(1, '0 / 0', '0');
    }

    let current = 0;

    let lastTime = 0;

    let startTime = Date.now();

    return () => {
        current++;

        let percentage = (current / total).toFixed(4);

        let now = Date.now();

        if (Number(percentage) === 1) {
            // 立即执行一次
            lastTime = now;

            cb && cb(percentage, `${current} / ${total}`, '0');

            return;
        }

        if (now - lastTime >= 1000) {
            let timeRemaining = calcDifference(Math.round(((now - startTime) / current) * (total - current)));

            lastTime = now;

            cb && cb(percentage, `${current} / ${total}`, timeRemaining);
        }
    };
};

// 将毫秒格式化
function calcDifference(ms) {
    if (!ms) {
        return '0秒';
    }

    let seconds = Math.floor(ms / 1000);
    let minutes = Math.floor(seconds / 60);
    let hours = Math.floor(minutes / 60);
    let days = Math.floor(hours / 24);

    seconds %= 60;
    minutes %= 60;
    hours %= 24;

    let str = '';

    if (days > 0) {
        str += `${days}天`;
    }

    if (hours > 0) {
        str += `${hours}小时`;
    }

    if (minutes > 0) {
        str += `${minutes}分钟`;
    }

    str += `${seconds}秒`;

    return str;
}
