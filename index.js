import { v4 as uuidv4 } from 'uuid';

import parsePDF from './utils/parsePDF.js';
import TextComparator from './utils/TextComparator.js';
import ImageComparator from './utils/ImageComparator.js';
import CacheFile from './utils/CacheFile.js';

class BidComparator {
    constructor() {
        this.results = [];

        this.bidDocsMatrix = [];

        this.textComparator = null;
    }

    preload(file) {
        return parsePDF(file);
    }

    async across(bidFiles) {
        const bidDocs = await Promise.all(bidFiles.map(parsePDF));

        const matrix = [];

        // 两两对比投标文件
        for (let i = 0; i < bidDocs.length; i++) {
            for (let j = i + 1; j < bidDocs.length; j++) {
                matrix.push({
                    id: uuidv4(),
                    files: [bidDocs[i], bidDocs[j]],
                });
            }
        }

        this.bidDocsMatrix = matrix;

        return matrix;
    }

    async processFiles(bidFiles, biddingFile) {
        if (biddingFile) {
            const biddingDoc = await parsePDF(biddingFile);

            this.textComparator = new TextComparator(biddingDoc);
        } else {
            this.textComparator = new TextComparator([]);
        }

        if (!this.bidDocsMatrix.length) {
            await this.across(bidFiles);
        }

        for (let i = 0; i < this.bidDocsMatrix.length; i++) {
            let { id, files } = this.bidDocsMatrix[i];

            // 进度
            if (this.textCompareProgressHandlerFactory) {
                this.textComparator.progressHandler = this.textCompareProgressHandlerFactory(id);
            }

            if (this.imageCompareProgressHandlerFactory) {
                ImageComparator.processHandler = this.imageCompareProgressHandlerFactory(id);
            }

            // 进行比对
            const result = await this.compareBids(files[0], files[1]);

            this.results.push(result);
        }

        CacheFile.saveResult(this.results);

        return this.results;
    }

    async compareBids(bidA, bidB) {
        const textSimilarities = this.textComparator.findSimilarities(bidA.texts, bidB.texts);

        const imageMatches = await ImageComparator.compareImages(bidA.images, bidB.images);

        return {
            files: [bidA.filePath, bidB.filePath],
            textSimilarities,
            imageMatches,
            metadataMatches: this.compareMetadata(bidA.metadata, bidB.metadata),
            addtime: new Date().getTime(),
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

comparator.textCompareProgressHandlerFactory = function (id) {
    return function (num, str) {
        console.log(id, num, str);
    };
};

comparator.imageCompareProgressHandlerFactory = function (id) {
    return function (num, str) {
        console.log(id, num, str);
    };
};

comparator.preload('./docs/g2-3.pdf');

comparator
    .processFiles(['./docs/g2-1.pdf', './docs/g2-2.pdf', './docs/g2-3.pdf'], './docs/g2-exclude.pdf')
    .then((res) => {
        console.log(res);
    });
