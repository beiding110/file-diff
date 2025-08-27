// 获取实体
const EntityExtracter = require('../utils/EntityExtracter');

const text = `
`;

console.time();

const extracter = new EntityExtracter(text);

const result = extracter.extract();

console.log(result);

console.timeEnd();
