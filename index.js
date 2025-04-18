const { v4: uuidv4 } = require('uuid');

const parsePDF = require('./utils/parsePDF.js');
const TextComparator = require('./utils/TextComparator.js');
const ImageComparator = require('./utils/ImageComparator.js');
const CacheFile = require('./utils/CacheFile.js');

class BidComparator {
    constructor() {
        this.results = [];

        this.bidDocsMatrix = [];

        this.textComparator = null;
    }

    static preload(file) {
        return parsePDF(file);
    }

    static history(file) {
        return CacheFile.getResult(file);
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

            this.textComparator = new TextComparator(biddingDoc, _STORE_SETTINGS_TEXT);
        } else {
            this.textComparator = new TextComparator(null, _STORE_SETTINGS_TEXT);
        }

        if (!this.bidDocsMatrix.length) {
            await this.across(bidFiles);
        }

        const groupid = uuidv4();

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
            const result = await this.compareBids(files[0], files[1], id);

            result.groupid = groupid;

            this.results.push(result);
        }

        CacheFile.saveResult(this.results, groupid);

        return this.results;
    }

    async compareBids(bidA, bidB, id) {
        const textSimilarities = await this.textComparator.findSimilarities(bidA.texts, bidB.texts);

        const imageMatches = await ImageComparator.compareImages(bidA.images, bidB.images);

        return {
            groupid: '',
            uuid: id || uuidv4(),
            names: [bidA.fileName, bidB.fileName],
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

// 文字对比的设置缓存，在实例化时传入
const _STORE_SETTINGS_TEXT = {};

module.exports = {
    BidComparator,
    setCachePath(path) {
        CacheFile.setCachePath(path);
    },
    updateSettings({ text, image }) {
        if (text) {
            const { threshold, minLength } = text;

            if (threshold) {
                _STORE_SETTINGS_TEXT.threshold = threshold;
            }

            if (minLength) {
                _STORE_SETTINGS_TEXT.minLength = minLength;
            }
        }

        if (image) {
            const { similarity, resizeWidth } = image;

            ImageComparator.SIMILARITY = similarity || ImageComparator.SIMILARITY;
            ImageComparator.RESIZE.width = resizeWidth || ImageComparator.RESIZE.width;
        }
    },
};
