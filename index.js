const { v4: uuidv4 } = require('uuid');

const {
    parsePDF: parsePDF0,
    setCachePath: setCachePath0,
    setCustomLogHandler: setCustomLogHandler0,
    setProgressHandler: setProgressHandler0,
} = require('./worker/parsePDF.worker.0.js');
const {
    parsePDF: parsePDF1,
    setCachePath: setCachePath1,
    setCustomLogHandler: setCustomLogHandler1,
    setProgressHandler: setProgressHandler1,
} = require('./worker/parsePDF.worker.1.js');
const {
    parsePDF: parsePDF2,
    setCachePath: setCachePath2,
    setCustomLogHandler: setCustomLogHandler2,
    setProgressHandler: setProgressHandler2,
} = require('./worker/parsePDF.worker.2.js');
const {
    parsePDF: parsePDF3,
    setCachePath: setCachePath3,
    setCustomLogHandler: setCustomLogHandler3,
    setProgressHandler: setProgressHandler3,
} = require('./worker/parsePDF.worker.3.js');

const TextComparator = require('./utils/TextComparator.js');
const ImageComparator = require('./utils/ImageComparator.js');
const CacheFile = require('./utils/CacheFile.js');
const WorkerMultiThreading = require('./utils/WorkerMultiThreading.js');
const { log, setCustomHandler } = require('./utils/log.js');

const workerMultiThreading = new WorkerMultiThreading();

workerMultiThreading.register(parsePDF0);
workerMultiThreading.register(parsePDF1);
workerMultiThreading.register(parsePDF2);
workerMultiThreading.register(parsePDF3);

class BidComparator {
    constructor() {
        this.bidDocsMatrix = [];

        this.textComparator = null;
        this.imageComparator = null;
    }

    static preload(file) {
        return workerMultiThreading.handle(file);
    }

    static async history(file) {
        return await CacheFile.getResult(file);
    }

    async across(bidFiles) {
        const bidDocs = await Promise.all(
            bidFiles.map(async (file) => {
                return await workerMultiThreading.handle(file);
            })
        );

        const matrix = [];

        // 两两对比投标文件
        for (let i = 0; i < bidDocs.length; i++) {
            for (let j = i + 1; j < bidDocs.length; j++) {
                const fileL = bidDocs[i],
                    fileR = bidDocs[j];

                matrix.push({
                    id: uuidv4(),
                    files: [
                        {
                            fileName: fileL.fileName,
                            fileHash: fileL.fileHash,
                        },
                        {
                            fileName: fileR.fileName,
                            fileHash: fileR.fileHash,
                        },
                    ],
                });
            }
        }

        this.bidDocsMatrix = matrix;

        log('index.js', 'across', '投标文件对比矩阵:', matrix.length, '个');

        return matrix;
    }

    async processFiles(bidFiles, biddingFile) {
        let biddingDoc = null;

        if (biddingFile) {
            biddingDoc = await workerMultiThreading.handle(biddingFile);
        }

        this.textComparator = new TextComparator(biddingDoc, _STORE_SETTINGS_TEXT);

        this.imageComparator = new ImageComparator(_STORE_SETTINGS_IMAGE);

        if (!this.bidDocsMatrix.length) {
            await this.across(bidFiles);
        }

        const GROUPID = uuidv4();

        // 使用 Map 缓存已加载的文件，避免重复读取
        const loadedFilesCache = new Map();

        // 分批处理：每批处理的对比对数量
        // 这有助于在大量文件时控制内存使用
        const BATCH_SIZE = 10;

        for (let batchStart = 0; batchStart < this.bidDocsMatrix.length; batchStart += BATCH_SIZE) {
            const batchEnd = Math.min(batchStart + BATCH_SIZE, this.bidDocsMatrix.length);
            const batch = this.bidDocsMatrix.slice(batchStart, batchEnd);

            log('index.js', 'processFiles', `处理批次 ${batchStart + 1}-${batchEnd} / ${this.bidDocsMatrix.length}`);

            // 处理当前批次
            for (let i = 0; i < batch.length; i++) {
                let { id, files } = batch[i];

                // 排除招标文件内容进度回调
                if (this.textCompareRemoveProgressHandlerFactory) {
                    this.textComparator.removeProgressHandler = this.textCompareRemoveProgressHandlerFactory(id);
                }

                // 文字对比进度回调
                if (this.textCompareProgressHandlerFactory) {
                    this.textComparator.progressHandler = this.textCompareProgressHandlerFactory(id);
                }

                // 图片对比进度回调
                if (this.imageCompareProgressHandlerFactory) {
                    this.imageComparator.processHandler = this.imageCompareProgressHandlerFactory(id);
                }

                // 从缓存读取或从文件加载
                const getFile = async (fileHash) => {
                    if (!loadedFilesCache.has(fileHash)) {
                        const data = CacheFile.readCacheByHash(fileHash);
                        loadedFilesCache.set(fileHash, data instanceof Promise ? await data : data);
                    }
                    return loadedFilesCache.get(fileHash);
                };

                const fileL = await getFile(files[0].fileHash);
                const fileR = await getFile(files[1].fileHash);

                // 进行比对
                const result = await this.compareBids(fileL, fileR, id);

                log('index.js', 'processFiles', '对比完毕');

                result.groupid = GROUPID;

                // 增量保存单个结果，避免内存累积
                await CacheFile.appendResult(result, GROUPID, result.uuid);

                // 立即清空缓存，释放内存
                // 下一对文件需要时会重新加载
                loadedFilesCache.clear();
            }

            // 批次之间稍作等待，让 GC 有机会回收内存
            if (batchEnd < this.bidDocsMatrix.length) {
                await new Promise(resolve => setImmediate(resolve));
                if (global.gc) {
                    global.gc();
                }
            }
        }

        // 调用方可以通过 CacheFile.getResult(GROUPID) 按需读取
        return GROUPID;
    }

