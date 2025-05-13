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

        const fileSavePath = path.join(targetPath, `./${name}.png`);

        if (this.checkFileExist(fileSavePath)) {
            log('CacheFile.js', 'saveImage', '已缓存过，直接读取');

            // 已经存在，则不进行重新存放
            return fileSavePath;
        }

        return new Promise((resolve, reject) => {
            // 计算通道数，可能是3/4通道
            let channels = data.length / width / height;

            log('CacheFile.js', 'saveImage', '使用sharp进行缓存，通道数：', channels);

            sharp(data, {
                raw: {
                    width,
                    height,
                    channels,
                },
            })
                .png()
                .toFile(fileSavePath)
                .then(() => {
                    log('CacheFile.js', 'saveImage', '缓存图片完毕：', fileSavePath);

                    resolve(fileSavePath);
                })
                .catch((e) => {
                    log('CacheFile.js', 'saveImage', '缓存图片失败：', e);

                    reject(e);
                });
        });
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

    static getResult(filename) {
        let folderPath = path.join(DIR_PATH, RESULT_FOLDER_PATH);

        if (filename) {
            // 获取具体文件
            const resultFileName = `./${filename}.json`;
            const targetPath = path.join(folderPath, resultFileName);

            if (!fs.existsSync(targetPath)) {
                return null;
            }

            const context = fs.readFileSync(targetPath);

            return JSON.parse(context);
        }

        // 获取全部文件
        if (!fs.existsSync(folderPath)) {
            return [];
        }

        const files = getAllFilesInfo(folderPath);

        return files
            .filter((file) => {
                return /\.(json)$/.test(file.name);
            })
            .map((item) => {
                const context = fs.readFileSync(item.path);

                return JSON.parse(context);
            });
    }
}

function getAllFilesInfo(dirPath) {
    const itemsInfo = [];

    function traverseDirectory(currentPath) {
        const items = fs.readdirSync(currentPath);

        for (const item of items) {
            const itemPath = path.join(currentPath, item);
            const stat = fs.statSync(itemPath);

            if (stat.isFile() || stat.isDirectory()) {
                itemsInfo.push({
                    name: item,
                    path: itemPath,
                    size: stat.size,
                    createdAt: stat.ctime,
                    modifiedAt: stat.mtime,
                    isDirectory: stat.isDirectory(),
                });
            }

            if (stat.isDirectory()) {
                traverseDirectory(itemPath);
            }
        }
    }

    traverseDirectory(dirPath);
    return itemsInfo;
}

module.exports = CacheFile;
