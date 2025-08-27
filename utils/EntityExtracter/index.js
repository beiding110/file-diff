const nodejieba = require('nodejieba');
const path = require('node:path');

const userDict = path.join(__dirname, './userdict.utf8');

nodejieba.load({
    dict: nodejieba.DEFAULT_DICT,
    userDict,
});

const REG_PUNCTUATION = require('./punctuation.js'); // 不可能在实体中出现的符号

// 定义实体指示词 和 标签集合
const ENTITY_INDICATORS = require('./indicators.js');

class EntityExtracter {
    constructor(text) {
        this._text = text;
        this._tags = nodejieba.tag(text);

        console.log(this._tags);
    }

    // 主提取方法
    extract() {
        let result = [];

        ENTITY_INDICATORS.forEach(({ type, word, tags, cut, valid, condition, reg }) => {
            let res = [];

            if (reg) {
                res = this.extractByReg(this._text, { type, reg, valid });
            } else if (condition) {
                res = this.extractByCondition(this._tags, { type, condition });
            } else {
                res = this.extractByContext(this._tags, { type, word, tags, cut, valid });
            }

            result = [...result, ...res];
        });

        return result;
    }

    extractByReg(text, { type, reg, valid }) {
        var res = text.match(reg);

        if (!res) {
            return [];
        }

        if (valid) {
            res = res.filter((item) => {
                return valid(item);
            });
        }

        return res.map((item) => {
            return {
                entity: item,
                type,
            };
        });
    }

    extractByCondition(taggedWords, { type, condition }) {
        const entities = [];

        for (let i = 0; i < taggedWords.length; i++) {
            const { word, tag } = taggedWords[i];

            if (condition({ word, tag })) {
                entities.push({
                    entity: word,
                    type,
                });
            }
        }

        return entities;
    }

    // 基于上下文提取实体
    extractByContext(
        taggedWords,
        { type: indicatorType, word: indicatorWord, tags: indicatorTags, cut: indicatorCut, valid: indicatorValid }
    ) {
        const entities = [];

        const radius = 20; // 上下文窗口大小

        let buffer = [];

        for (let i = 0; i < taggedWords.length; i++) {
            const { word, tag } = taggedWords[i];

            const prevList = [],
                nextList = [];

            // 上文
            for (let j = -1 * radius; j < 0; j++) {
                const idx = taggedWords[j + i];

                if (idx) {
                    prevList.push(idx);
                }
            }

            // 下文
            for (let j = 0; j < radius; j++) {
                const idx = taggedWords[j + i];

                if (idx) {
                    nextList.push(idx);
                }
            }

            // 检查当前词是否可能是实体的一部分
            const isEntityPart = this.isEntityPart(
                word,
                tag,
                { word: indicatorWord, tags: indicatorTags },
                prevList,
                nextList
            );

            if (isEntityPart) {
                buffer.push({ word, tag });
            } else if (buffer.length > 0) {
                buffer = this.cutBufferEnds(buffer, indicatorCut);

                const entity = buffer.map((item) => item.word).join('');

                if (indicatorValid(entity)) {
                    entities.push({
                        entity,
                        type: indicatorType,
                    });
                }

                buffer = [];
            }
        }

        // 处理最后一个实体
        if (buffer.length > 0) {
            buffer = this.cutBufferEnds(buffer, indicatorCut);

            const entity = buffer.map((item) => item.word).join('');

            if (indicatorValid(entity)) {
                entities.push({
                    entity,
                    type: indicatorType,
                });
            }
        }

        return [...new Set(entities)]; // 去重
    }

    // 判断是否是实体的一部分
    isEntityPart(word, tag, { word: indicatorWord, tags: indicatorTags }, prevList, nextList) {
        if (REG_PUNCTUATION.test(word)) {
            // 过滤不可能在实体中出现的符号
            return false;
        }

        // 检查是否是地点指示词
        if (indicatorWord.test(word) && indicatorTags.has(tag)) {
            return true;
        }

        // 检查词性标签、
        if (!indicatorTags.has(tag)) {
            return false;
        }

        if (!nextList) {
            return false;
        }

        // 获取下文中是否存在关键词
        var firstIndex = nextList.findIndex((item) => {
            if (item && indicatorWord.test(item.word)) {
                return true;
            }

            return false;
        });

        // 目标字符前所有项都符合词性，且不存在标点符号
        if (firstIndex >= 0) {
            let checkList = nextList.slice(0, firstIndex);

            const everyWordBeforeKeyWordIsRightKey = checkList.every((item) => {
                return indicatorTags.has(item.tag) && !REG_PUNCTUATION.test(item.word);
            });

            return everyWordBeforeKeyWordIsRightKey;
        }

        return false;
    }

    cutBufferEnds(buffer, cut = {}) {
        if (!buffer || !buffer.length) {
            return [];
        }

        const { left, right } = cut;

        let res = [...buffer];

        if (left) {
            let index = buffer.findIndex(({ word, tag }) => {
                return !left({ word, tag });
            });

            res = buffer.slice(index);
        }

        if (right) {
            res = res.reverse();

            let index = res.findIndex(({ word, tag }) => {
                return !right({ word, tag });
            });

            res = res.slice(index);

            res = res.reverse();
        }

        return res;
    }
}

module.exports = EntityExtracter;
