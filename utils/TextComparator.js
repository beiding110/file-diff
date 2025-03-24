const Diff = require('diff');

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

    findSimilarities(pagesA, pagesB) {
        const cleanA = this.removeBiddingContent(pagesA);
        const cleanB = this.removeBiddingContent(pagesB);

        return this.compareTexts(cleanA, cleanB);
    }

    removeBiddingContent(pages) {
        if (!this.biddingContent || !this.biddingContent.length) {
            return pages;
        }

        return pages.reduce((acc, page) => {
            if (
                !this.biddingContent.some((biddingPage) => {
                    const diff = Diff.diffChars(page.text, biddingPage.text);

                    return diff
                        .filter((part) => !part.added && !part.removed)
                        .map((part) => part.value)
                        .join('');
                })
            ) {
                acc.push();
            }

            return acc;
        }, []);
    }

    // 按句子拆分文本
    splitSentences(text) {
        // 支持中文/英文/日文分句
        const sentenceRegex = /[^.!?。！？]+([.!?。！？]|$)/g;

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

    compareTexts(pagesA, pagesB) {
        const pagesSentencesA = pagesA
            .reduce((arr, page) => {
                let sentences = this.preprocess(page);

                arr = [...arr, ...sentences];

                return arr;
            }, [])
            .filter((page) => {
                return page.text.length >= this.options.minLength;
            });

        const pagesSentencesB = pagesB
            .reduce((arr, page) => {
                let sentences = this.preprocess(page);

                arr = [...arr, ...sentences];

                return arr;
            }, [])
            .filter((page) => {
                return page.text.length >= this.options.minLength;
            });

        const similarityMap = [];

        let progress = this.factoryProgress(pagesSentencesA.length * pagesSentencesB.length);

        pagesSentencesA.forEach((pa) => {
            pagesSentencesB.forEach((pb) => {
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

    // 调用进度条
    factoryProgress(total) {
        let current = 0;

        let lastTime = 0;

        return () => {
            current++;

            let percentage = (current / total).toFixed(4);

            let now = Date.now();

            if (now - lastTime >= 1000) {
                lastTime = now;
                
                this.progressHandler && this.progressHandler(percentage, `${current} / ${total}`);
            }
        };
    }
}

module.exports = TextComparator;
