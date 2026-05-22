// 调用进度条
module.exports = function factoryProgress(total, cb) {
    if (!total) {
        cb && cb(1, '0 / 0', '0');
        return () => {}; // 返回空函数
    }

    let current = 0;
    let lastTime = 0;
    let startTime = Date.now();

    // 进度回调函数
    const progressFn = function () {
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

    // 支持动态调整总数
    progressFn.setTotal = function (newTotal) {
        if (newTotal && newTotal !== total) {
            total = Math.max(newTotal, current); // 确保 total 不小于当前进度
            // 立即触发一次更新以反映变化
            let now = Date.now();
            let percentage = (current / total).toFixed(4);

            if (Number(percentage) === 1) {
                cb && cb(percentage, `${current} / ${total}`, '0');
            } else if (now - lastTime >= 500) { // 缩短最小更新间隔
                let timeRemaining = calcDifference(Math.round(((now - startTime) / current) * (total - current)));
                lastTime = now;
                cb && cb(percentage, `${current} / ${total}`, timeRemaining);
            }
        }
    };

    // 获取当前进度信息
    progressFn.getInfo = function () {
        return {
            current,
            total,
            percentage: (current / total).toFixed(4),
        };
    };

    return progressFn;
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
