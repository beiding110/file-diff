const { diffWords } = require('../worker/diff.work.js');
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

    async findSimilarities(textsA, textsB) {
        const sentencesA = textsA.filter((textItem) => {
            return textItem.text.length >= this.options.minLength;
        });

        const sentencesB = textsB.filter((textItem) => {
            return textItem.text.length >= this.options.minLength;
        });

        const cleanA = await this.removeBiddingContent(sentencesA);
        const cleanB = await this.removeBiddingContent(sentencesB);

        const result = await this.compareTexts(cleanA, cleanB);

        return result;
    }

    // 清除投标文件中，招标文件部分
    async removeBiddingContent(texts) {
        if (!this.biddingContent) {
            return texts;
        }

        const clearedArr = [];
        const { texts: biddingTexts } = this.biddingContent;

        for (let textItem of texts) {
            let { text: bidText } = textItem;

            let allBiddingTextsNotSimilarToTextIem = true;

            for (let { text: biddingText } of biddingTexts) {
                const { similarity } = await this.calculateSentenceSimilarity(biddingText, bidText);

                if (similarity >= this.options.threshold) {
                    allBiddingTextsNotSimilarToTextIem = false;

                    break;
                }
            }

            if (allBiddingTextsNotSimilarToTextIem) {
                clearedArr.push(textItem);
            }
        }

        return clearedArr;
    }

    async compareTexts(sentencesA, sentencesB) {
        const similarityMap = [];

        let progress = factoryProgress(sentencesA.length * sentencesB.length, this.progressHandler);

        for (let pa of sentencesA) {
            for (let pb of sentencesB) {
                const { a, b, similarity } = await this.calculateSentenceSimilarity(pa.text, pb.text);

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
                        similarity,
                    });
                }

                progress();
            }
        }

        return similarityMap;
    }

    getSentenceKey(sentence) {
        // 生成特征键值用于快速筛选
        const minLength = Math.min(sentence.length, 10);
        return `${sentence.length}_${sentence.substr(0, minLength)}`;
    }

    calculateSentenceSimilarity(a, b) {
        return new Promise((resolve, reject) => {
            diffWords(a, b).then((diff) => {
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

                resolve({
                    a: strA.replaceAll('</b><b>', ''),
                    b: strB.replaceAll('</b><b>', ''),
                    similarity: sameCount / Math.max(a.length, b.length),
                });
            });
        });
    }
}

module.exports = TextComparator;
