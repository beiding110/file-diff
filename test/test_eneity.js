// 获取实体
const EntityExtracter = require('../utils/EntityExtracter');

const text = `

`;

console.time();

const extracter = new EntityExtracter(text);

console.log(extracter._tags);

const result = extracter.extract();

console.log(result);

console.timeEnd();
