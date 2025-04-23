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
                const { similarity } = await diffWords({ a: biddingText, b: bidText });

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
                const { a, b, similarity } = await diffWords({ a: pa.text, b: pb.text });

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
}

module.exports = TextComparator;
