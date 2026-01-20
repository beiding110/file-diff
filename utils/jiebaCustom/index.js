const path = require('node:path');
const nodejieba = require('nodejieba');

const userDict = path.join(__dirname, './userdict.utf8');

nodejieba.load({
    dict: nodejieba.DEFAULT_DICT,
    userDict,
});

module.exports = nodejieba;
