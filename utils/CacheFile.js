const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { log } = require('../utils/log.js');
const asyncFileUtils = require('./asyncFileUtils.js');

var DIR_PATH = path.join(__dirname, '../cache');

const FILE_FOLDER_PATH = './files';
const PDF_FILE_NAME = './main.pdf';
const IMAGES_PATH = './images';
const PARSE_FILE_NAME = './parse.json';

const RESULT_FOLDER_PATH = './result';

class CacheFile {
    constructor() {
        this.hash = '';
    }

    // enum
    algorithmType = {
        SHA256: 'SHA256',
        SHA1: 'SHA1',
        MD5: 'MD5',
    };

    static setCachePath(path) {
        if (!path) {
            return;
        }

        DIR_PATH = path;
    }

    static getCachePath() {
        return DIR_PATH;
    }

    /**
     * 按文件 hash 读取解析结果缓存
     * 统一返回 Promise：命中返回解析对象，未命中或读取失败返回 null
     * @param {String} hash
     * @returns {Promise<Object|null>}
     */
    static async readCacheByHash(hash) {
        const parseFilePath = path.join(DIR_PATH, FILE_FOLDER_PATH, `./${hash}`, PARSE_FILE_NAME);

        if (!fs.existsSync(parseFilePath)) {
            return null;
        }

        try {
            return await asyncFileUtils.readJsonFile(parseFilePath);
        } catch (error) {
            log('CacheFile.js', 'readCacheByHash', '读取缓存出错:', hash, error.message);

            return null;
        }
    }

    /**
     * promise（异步流式计算，不阻塞事件循环）
     * @param filePath
     * @param algorithm
     * @returns {Promise<string>}
     */
    hashFile(filePath, algorithm = 'SHA256') {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(filePath)) {
                reject(new Error(`the file does not exist, make sure your file is correct: ${filePath}`));
                return;
            }

            if (!this.algorithmType.hasOwnProperty(algorithm)) {
                reject(new Error('nonsupport algorithm, make sure your algorithm is [SHA256,SHA1,MD5] !'));
                return;
            }

            let stream = fs.createReadStream(filePath);
            let hash = crypto.createHash(algorithm.toLowerCase());

            stream.on('data', (data) => {
                hash.update(data);
            });

            stream.on('end', () => {
                let final = hash.digest('hex');

                this.hash = final;

                resolve(final);
            });

