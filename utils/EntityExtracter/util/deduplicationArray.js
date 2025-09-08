/**
 * 数组去重，并标记重复的次数
 * @param {Array} entities 待去重的数组
 * @param {Array} keys 去重时要对比的字段名称
 * @returns 去重完毕的数组
 */
module.exports = function (entities, keys = ['entity', 'type']) {
    const res = [];

    entities.forEach((entity) => {
        const index = res.findIndex((item) => {
            return keys.every((key) => {
                return item[key] === entity[key];
            });
        });

        if (index > -1) {
            // 存在
            res[index].num = res[index].num || 1;

            const entityNum = entity.num || 1;

            res[index].num += entityNum;
        } else {
            res.push(entity);
        }
    });

    return res;
};
