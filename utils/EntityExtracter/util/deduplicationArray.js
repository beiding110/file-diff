/**
 * 数组去重，并标记重复的次数
 * @param {Array} entities 待去重的数组
 * @param {Array} keys 去重时要对比的字段名称
 * @returns 去重完毕的数组
 */
module.exports = function (entities, keys = ['entity', 'type']) {
    const res = [];

    const indexOfKeys = new Map(); // keys 拼接值 -> res 下标

    entities.forEach((entity) => {
        const key = keys.map((k) => entity[k]).join('\0');

        if (indexOfKeys.has(key)) {
            // 存在
            const index = indexOfKeys.get(key);

            res[index].num = res[index].num || 1;

            const entityNum = entity.num || 1;

            res[index].num += entityNum;
        } else {
            indexOfKeys.set(key, res.length);

            res.push(entity);
        }
    });

    return res;
};
