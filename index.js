import fs from 'fs';
import path from 'path';

import parsePDF from './utils/parsePDF.js';
import TextComparator from './utils/TextComparator.js';
import ImageComparator from './utils/ImageComparator.js';

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

        // 进度
        this.textComparator.progressHandler = this.textCompareProgressHandler;
        ImageComparator.processHandler = this.imageCompareProgressHandler;

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
        return biddingDoc.pages.flatMap((page) => page.text).filter((line) => line.trim().length > 0);
    }

    async compareBids(bidA, bidB) {
        const textSimilarities = this.textComparator.findSimilarities(bidA.texts, bidB.texts);

        // const imageMatches = await ImageComparator.compareImages(bidA.images, bidB.images);

        return {
            files: [bidA.filePath, bidB.filePath],
            textSimilarities,
            // imageMatches,
            metadataMatches: this.compareMetadata(bidA.metadata, bidB.metadata),
        };
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
                a: metaA[key],
                b: metaB[key],
                same: false,
            };

            if (metaA[key] === metaB[key]) {
                i.same = true;
            }

            arr.push(i);

            return arr;
        }, []);
    }
}

let comparator = new BidComparator();

comparator.textCompareProgressHandler = function (num, str) {
    console.log(num, str);
};

comparator.imageCompareProgressHandler = function (num, str) {
    console.log(num, str);
};

comparator.processFiles(['./docs/g2-1.pdf', './docs/g2-2.pdf']).then((res) => {
    console.log(res);

    fs.writeFileSync('./docs/result.json', JSON.stringify(res));
});
