const REG_SURNAME = require('./surnames.js');

/**
 * 判断应当成对出现的符号，是否成对出现
 * @param {String} str 字符串
 * @returns 结果true为成对出现，false为不成对出现
 */
function areParenthesesBalanced(str) {
    const map = [
        [/\)/g, /\(/g],
        [/）/g, /（/g],
        [/】/g, /【/g],
        [/]/g, /\[/g],
        [/}/g, /{/g],
        [/>/g, /</g],
        [/》/g, /《/g],
        [/”/g, /“/g],
    ];

    const res = map.every(([rightReg, leftReg]) => {
        let r = str.match(rightReg);

        if (r && r.length) {
            let l = str.match(leftReg);

            return r.length === l?.length;
        }

        return true;
    });

    return res;
}

// 定义实体指示词 和 标签集合
module.exports = [
    {
        type: 'location',
        condition({ tag, word }) {
            return tag === 'ns';
        },
    },
    {
        type: 'location',
        word: /(省|市|区|县|乡|镇|村|屯|街道|路|街|巷|号|栋|座|楼|层|室)$/,
        tags: new Set(['a', 'f', 'm', 'n', 'ns', 'nt', 'x', 'q']),
        cut: {
            // 裁剪函数，将左侧符合条件的全部依次裁剪掉
            left({ word, tag }) {
                return ['v', 'n', 'm', 'q'].includes(tag) || /^(\(|\)|（|）)/.test(word);
            },
            right: null,
        },
        valid(entity) {
            return (
                entity.length >= 3 &&
                !/(单号|编号|证号|账号|公众号|服务号)$/.test(entity) &&
                areParenthesesBalanced(entity)
            );
        },
    },
    {
        type: 'organization',
        word: /(公司|中心|局|部门|集团|政府|院|所|银行|典当行|合作社|学社|俱乐部|基地|园区|协会|商会|学会|基金会|工作室|俱乐部|联盟|工厂|农场|牧场|渔场|矿场|电站)$/,
        tags: new Set(['an', 'c', 'eng', 'f', 'j', 'l', 'm', 'n', 'ns', 'nt', 'nz', 'v', 'vn', 'x']),
        cut: {
            // 裁剪函数，将左侧符合条件的全部依次裁剪掉
            left({ word, tag }) {
                return ['c', 'v', 'n'].includes(tag) || /^(\(|\)|（|）|\d)/.test(word);
            },
            right: null,
        },
        valid(entity) {
            return entity.length >= 6 && areParenthesesBalanced(entity);
        },
    },
    {
        type: 'system',
        word: /(平台|系统|网)$/,
        tags: new Set(['c', 'eng', 'f', 'j', 'l', 'm', 'n', 'ns', 'nt', 'nz', 'v', 'vn', 'x']),
        cut: {
            // 裁剪函数，将左侧符合条件的全部依次裁剪掉
            left({ word, tag }) {
                return ['c', 'v', 'n'].includes(tag) || /^(\(|\)|（|）|\d)/.test(word);
            },
            right: null,
        },
        valid(entity) {
            return entity.length >= 6 && areParenthesesBalanced(entity);
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
    {
        type: 'paper',
        reg: /《([^《》]+)》/g,
    },
];
