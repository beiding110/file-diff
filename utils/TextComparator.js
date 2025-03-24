const Diff = require('diff');

class TextComparator {
    constructor(biddingContent, options = {}) {
        this.biddingContent = biddingContent;

        this.options = {
            threshold: 0.7,
            maxLength: 100,
            minLength: 10,
            ...options,
        };

        // 对比进度
        this.progressHandler = null;
    }

    preprocess(text) {
        return text.replace(/\s+/g, ' ').trim();
    }

    findSimilarities(textA, textB) {
        const cleanA = this.removeBiddingContent(textA);
        const cleanB = this.removeBiddingContent(textB);

        return this.compareTexts(cleanA, cleanB);
    }

    removeBiddingContent(text) {
        // 使用LCS算法移除招标文件内容
        return this.biddingContent.reduce((acc, biddingText) => {
            const diff = Diff.diffChars(acc, biddingText);
            return diff
                .filter((part) => !part.added && !part.removed)
                .map((part) => part.value)
                .join('');
        }, text);
    }

    splitSentences(text) {
        // 支持中文/英文/日文分句
        const sentenceRegex = /[^.!?。！？]+([.!?。！？]|$)/g;

        return text.match(sentenceRegex) || [];
    }

    preprocess(text) {
        // 统一全角字符为半角
        const normalized = text
            .normalize('NFKC')
            .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
            .replace(/\s+/g, ' ')
            .trim();

        return this.splitSentences(normalized)
            .map((s) => s.replace(/^\s+|\s+$/g, ''))
            .filter((s) => s.length > 0);
    }

    compareTexts(textA, textB) {
        const sentencesA = this.preprocess(textA).filter((sentence) => {
            return sentence.length >= this.options.minLength;
        });
        const sentencesB = this.preprocess(textB).filter((sentence) => {
            return sentence.length >= this.options.minLength;
        });

        const similarityMap = [];

        let progress = this.factoryProgress(sentencesA.length * sentencesB.length);

        sentencesA.forEach((sa) => {
            sentencesB.forEach((sb) => {
                const { a, b, similarity } = this.calculateSentenceSimilarity(sa, sb);

                if (similarity >= this.options.threshold) {
                    similarityMap.push({
                        sentenceA: sa,
                        sentencesB: sb,
                        sentenceAB: a,
                        sentencesBB: b,
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

    // 调用进度条
    factoryProgress(total) {
        let current = 0;

        return () => {
            current++;

            let percentage = (current / total).toFixed(4);

            this.progressHandler && this.progressHandler(percentage);
        };
    }
}

module.exports = TextComparator;
