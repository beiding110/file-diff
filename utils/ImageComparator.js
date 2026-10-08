const factoryProgress = require('./factoryProgress.js');
const { log } = require('./log.js');

/**
 * 比较两个 dHash（0/1 字符串）：相同位数 / 较长哈希的位数
 * 哈希在解析期已预计算，对比只是百次字符比较（微秒级），
 * 直接在主线程执行比一次 worker 消息往返更快。
 */
function compareHashes(hashA, hashB) {
    if (!hashA || !hashB) {
        return 0;
    }

    const length = Math.max(hashA.length, hashB.length);

    let sameCount = 0;

    for (let i = 0; i < length; i++) {
        if (hashA[i] === hashB[i]) {
            sameCount++;
        }
    }

    return sameCount / length;
}

/**
 * 按图片哈希去重。
 * 页眉、logo、印章等图片会在每页重复出现，解析期只做页内去重；
 * 若直接按实例双重循环，两个百页文档的相同页眉会组合出上万次
 * 结果完全相同的对比。先折叠为唯一哈希再对比，结果附带各侧出现的全部页码。
 */
function groupByHash(images) {
    const map = new Map();

    for (const img of images) {
        if (!img.imageHash) {
            continue;
        }

        let entry = map.get(img.imageHash);

        if (!entry) {
            entry = { rep: img, pages: [] };
            map.set(img.imageHash, entry);
        }

        if (!entry.pages.includes(img.pageNumber)) {
            entry.pages.push(img.pageNumber);
        }
    }

    return map;
}

class ImageComparator {
    constructor({
        similarity = 0.9, // 相似度目标
        minSize = 100, // 最小图片宽高，小于的不参与对比
        ratioTolerance = 1.1, // 宽高比预筛容差，比值超出 [1/ratioTolerance, ratioTolerance] 跳过
    }) {
        this.options = {
            similarity,
            minSize,
            ratioTolerance,
        };

        this.processHandler = null;
    }

    // 兼容 updateSettings 的调用：图片对比已改为纯内存计算，不再创建 worker 线程
    static regWorker() {}

    async compareImages(bidA, bidB) {
        log('ImageComparator.js', 'compareImages', '开始对比图片');

        const groupsA = groupByHash(bidA);
        const groupsB = groupByHash(bidB);

        const matches = [];

        // 文件级相似度统计：参与对比的唯一图片的像素量（≥ minSize）与命中像素量，
        // 与匹配口径一致（minSize 以下的不参与对比，也不计入分母）。
        // 图片在文件级相似度中按体量（width × height）计权，而非按张数
        const isEligible = (rep) => rep.width >= this.options.minSize && rep.height >= this.options.minSize;

        const sumPixels = (groups, hashes) => {
            let sum = 0;

            for (const hash of hashes) {
                const { width, height } = groups.get(hash).rep;

                sum += width * height;
            }

            return sum;
        };

        const eligibleHashes = (groups) => {
            const hashes = [];

            for (const [hash, { rep }] of groups) {
                if (isEligible(rep)) {
                    hashes.push(hash);
                }
            }

            return hashes;
        };

        const stats = {
            totalPixelsA: sumPixels(groupsA, eligibleHashes(groupsA)),
            totalPixelsB: sumPixels(groupsB, eligibleHashes(groupsB)),
        };

        const matchedA = new Set();
        const matchedB = new Set();

        // 唯一哈希间的组合数即精确总数，进度无需再修正
        const progressCallback = factoryProgress(groupsA.size * groupsB.size, this.processHandler);

        for (const [hashA, entryA] of groupsA) {
            const { rep: repA } = entryA;

            for (const [hashB, entryB] of groupsB) {
                progressCallback();

                const { rep: repB } = entryB;

                // 图片尺寸小于最小尺寸，跳过
                if (!isEligible(repA) || !isEligible(repB)) {
                    continue;
                }

                const sizeRatio = repA.height / repA.width / (repB.height / repB.width);

                // 尺寸比例相差过大，跳过
                if (sizeRatio < 1 / this.options.ratioTolerance || sizeRatio > this.options.ratioTolerance) {
                    continue;
                }

                const similarity = compareHashes(hashA, hashB);

                if (similarity >= this.options.similarity) {
                    matchedA.add(hashA);
                    matchedB.add(hashB);

                    matches.push({
                        images: [repA.image, repB.image],
                        pages: [repA.pageNumber, repB.pageNumber],
                        // 该图片在各侧出现的全部页码，替代旧版按实例展开的笛卡尔积记录
                        pagesA: entryA.pages,
                        pagesB: entryB.pages,
                        similarity,
                    });
                }
            }
        }

        stats.matchedPixelsA = sumPixels(groupsA, matchedA);
        stats.matchedPixelsB = sumPixels(groupsB, matchedB);

        log('ImageComparator.js', 'compareImages', '对比图片结束：', matches.length);

        return { matches, stats };
    }
}

module.exports = ImageComparator;