            stream.on('error', (err) => {
                reject(err);
            });
        });
    }

    // 检查缓存情况
    checkIsCached() {
        if (!this.hash) {
            console.log('请在检查cache前，需要先生成hash');
            return false;
        }

        let parseFilePath = path.join(DIR_PATH, FILE_FOLDER_PATH, `./${this.hash}`, PARSE_FILE_NAME);

        if (fs.existsSync(parseFilePath)) {
            let context = fs.readFileSync(parseFilePath);

            return JSON.parse(context);
        }

        return false;
    }

    // 检查缓存地址路径是否存在，没有则创建
    checkFilePath() {
        const folderPath = path.join(DIR_PATH, FILE_FOLDER_PATH);
        const fileFolderPath = path.join(folderPath, `./${this.hash}`);

        let exist = false;

        if (!fs.existsSync(fileFolderPath)) {
            // recursive 确保多级目录一并创建
            fs.mkdirSync(fileFolderPath, { recursive: true });
        } else {
            exist = true;
        }

        return {
            path: fileFolderPath,
            exist,
        };
    }

    // 检查目标文件（夹）是否存在
    checkFileExist(path) {
        return fs.existsSync(path);
    }

    // 将pdf保存到对应目录
    async savePdf(fromFileUrl) {
        if (!this.hash) {
            // 异步流式计算哈希，失败时抛出错误由调用方处理
            await this.hashFile(fromFileUrl);
        }

        const { path: fileFolderPath } = this.checkFilePath();

        const pdfPath = path.join(fileFolderPath, PDF_FILE_NAME);

        if (this.checkFileExist(pdfPath)) {
            // 已经存在，则不进行重新存放
            return { pdfPath, hash: this.hash };
        }

        // 使用流式复制，避免同步阻塞
        await asyncFileUtils.copyFile(fromFileUrl, pdfPath);

        return {
            pdfPath,
            hash: this.hash,
        };
    }

    // 将图片保存至对应目录
    async saveImage({ data, width, height, name }) {
        if (!this.hash) {
            throw new Error('请先获取文件hash');
        }

        log('CacheFile.js', 'saveImage', '开始缓存图片');

        const { path: fileFolderPath } = this.checkFilePath();

        const targetPath = path.join(fileFolderPath, IMAGES_PATH);

        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
        }

        const fileSavePath = path.join(targetPath, `./${name}.png`);

        if (this.checkFileExist(fileSavePath)) {
            // 之前解析中断时图片已落盘但 parse.json 未写入（断点续传场景）。
            // 从已缓存文件重算哈希并返回，避免该图片从解析结果中丢失
            try {
                log('CacheFile.js', 'saveImage', '图片已存在，重算哈希：', fileSavePath);

                const imageHash = await _getImageHash(sharp(fileSavePath));

                return {
                    image: fileSavePath,
                    imageHash,
                };
            } catch (e) {
                log('CacheFile.js', 'saveImage', '读取已存在图片失败，跳过：', e);

                return false;
            }
        }

        // 计算通道数，可能是3/4通道
        const channels = Math.round(data.length / width / height);

        if (channels !== 3 && channels !== 4) {
            log('CacheFile.js', 'saveImage', '无法识别的通道数，跳过图片：', channels);

            return false;
        }

        log('CacheFile.js', 'saveImage', '使用sharp进行缓存，通道数：', channels);

        try {
            const orgImg = await sharp(data, {
                raw: {
                    width,
                    height,
                    channels,
                },
            });

            const result = {
                image: '',
                imageHash: '',
            };

            // 计算hash
            result.imageHash = await _getImageHash(orgImg);

            // 原图（降低压缩级别换取编码速度，缓存图仅供展示用）
            await orgImg.png({ compressionLevel: 3 }).toFile(fileSavePath);

            result.image = fileSavePath;

            log('CacheFile.js', 'saveImage', '缓存图片完毕：', fileSavePath);

            return result;
        } catch (e) {
            log('CacheFile.js', 'saveImage', '缓存图片失败：', e);

            // 失败时返回 false，由调用方跳过该图片
            return false;
        }
    }

    // 保存处理后的内容
    async saveParseInfo(json) {
        if (!this.hash) {
            throw new Error('请先获取文件hash');
        }

        const { path: fileFolderPath } = this.checkFilePath();

        const targetPath = path.join(fileFolderPath, PARSE_FILE_NAME);

        if (this.checkFileExist(targetPath)) {
            // 已经存在，则不进行重新存放
            return targetPath;
        }

        // 使用异步写入，避免阻塞
        await asyncFileUtils.writeJsonFile(targetPath, json, { formatted: true });

        return targetPath;
    }

    // 保存结果
    static async saveResult(json, filename) {
        // 使用异步工具函数
        const folderPath = path.join(DIR_PATH, RESULT_FOLDER_PATH);

        // 确保目录存在
        await asyncFileUtils.ensureDir(DIR_PATH);
        await asyncFileUtils.ensureDir(folderPath);

        // 进行存储
        const resultFileExtraName = filename || new Date().getTime();
        const resultFileName = `./${resultFileExtraName}.json`;
        const targetPath = path.join(folderPath, resultFileName);

        // 进行存储
        await asyncFileUtils.writeJsonFile(targetPath, json);

        return targetPath;
    }

    /**
     * 增量保存单个对比结果（优化内存使用）
     * @param {Object} resultItem - 单个对比结果对象
     * @param {String} groupid - 组ID
     * @param {String} uuid - 结果唯一标识
     * @returns {Promise<String>} 保存的文件路径
     */
    static async appendResult(resultItem, groupid, uuid) {
        // 使用异步工具函数
        const resultFolderPath = path.join(DIR_PATH, RESULT_FOLDER_PATH);
        const groupFolderPath = path.join(resultFolderPath, `./${groupid}`);

        // 确保目录存在
        await asyncFileUtils.ensureDir(DIR_PATH);
        await asyncFileUtils.ensureDir(resultFolderPath);
        await asyncFileUtils.ensureDir(groupFolderPath);

        // 保存单个结果文件，使用 uuid 作为文件名
        const resultFileName = `./${uuid}.json`;
        const targetPath = path.join(groupFolderPath, resultFileName);

        await asyncFileUtils.writeJsonFile(targetPath, resultItem);

        return targetPath;
    }

    /**
     * 获取对比结果
     * @param {String} filename - 文件名或组ID（可选）
     * @returns {Promise<Array|Object|null>} 对比结果
     *
     * 用法1：传入文件名，返回单个 JSON 文件内容
     *   getResult('abc123') -> 读取 ./result/abc123.json
     *
     * 用法2：传入组ID，返回该组下所有对比结果
     *   getResult('group-uuid') -> 读取 ./result/group-uuid/*.json 并返回数组
     *
     * 用法3：不传参数，返回之前缓存的所有结果
     *   getResult() -> [...]
     */
    static async getResult(filename) {
        let resultFolderPath = path.join(DIR_PATH, RESULT_FOLDER_PATH);

        if (filename) {
            // 检查是旧格式的文件还是新格式的组文件夹
            const filePath = path.join(resultFolderPath, `./${filename}.json`);
            const groupFolderPath = path.join(resultFolderPath, `./${filename}`);

            // 如果是文件（旧格式）
            if (fs.existsSync(filePath)) {
                return await asyncFileUtils.readJsonFile(filePath);
            }

            // 如果是组文件夹
            if (fs.existsSync(groupFolderPath) && fs.statSync(groupFolderPath).isDirectory()) {
                // 使用异步批量读取
                return await asyncFileUtils.readJsonFiles(groupFolderPath);
            }

            return null;
        }

        // 获取全部文件
        if (!(await asyncFileUtils.exists(resultFolderPath))) {
            return [];
        }

        const files = await _getAllFilesInfo(resultFolderPath);
        const jsonFiles = files.filter((item) => !item.isDirectory && /\.(json)$/.test(item.name));

        // 并发读取，避免大结果集时逐个 await 的串行 IO 等待
        const jsonContext = await asyncFileUtils.pMap(jsonFiles, async (item) => {
            return await asyncFileUtils.readJsonFile(item.path);
        });

        return _groupBy(jsonContext.filter((item) => item !== undefined), 'groupid');
    }
}

