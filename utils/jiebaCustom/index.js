const path = require('node:path');
const nodejieba = require('nodejieba');

// 本模块优先面向 Node.js 环境：字典都在真实文件系统上，路径原样使用。
// 仅当运行在 Electron 打包环境（路径穿过 app.asar 归档）时需要改写：
// electron-builder 会把字典解包到 app.asar.unpacked，而 Node 的 require/fs
// 会被 Electron 自动重定向，nodejieba 底层的 C++ std::ifstream 不会。
// 这里以路径特征为准而非检测运行环境，且不引入对 electron 模块的依赖——
// 纯 Node 环境下路径不含 app.asar，函数恒为原样返回。
const toNativePath = (p) => (
    p.includes(`app.asar${path.sep}`)
        ? p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
        : p
);

// nodejieba.load 未显式传入的字典会回落到这些默认常量，一并改写
[
    'DEFAULT_DICT',
    'DEFAULT_HMM_DICT',
    'DEFAULT_USER_DICT',
    'DEFAULT_IDF_DICT',
    'DEFAULT_STOP_WORD_DICT',
].forEach((key) => {
    nodejieba[key] = toNativePath(nodejieba[key]);
});

const userDict = toNativePath(path.join(__dirname, './userdict.utf8'));

nodejieba.load({
    dict: nodejieba.DEFAULT_DICT,
    userDict,
});

module.exports = nodejieba;
