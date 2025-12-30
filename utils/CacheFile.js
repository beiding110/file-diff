const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { log } = require('../utils/log.js');

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

    static readCacheByHash(hash) {
        let parseFilePath = path.join(DIR_PATH, FILE_FOLDER_PATH, `./${hash}`, PARSE_FILE_NAME);

        if (fs.existsSync(parseFilePath)) {
            let context = fs.readFileSync(parseFilePath);

            return JSON.parse(context);
        }

        return false;
    }

    /**
     * promise
     * @param filePath
     * @param algorithm
     * @returns {Promise<any>}
     */
    hashFile(filePath, algorithm = 'SHA256') {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(filePath)) {
                reject('the file does not exist, make sure your file is correct!');
                return;
            }

            if (!this.algorithmType.hasOwnProperty(algorithm)) {
                reject('nonsupport algorithm, make sure your algorithm is [SHA256,SHA1,MD5] !');
                return;
            }

            let stream = fs.createReadStream(filePath);
            let hash = crypto.createHash(algorithm.toLowerCase());

            stream.on('data', function (data) {
                hash.update(data);
            });

            stream.on('end', function () {
                let final = hash.digest('hex');

                this.hash = final;

                resolve(final);
            });

            stream.on('error', function (err) {
                reject(err);
            });
        });
    }

    /**
     * async
     * @param filePath
     * @param algorithm
     * @returns {string|Error}
     */
    hashFileAsync(filePath, algorithm = 'SHA256') {
        if (!fs.existsSync(filePath)) {
            return new Error('the file does not exist, make sure your file is correct!');
        }
        if (!this.algorithmType.hasOwnProperty(algorithm)) {
            return new Error('nonsupport algorithm, make sure your algorithm is [SHA256,SHA1,MD5] !');
        }

        let buffer = fs.readFileSync(filePath);
        let hash = crypto.createHash(algorithm.toLowerCase());

        hash.update(buffer);
        let final = hash.digest('hex');

        this.hash = final;

        return final;
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

        if (!fs.existsSync(DIR_PATH)) {
            fs.mkdirSync(DIR_PATH);
        }

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath);
        }

        if (!fs.existsSync(fileFolderPath)) {
            fs.mkdirSync(fileFolderPath);
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
            await this.hashFileAsync(fromFileUrl);
        }

        const { path: fileFolderPath } = this.checkFilePath();

        const pdfPath = path.join(fileFolderPath, PDF_FILE_NAME);

        if (this.checkFileExist(pdfPath)) {
            // 已经存在，则不进行重新存放
            return pdfPath;
        }

        fs.writeFileSync(pdfPath, fs.readFileSync(fromFileUrl));

        return {
            pdfPath,
            hash: this.hash,
        };
    }

    // 将图片保存至对应目录
    async saveImage({ data, width, height, name }) {
        if (!this.hash) {
            console.error('请先获取文件hash');
        }

        log('CacheFile.js', 'saveImage', '开始缓存图片');

        const { path: fileFolderPath } = this.checkFilePath();

        const targetPath = path.join(fileFolderPath, IMAGES_PATH);

        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath);
        }

        const result = {
            image: '',
            image300: '',
            image200: '',
            image100: '',
        };

        const fileSavePath = path.join(targetPath, `./${name}.png`);
        const fileSavePath300 = path.join(targetPath, `./${name}.300.png`);
        const fileSavePath200 = path.join(targetPath, `./${name}.200.png`);
        const fileSavePath100 = path.join(targetPath, `./${name}.100.png`);

        if (this.checkFileExist(fileSavePath)) {
            // 已经存在，则不进行重新存放
            return false;
        }

        // 计算通道数，可能是3/4通道
        let channels = data.length / width / height;

        log('CacheFile.js', 'saveImage', '使用sharp进行缓存，通道数：', channels);

        try {
            const orgImg = await sharp(data, {
                raw: {
                    width,
                    height,
                    channels,
                },
            });

            // 原图
            orgImg.png().toFile(fileSavePath);
            result.image = fileSavePath;

            // 灰度处理
            orgImg.grayscale();
            // 300
            if (width > 300) {
                let img = orgImg.clone().resize({ width: 300 });

                img.png().toFile(fileSavePath300);

                result.image300 = fileSavePath300;
            }
            // 200
            if (width > 200) {
                let img = orgImg.clone().resize({ width: 200 });

                img.png().toFile(fileSavePath200);

                result.image200 = fileSavePath200;
            }
            // 100
            if (width > 100) {
                let img = orgImg.clone().resize({ width: 100 });

                img.png().toFile(fileSavePath100);

                result.image100 = fileSavePath100;
            }

            log('CacheFile.js', 'saveImage', '缓存图片完毕：', fileSavePath);
        } catch (e) {
            log('CacheFile.js', 'saveImage', '缓存图片失败：', e);
        }

        return result;
    }

    // 保存处理后的内容
    async saveParseInfo(json) {
        if (!this.hash) {
            console.error('请先获取文件hash');
        }

        const { path: fileFolderPath } = this.checkFilePath();

        const targetPath = path.join(fileFolderPath, PARSE_FILE_NAME);

        if (this.checkFileExist(targetPath)) {
            // 已经存在，则不进行重新存放
            return targetPath;
        }

        fs.writeFileSync(targetPath, JSON.stringify(json, null, 4));

        return targetPath;
    }

    // 保存结果
    static saveResult(json, filename) {
        // 判断缓存文件夹
        if (!fs.existsSync(DIR_PATH)) {
            fs.mkdirSync(DIR_PATH);
        }

        // 判断结果文件夹
        let folderPath = path.join(DIR_PATH, RESULT_FOLDER_PATH);

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath);
        }

        // 进行存储
        const resultFileExtraName = filename || new Date().getTime();
        const resultFileName = `./${resultFileExtraName}.json`;

        const targetPath = path.join(folderPath, resultFileName);

        fs.writeFileSync(targetPath, JSON.stringify(json, null, 4));

        return targetPath;
    }

    /**
     * 增量保存单个对比结果（优化内存使用）
     * @param {Object} resultItem - 单个对比结果对象
     * @param {String} groupid - 组ID
     * @param {String} uuid - 结果唯一标识
     * @returns {String} 保存的文件路径
     */
    static appendResult(resultItem, groupid, uuid) {
        // 判断缓存文件夹
        if (!fs.existsSync(DIR_PATH)) {
            fs.mkdirSync(DIR_PATH);
        }

        // 判断结果文件夹
        let resultFolderPath = path.join(DIR_PATH, RESULT_FOLDER_PATH);

        if (!fs.existsSync(resultFolderPath)) {
            fs.mkdirSync(resultFolderPath);
        }

        // 创建组文件夹
        let groupFolderPath = path.join(resultFolderPath, `./${groupid}`);

        if (!fs.existsSync(groupFolderPath)) {
            fs.mkdirSync(groupFolderPath);
        }

        // 保存单个结果文件，使用 uuid 作为文件名
        const resultFileName = `./${uuid}.json`;
        const targetPath = path.join(groupFolderPath, resultFileName);

        fs.writeFileSync(targetPath, JSON.stringify(resultItem, null, 4));

        return targetPath;
    }

    /**
     * 获取对比结果
     * @param {String} filename - 文件名或组ID（可选）
     * @returns {Array|Object|null} 对比结果
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
    static getResult(filename) {
        let resultFolderPath = path.join(DIR_PATH, RESULT_FOLDER_PATH);

        if (filename) {
            // 检查是旧格式的文件还是新格式的组文件夹
            const filePath = path.join(resultFolderPath, `./${filename}.json`);
            const groupFolderPath = path.join(resultFolderPath, `./${filename}`);

            // 如果是文件（旧格式）
            if (fs.existsSync(filePath)) {
                const context = fs.readFileSync(filePath);
                return JSON.parse(context);
            }

            // 如果是组文件夹
            if (fs.existsSync(groupFolderPath) && fs.statSync(groupFolderPath).isDirectory()) {
                // 读取组文件夹下所有的 json 文件
                const files = fs.readdirSync(groupFolderPath);
                const jsonFiles = files.filter((file) => file.endsWith('.json'));

                // 按文件名排序
                jsonFiles.sort();

                // 逐个读取文件并合并结果
                const results = [];

                for (const jsonFile of jsonFiles) {
                    try {
                        const itemPath = path.join(groupFolderPath, jsonFile);
                        const content = fs.readFileSync(itemPath, 'utf-8');
                        const result = JSON.parse(content);
                        results.push(result);
                    } catch (error) {
                        log('CacheFile.js', 'getResult', `读取文件 ${jsonFile} 失败:`, error.message);
                    }
                }

                return results;
            }

            return null;
        }

        // 获取全部文件
        if (!fs.existsSync(resultFolderPath)) {
            return [];
        }

        const files = _getAllFilesInfo(resultFolderPath);
        const jsonContext = files
            .filter((file) => {
                return /\.(json)$/.test(file.name);
            })
            .map((item) => {
                const context = fs.readFileSync(item.path);

                return JSON.parse(context);
            });

        return _groupBy(jsonContext, 'groupid');
    }
}

/**
 * 深度获取文件夹地址下所有文件（夹）
 * @param {String} dirPath 文件夹地址
 * @returns
 */
function _getAllFilesInfo(dirPath) {
    const itemsInfo = [];

    function traverseDirectory(currentPath) {
        const items = fs.readdirSync(currentPath);

        for (const item of items) {
            const itemPath = path.join(currentPath, item);
            const stat = fs.statSync(itemPath);

            const statIsDir = stat.isDirectory();

            if (stat.isFile() || statIsDir) {
                itemsInfo.push({
                    name: item,
                    path: itemPath,
                    size: stat.size,
                    createdAt: stat.ctime,
                    modifiedAt: stat.mtime,
                    isDirectory: statIsDir,
                });
            }

            if (statIsDir) {
                traverseDirectory(itemPath);
            }
        }
    }

    traverseDirectory(dirPath);

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

module.exports = CacheFile;
