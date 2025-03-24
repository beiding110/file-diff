const Diff = require('diff');

class TextComparator {
    constructor(biddingContent, options = {}) {
        this.biddingContent = biddingContent;
        this.options = {
            chunkSize: 200,
            threshold: 0.7,
            minLength: 20,
            ...options,
        };
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
        const sentencesA = this.preprocess(textA);
        const sentencesB = this.preprocess(textB);

        const similarityMap = new Map();

        // 构建倒排索引
        const invertedIndex = new Map();

        sentencesA
            .filter((sentence) => {
                return sentence.length >= this.options.minLength;
            })
            .forEach((sentence, index) => {
                const key = this.getSentenceKey(sentence);

                if (!invertedIndex.has(key)) {
                    invertedIndex.set(key, []);
                }

                invertedIndex.get(key).push({
                    source: 'A',
                    index,
                    sentence,
                });
            });

        sentencesB
            .filter((sentence) => {
                return sentence.length >= this.options.minLength;
            })
            .forEach((sentence, index) => {
                const key = this.getSentenceKey(sentence);

                if (!invertedIndex.has(key)) {
                    invertedIndex.set(key, []);
                }

                invertedIndex.get(key).push({
                    source: 'B',
                    index,
                    sentence,
                });
            });

        // 查找相似句子对
        invertedIndex.forEach((candidates) => {
            if (candidates.length < 2) return;

            const groupA = candidates.filter((c) => c.source === 'A');
            const groupB = candidates.filter((c) => c.source === 'B');

            groupA.forEach((a) => {
                groupB.forEach((b) => {
                    const similarity = this.calculateSentenceSimilarity(a.sentence, b.sentence);

                    if (similarity >= this.options.threshold) {
                        const key = `${a.index}-${b.index}`;
                        similarityMap.set(key, {
                            sentenceA: a.sentence,
                            sentenceB: b.sentence,
                            indexA: a.index,
                            indexB: b.index,
                            similarity,
                        });
                    }
                });
            });
        });

        return Array.from(similarityMap.values());
    }

    getSentenceKey(sentence) {
        // 生成特征键值用于快速筛选
        const minLength = Math.min(sentence.length, 10);
        return `${sentence.length}_${sentence.substr(0, minLength)}`;
    }

    calculateSentenceSimilarity(a, b) {
        const diff = Diff.diffWords(a, b);
        let sameCount = 0;

        diff.forEach((part) => {
            if (!part.added && !part.removed) {
                sameCount += part.value.length;
            }
        });

        return sameCount / Math.max(a.length, b.length);
    }
}

module.exports = TextComparator;
