/**
 * 数组去重
 * @param {Array} arr 待去重的数组
 * @returns 去重完毕的数组
 */
module.exports = function (arr) {
    const res = [],
        seen = new Map();

    arr.forEach((item) => {
        let str = JSON.stringify(item);

        if (!seen.has(str)) {
            seen.set(str, true);

            res.push(item);
        }
    });

    return res;
};
