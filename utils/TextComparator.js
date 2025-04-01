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

    findSimilarities(textsA, textsB, usePromise) {
        const handler = () => {
            const sentencesA = textsA.filter((textItem) => {
                return textItem.text.length >= this.options.minLength;
            });

            const sentencesB = textsB.filter((textItem) => {
                return textItem.text.length >= this.options.minLength;
            });

            const cleanA = this.removeBiddingContent(sentencesA);
            const cleanB = this.removeBiddingContent(sentencesB);

            return this.compareTexts(cleanA, cleanB);
        };

        if (usePromise) {
            return new Promise((resolve, reject) => {
                const result = handler();
                resolve(result);
            });
        }

        return handler();
    }

    // 清除投标文件中，招标文件部分
    removeBiddingContent(texts) {
        if (!this.biddingContent || !this.biddingContent.length) {
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

    compareTexts(sentencesA, sentencesB) {
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
