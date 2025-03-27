const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const DIR_PATH = path.join(__dirname, '../cache');
const FOLDER_PATH = './files';
const PDF_FILE_NAME = './main.pdf';
const IMAGES_PATH = './images';
const META_FILE_NAME = './meta.json';

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

    checkFilePath() {
        const folderPath = path.join(DIR_PATH, FOLDER_PATH);
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

    checkFileExist(path) {
        return fs.existsSync(path);
    }

    // 将pdf保存到对应目录
    async savePdf(fromFileUrl) {
        if (!this.hash) {
            await this.hashFileAsync(fromFileUrl);
        }

        const { path: fileFolderPath } = this.checkFilePath();

        const targetPath = path.join(fileFolderPath, PDF_FILE_NAME);

        if (this.checkFileExist(targetPath)) {
            // 已经存在，则不进行重新存放
            return targetPath;
        }

        fs.writeFileSync(targetPath, fs.readFileSync(fromFileUrl));

        return targetPath;
    }

    // 将图片保存至对应目录
    async saveImage({ data, width, height, name }) {
        if (!this.hash) {
            await this.hashFileAsync(fromFileUrl);
        }

        const { path: fileFolderPath } = this.checkFilePath();

        const targetPath = path.join(fileFolderPath, IMAGES_PATH);

        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath);
        }

        const fileSavePath = path.join(targetPath, `./${name}.png`);

        if (this.checkFileExist(fileSavePath)) {
            // 已经存在，则不进行重新存放
            return fileSavePath;
        }

        return new Promise((resolve, reject) => {
            let newfile = new PNG({ width, height });

            let array;

            switch (data.length) {
                case width * height * 3: {
                    array = new Uint8ClampedArray(width * height * 4);

                    for (let index = 0; index < array.length; index++) {
                        // Set alpha channel to full
                        if (index % 4 === 3) {
                            array[index] = 255;
                        }
                        // Copy RGB channel components from the original array
                        else {
                            array[index] = data[~~(index / 4) * 3 + (index % 4)];
                        }
                    }

                    break;
                }
                case width * height * 4: {
                    array = data;
                    break;
                }
                default: {
                    console.error('Unknown imgData format!');
                }
            }

            newfile.data = array;

            const pipe = newfile.pack().pipe(fs.createWriteStream(fileSavePath));

            pipe.on('finish', () => {
                resolve(fileSavePath);
            });

            pipe.on('error', (e) => {
                reject(e);
            });
        });
    }

    async saveMetaInfo(json) {
        if (!this.hash) {
            await this.hashFileAsync(fromFileUrl);
        }

        const { path: fileFolderPath } = this.checkFilePath();

        const targetPath = path.join(fileFolderPath, META_FILE_NAME);

        if (this.checkFileExist(targetPath)) {
            // 已经存在，则不进行重新存放
            return targetPath;
        }

        fs.writeFileSync(targetPath, JSON.stringify(json));

        return targetPath;
    }
}

module.exports = CacheFile;
