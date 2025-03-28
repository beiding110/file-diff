const Diff = require('diff');
const factoryProgress = require('./factoryProgress.js');

class TextComparator {
    constructor(biddingContent, options = {}) {
        this.biddingContent = biddingContent;

        this.options = {
            threshold: 0.7,
            minLength: 10,
            ...options,
        };

        // 对比进度
        this.progressHandler = null;
    }

    preprocess(text) {
        return text.replace(/\s+/g, ' ').trim();
    }

    findSimilarities(textsA, textsB) {
        const cleanA = this.removeBiddingContent(textsA);
        const cleanB = this.removeBiddingContent(textsB);

        return this.compareTexts(cleanA, cleanB);
    }

    // 清除投标文件中，招标文件部分
    removeBiddingContent(texts) {
        if (!this.biddingContent) {
            return texts;
        }

        const clearedArr = [];
        const { texts: biddingTexts } = this.biddingContent;

        texts.forEach((textItem) => {
            if (
                biddingTexts.every(({ text: biddingText }) => {
                    const { text: bidText } = textItem;
                    const { similarity } = this.calculateSentenceSimilarity(biddingText, bidText);

                    return similarity < this.options.threshold;
                })
            ) {
                clearedArr.push(textItem);
            }
        });

        return clearedArr;
    }

    // 按句子拆分文本
    splitSentences(text) {
        // 支持中文/英文/日文分句
        const sentenceRegex = /([^\n.!?。！？\u203C\u203D\u2047-\u2049]+([.!?。！？\u203C\u203D\u2047-\u2049]|$))/gmu;

        return text.match(sentenceRegex) || [];
    }

    preprocess(page) {
        // 统一全角字符为半角
        const normalized = page.text
            .normalize('NFKC')
            .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
            .replace(/\s+/g, ' ')
            .trim();

        // 将断句进一步拆分
        const sentences = this.splitSentences(normalized)
            .map((s) => s.replace(/^\s+|\s+$/g, ''))
            .filter((s) => s.length > 0);

        return sentences.map((s) => {
            return {
                ...page,
                text: s,
            };
        });
    }

    compareTexts(textsA, textsB) {
        const sentencesA = textsA
            .reduce((arr, textItem) => {
                let sentences = this.preprocess(textItem);

                arr = [...arr, ...sentences];

                return arr;
            }, [])
            .filter((textItem) => {
                return textItem.text.length >= this.options.minLength;
            });

        const sentencesB = textsB
            .reduce((arr, textItem) => {
                let sentences = this.preprocess(textItem);

                arr = [...arr, ...sentences];

                return arr;
            }, [])
            .filter((textItem) => {
                return textItem.text.length >= this.options.minLength;
            });

        const similarityMap = [];

        let progress = factoryProgress(sentencesA.length * sentencesB.length, this.progressHandler);

        sentencesA.forEach((pa) => {
            sentencesB.forEach((pb) => {
                const { a, b, similarity } = this.calculateSentenceSimilarity(pa.text, pb.text);

                if (similarity >= this.options.threshold) {
                    similarityMap.push({
                        a: {
                            text: pa.text,
                            textB: a,
                            pageNumber: pa.pageNumber,
                            // viewport: pa.viewport,
                        },
                        b: {
                            text: pb.text,
                            textB: b,
                            pageNumber: pb.pageNumber,
                            // viewport: pb.viewport,
                        },
                    });
                }

                progress();
            });
        });

        return similarityMap;
    }

    getSentenceKey(sentence) {
        // 生成特征键值用于快速筛选
        const minLength = Math.min(sentence.length, 10);
        return `${sentence.length}_${sentence.substr(0, minLength)}`;
    }

    calculateSentenceSimilarity(a, b) {
        const diff = Diff.diffWords(a, b);

        let sameCount = 0;

        let strA = '',
            strB = '';

        diff.forEach((part) => {
            if (part.removed) {
                // 被移除的，属于左边
                strA += part.value;
            } else if (part.added) {
                // 新增的，属于右边
                strB += part.value;
            } else {
                // 两边相同的部分
                sameCount += part.value.length;

                strA += `<b>${part.value}</b>`;
                strB += `<b>${part.value}</b>`;
            }
        });

        return {
            a: strA.replaceAll('</b><b>', ''),
            b: strB.replaceAll('</b><b>', ''),
            similarity: sameCount / Math.max(a.length, b.length),
        };
    }
}

module.exports = TextComparator;
