/**
 * 异步文件操作工具函数
 * 封装常用的异步文件操作，避免手动编写 stream 逻辑
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

// 将一些回调风格的函数转换为 Promise
const mkdirAsync = promisify(fs.mkdir);
const statAsync = promisify(fs.stat);
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const readdirAsync = promisify(fs.readdir);

/**
 * 异步写入文件（使用流式写入，适合大文件）
 * @param {String} filePath - 文件路径
 * @param {String|Buffer} content - 要写入的内容
 * @param {Object} options - 选项
 * @returns {Promise<void>}
 */
async function writeFile(filePath, content, options = {}) {
    // 如果是小文件（<5MB），直接使用 promisified 的 writeFileAsync
    const contentSize = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content);

    if (contentSize < 5 * 1024 * 1024) {
        return writeFileAsync(filePath, content, options);
    }

    // 大文件使用流式写入
    return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filePath, options);

        writer.on('error', (err) => {
            reject(err);
        });

        writer.on('finish', () => {
            resolve();
        });

        writer.write(content);
        writer.end();
    });
}

/**
 * 异步写入 JSON 文件
 * @param {String} filePath - 文件路径
 * @param {Object} jsonObj - JSON 对象
 * @param {Object} options - 选项
 * @param {Boolean} options.formatted - 是否格式化（默认 false，节省空间）
 * @returns {Promise<void>}
 */
async function writeJsonFile(filePath, jsonObj, options = {}) {
    const { formatted = false } = options;
    const content = JSON.stringify(jsonObj, null, formatted ? 4 : 0);
    return writeFile(filePath, content, options);
}

/**
 * 异步读取文件（自动判断大小，选择最优策略）
 * @param {String} filePath - 文件路径
 * @param {Object} options - 选项
 * @returns {Promise<String|Buffer>}
 */
async function readFile(filePath, options = {}) {
    try {
        // 获取文件大小
        const stats = await statAsync(filePath);

        // 小文件（<10MB）直接读取
        if (stats.size < 10 * 1024 * 1024) {
            return readFileAsync(filePath, options);
        }

        // 大文件使用流式读取（有 encoding 时拼接字符串，否则拼接 Buffer）
        return new Promise((resolve, reject) => {
            const stream = fs.createReadStream(filePath, options);
            const isText = typeof options === 'string' || options?.encoding;
            let data = isText ? '' : [];
            let buffer = null;

            stream.on('data', (chunk) => {
                if (isText) {
                    data += chunk;
                } else {
                    buffer = buffer ? Buffer.concat([buffer, chunk]) : chunk;
                }
            });

            stream.on('end', () => {
                resolve(isText ? data : buffer);
            });

            stream.on('error', (err) => {
                reject(err);
            });
        });
    } catch (error) {
        throw new Error(`读取文件失败: ${filePath}, 错误: ${error.message}`);
    }
}

/**
 * 异步读取 JSON 文件
 * @param {String} filePath - 文件路径
 * @returns {Promise<Object>}
 */
async function readJsonFile(filePath) {
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content);
}

/**
 * 流式复制文件
 * @param {String} sourcePath - 源文件路径
 * @param {String} targetPath - 目标文件路径
 * @returns {Promise<void>}
 */
async function copyFile(sourcePath, targetPath) {
    return new Promise((resolve, reject) => {
        const reader = fs.createReadStream(sourcePath);
        const writer = fs.createWriteStream(targetPath);

        reader.on('error', (err) => {
            reject(new Error(`读取源文件失败: ${sourcePath}, 错误: ${err.message}`));
        });

        writer.on('error', (err) => {
            reject(new Error(`写入目标文件失败: ${targetPath}, 错误: ${err.message}`));
        });

        writer.on('finish', () => {
            resolve();
        });

        reader.pipe(writer);
    });
}

/**
 * 确保目录存在（如果不存在则创建）
 * 已确认过的目录记入缓存，避免高频写盘场景下重复 stat
 * @param {String} dirPath - 目录路径
 * @returns {Promise<void>}
 */
const _ensuredDirs = new Set();

async function ensureDir(dirPath) {
    if (_ensuredDirs.has(dirPath)) {
        return;
    }

    try {
        await statAsync(dirPath);
        // 目录已存在
    } catch (error) {
        // 目录不存在，创建（包括父目录）
        await mkdirAsync(dirPath, { recursive: true });
    }

    _ensuredDirs.add(dirPath);
}

/**
 * 带并发上限的批量异步执行（保持结果与输入的顺序对应）
 * @param {Array} items - 输入数组
 * @param {Function} mapper - (item, index) => Promise，失败的项返回 undefined
 * @param {Number} concurrency - 并发上限
 * @returns {Promise<Array>}
 */
async function pMap(items, mapper, concurrency = 16) {
    const results = new Array(items.length);
    let cursor = 0;

    const run = async () => {
        while (cursor < items.length) {
            const index = cursor++;

            try {
                results[index] = await mapper(items[index], index);
            } catch (error) {
                console.error(`并发任务失败: #${index}`, error.message);
                results[index] = undefined;
            }
        }
    };

    const workersCount = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({ length: workersCount }, run));

    return results;
}

/**
 * 异步检查文件或目录是否存在
 * @param {String} filePath - 文件或目录路径
 * @returns {Promise<Boolean>}
 */
async function exists(filePath) {
    try {
        await statAsync(filePath);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * 同步检查文件或目录是否存在（快速检查，保留用于性能敏感场景）
 * @param {String} filePath - 文件或目录路径
 * @returns {Boolean}
 */
function existsSync(filePath) {
    return fs.existsSync(filePath);
}

/**
 * 批量读取目录下的所有 JSON 文件（并发读取，失败项跳过）
 * @param {String} dirPath - 目录路径
 * @returns {Promise<Array>} JSON 对象数组
 */
async function readJsonFiles(dirPath) {
    const files = await readdirAsync(dirPath);
    const jsonFiles = files.filter((file) => file.endsWith('.json'));

    // 串行逐个 await 时每个文件都要等上一个的 IO 完成，
    // 并发读取可将百级文件的耗时压缩一个数量级
    const results = await pMap(jsonFiles, async (jsonFile) => {
        return await readJsonFile(path.join(dirPath, jsonFile));
    });

    return results.filter((item) => item !== undefined);
}

/**
 * 删除文件或目录
 * @param {String} filePath - 文件或目录路径
 * @returns {Promise<void>}
 */
async function remove(filePath) {
    const stats = await statAsync(filePath);

    if (stats.isDirectory()) {
        // 递归删除目录
        const rmAsync = promisify(fs.rm);
        return rmAsync(filePath, { recursive: true, force: true });
    } else {
        // 删除文件
        const unlinkAsync = promisify(fs.unlink);
        return unlinkAsync(filePath);
    }
}

module.exports = {
    writeFile,
    readFile,
    writeJsonFile,
    readJsonFile,
    copyFile,
    ensureDir,
    exists,
    existsSync,
    readJsonFiles,
    remove,
    pMap,
};
