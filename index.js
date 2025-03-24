import fs from 'fs';
import path from 'path';

import parsePDF from './utils/parsePDF.js';
import TextComparator from './utils/TextComparator.js';

class BidComparator {
    constructor() {
        this.results = [];

        this.textComparator = null;
    }

    async processFiles(bidFiles, biddingFile) {
        if (biddingFile) {
            const biddingDoc = await parsePDF(biddingFile);

            this.textComparator = new TextComparator(this.extractBiddingPatterns(biddingDoc));
        } else {
            this.textComparator = new TextComparator([]);
        }

        const bidDocs = await Promise.all(bidFiles.map(parsePDF));

        // 两两对比投标文件
        for (let i = 0; i < bidDocs.length; i++) {
            for (let j = i + 1; j < bidDocs.length; j++) {
                const result = await this.compareBids(bidDocs[i], bidDocs[j]);
                this.results.push(result);
            }
        }

        return this.results;
    }

    extractBiddingPatterns(biddingDoc) {
        return biddingDoc.pages.flatMap((page) => page.text.split('\n')).filter((line) => line.trim().length > 0);
    }

    async compareBids(bidA, bidB) {
        const textSimilarities = this.textComparator.findSimilarities(
            bidA.pages.flatMap((p) => p.text).join('\n'),
            bidB.pages.flatMap((p) => p.text).join('\n')
        );

        // const imageMatches = await this.compareImages(bidA, bidB);

        return {
            files: [bidA.filePath, bidB.filePath],
            textSimilarities,
            // imageMatches,
            metadataMatches: this.compareMetadata(bidA.metadata, bidB.metadata),
        };
    }

    async compareImages(bidA, bidB) {
        const matches = [];

        for (const imgA of bidA.pages.flatMap((p) => p.images)) {
            for (const imgB of bidB.pages.flatMap((p) => p.images)) {
                const similarity = ImageComparator.compareHashes(
                    await ImageComparator.getImageHash(imgA.data),
                    await ImageComparator.getImageHash(imgB.data)
                );

                if (similarity > 0.9) {
                    matches.push({
                        pages: [imgA.pageNumber, imgB.pageNumber],
                        similarity,
                    });
                }
            }
        }

        return matches;
    }

    compareMetadata(metaA, metaB) {
        const list = [
            { key: 'Author', label: '作者' },
            { key: 'CreationDate', label: '创建时间' },
            { key: '', label: '版本' },
            { key: 'Creator', label: '应用程序' },
            { key: '', label: '属性【标题】' },
            { key: 'ModDate', label: '最后修改日期' },
            { key: '', label: '属性【主题】' },
            { key: '', label: '属性【公司】' },
            { key: '', label: '属性【关键词】' },
            { key: '', label: '最后修改者' },
        ];

        return list.reduce((arr, item) => {
            let { key, label } = item;

            if (!key) {
                return arr;
            }

            let i = {
                label,
                a: '',
                b: '',
                same: false,
            };

            if (metaA[key] === metaB[key]) {
                i.a = metaA[key];
                i.b = metaB[key];
                i.same = true;
            }

            arr.push(i);

            return arr;
        }, []);
    }
}

let comparator = new BidComparator();

comparator.processFiles(['./docs/bid3.pdf', './docs/bid4.pdf']).then((res) => {
    console.log(res);
});
