const REG_SURNAME = require('./surnames.js');

// 定义实体指示词 和 标签集合
module.exports = [
    {
        type: 'location',
        condition({ tag, word }) {
            return new Set(['ns']).has(tag);
        },
    },
    {
        type: 'location',
        word: /(省|市|区|县|乡|镇|村|小区|屯|街道|社区|路|街|巷|号|栋|座|楼|层|室)$/,
        tags: new Set(['ns', 'f', 'n', 'm', 'a', 'zg', 'x']),
        valid(entity) {
            return entity.length >= 3;
        },
    },
    {
        type: 'organization',
        word: /(公司|中心|局|部门|集团|委员会|政府|院|所|银行|典当行|社|俱乐部|基地|园区|会|工作室|俱乐部|联盟|平台|工厂|农场|牧场|渔场|矿场|电站)$/,
        tags: new Set(['n', 'j', 'nt', 'nz', 'l', 'v', 'ns', 'f', 'x', 'vn', 'c', 'eng']),
        valid(entity) {
            return entity.length >= 6;
        },
    },
    {
        type: 'person',
        condition({ tag, word }) {
            if (word.length < 2 || word.length > 10) {
                return false;
            }

            return tag === 'nr' || (tag === 'x' && REG_SURNAME.test(word));
        },
    },
    {
        type: 'time',
        reg: /\d{4} *(\-|\/|年) *\d{1,2} *(\-|\/|月) *\d{1,2} *(日)?/g,
    },
    {
        type: 'mobile',
        condition({ tag, word }) {
            if (word.length !== 11) {
                return false;
            }

            return tag === 'm' && /1[3-9]\d{9}/.test(word);
        },
    },
    {
        type: 'ucc',
        reg: /[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}/g,
        valid(entity) {
            return /[A-HJ-NPQRTUWXY]+/.test(entity);
        },
    },
    {
        type: 'email',
        reg: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    },
    {
        type: 'idcard',
        reg: /[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g,
    },
    {
        type: 'domain',
        reg: /https?:\/\/[^\s/$.?#].[^\s]*/g,
    },
];