/**
 * 深度获取文件夹地址下所有文件（夹）
 * @param {String} dirPath 文件夹地址
 * @returns
 */
async function _getAllFilesInfo(dirPath) {
    const itemsInfo = [];
    const { readdir, stat } = fs.promises;

    // 异步遍历，避免大结果集时同步 readdir/stat 阻塞事件循环
    async function traverseDirectory(currentPath) {
        const items = await readdir(currentPath);

        for (const item of items) {
            const itemPath = path.join(currentPath, item);

            // 注意：局部变量不能命名为 stat，否则遮蔽外层解构的 stat 函数
            // （const 暂时性死区会导致 "Cannot access 'stat' before initialization"）
            const itemStat = await stat(itemPath);

            const statIsDir = itemStat.isDirectory();

            if (itemStat.isFile() || statIsDir) {
                itemsInfo.push({
                    name: item,
                    path: itemPath,
                    size: itemStat.size,
                    createdAt: itemStat.ctime,
                    modifiedAt: itemStat.mtime,
                    isDirectory: statIsDir,
                });
            }

            if (statIsDir) {
                await traverseDirectory(itemPath);
            }
        }
    }

    await traverseDirectory(dirPath);

    return itemsInfo;
}

/**
 * 将数组按条件分组，条件可以是函数，也可以是字段名（没有字段的项不参与分组，直接返回在结果中）
 * @param {Array} arr 待分组的数组
 * @param {Function|String} filter 分组函数或分组字段
 * @returns 分组结果数组
 */
function _groupBy(arr, filter) {
    const groupMap = {};
    const result = [];

    arr.forEach((item) => {
        if (typeof filter === 'function') {
            let key = filter(item);

            groupMap[key] = groupMap[key] || [];

            groupMap[key].push(item);
        }

        if (typeof filter === 'string') {
            let key = item[filter];

            if (key) {
                groupMap[key] = groupMap[key] || [];

                groupMap[key].push(item);
            } else {
                result.push(item);
            }
        }
    });

    return [...Object.values(groupMap), ...result];
}

async function _getImageHash(sharpObj) {
    const resized = await sharpObj
        .clone()
        .resize(10, 10, {
            fit: 'fill',
        })
        .grayscale()
        .raw()
        .toBuffer();

    const avg = resized.reduce((sum, val) => sum + val, 0) / resized.length;

    return resized.map((val) => (val > avg ? '1' : '0')).join('');
}

module.exports = CacheFile;