    async compareBids(bidA, bidB, id) {
        const startTime = new Date().getTime();

        log('index.js', 'compareBids', '即将开始对比文字:', bidA.fileName, bidB.fileName);

        const textSimilarities = await this.textComparator.findSimilarities(bidA.texts, bidB.texts);

        log('index.js', 'compareBids', '文字对比结束：', textSimilarities.length);
        log('index.js', 'compareBids', '即将开始对比图片：:', bidA.fileName, bidB.fileName);

        const imageMatches = await this.imageComparator.compareImages(bidA.images, bidB.images);

        log('index.js', 'compareBids', '图片对比结束：', imageMatches.length);
        log('index.js', 'compareBids', '即将开始对比属性：:', bidA.fileName, bidB.fileName);

        const metadataMatches = this.compareMetadata(bidA.metadata, bidB.metadata);

        log('index.js', 'compareBids', '属性对比结束');

        const endTime = new Date().getTime();

        return {
            groupid: '',
            uuid: id || uuidv4(),
            names: [bidA.fileName, bidB.fileName],
            files: [bidA.filePath, bidB.filePath],
            textSimilarities,
            imageMatches,
            metadataMatches,
            starttime: startTime,
            addtime: endTime,
            duration: endTime - startTime,
            settings: {
                text: {
                    threshold: this.textComparator.options.threshold,
                    minLength: this.textComparator.options.minLength,
                },
                image: {
                    similarity: this.imageComparator.options.similarity,
                    minSize: this.imageComparator.options.minSize,
                },
            },
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

    static setCachePath(path) {
        CacheFile.setCachePath(path);

        setCachePath0(path);
        setCachePath1(path);
        setCachePath2(path);
        setCachePath3(path);
    }

    static setLogCustomHandler(handler, { path, funName }) {
        setCustomHandler(handler);

        if (path) {
            setCustomLogHandler0({ path, funName });
            setCustomLogHandler1({ path, funName });
            setCustomLogHandler2({ path, funName });
            setCustomLogHandler3({ path, funName });
        }
    }

    static setPreloadProgressHandler(handler) {
        setProgressHandler0(handler);
        setProgressHandler1(handler);
        setProgressHandler2(handler);
        setProgressHandler3(handler);
    }

    static updateSettings({ text, image, workers = 'multi' }) {
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
            const { similarity, minSize } = image;

            if (similarity) {
                _STORE_SETTINGS_IMAGE.similarity = similarity;
            }

            if (minSize) {
                _STORE_SETTINGS_IMAGE.minSize = minSize;
            }
        }

        if (workers) {
            TextComparator.regWorker(workers);
            ImageComparator.regWorker(workers);
        }
    }
}

// 对比的设置缓存，在实例化时传入
const _STORE_SETTINGS_TEXT = {};
const _STORE_SETTINGS_IMAGE = {};

module.exports = BidComparator;
