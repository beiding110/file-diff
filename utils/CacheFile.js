const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR_PATH = './cache';
const FOLDER_PATH = './files';
const PDF_FILE_NAME = './main.pdf';

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

        if (!fs.existsSync(DIR_PATH)) {
            fs.mkdirSync(DIR_PATH);
        }

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath);
        }

        if (!fs.existsSync(fileFolderPath)) {
            fs.mkdirSync(fileFolderPath);
        } else {
            return false;
        }

        return fileFolderPath;
    }

    async saveFile(fromFileUrl) {
        await this.hashFileAsync(fromFileUrl);

        const fileFolderPath = this.checkFilePath();

        if (!fileFolderPath) {
            // 已经存在，则不进行重新存放
            return;
        }

        const targetPath = path.join(fileFolderPath, PDF_FILE_NAME);

        fs.writeFileSync(targetPath, fs.readFileSync(fromFileUrl));
    }
}

module.exports = CacheFile;
