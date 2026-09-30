const { single: SURNAME_SINGLE, compound: SURNAME_COMPOUND } = require('./surnames.js');

const BLACKLIST = require('./blacklist.js'); // 词面仲裁表（专名残片/类名整词），与引擎的构词规律分离维护

// 名词功能后缀：以这些字收尾的是术语/普通名词（操作证、布置图、管道工、严密性、堵塞物、贡献奖），
// 人名的末字（名字末字）不在此位出现。仪/星/力等仪器与活跃人名用字同构，不收入
const NOUN_SUFFIX = new Set('性值度率费证表图单者员工户量种类别机器料件部所处室组队物奖'.split(''));

// 大写数字：名部含之为金额词（伍拾、伍万）被 HMM 误标 nr，非人名
const NUMERAL_CHAR = /[壹贰叁肆伍陆柒捌玖拾佰仟万亿零]/;

// 角色标签与称谓：公文中人名的高频邻接语境，用于高频词的语境佐证
const PERSON_ROLE = /(联系|法定代表|委托|代理|负责|监理|总监|总工|签字|签发|编制|审核|复核|验收|队长|班长|组长|厂长|校长|院长|局长|处长|科长|股长|主任|经办|开户|法人|授权|评标|专家|建造师|技术员|安全员|质量员|材料员|资料员|造价师|会计师)/;
const PERSON_HONORIFIC = /(先生|女士|同志|经理|总工|工程师|老师|师傅|教授|董事长|书记|律师|队长|院长|校长|主任|代表)/;

/**
 * 人名的语境佐证：冒号引导、括号内签名、角色标签/称谓邻接、顿号并列
 * （顿号外侧须是人名——「李秀兰、王建国、」；仅凭顿号不算，「、班前会、」类术语列表也用顿号）
 * @param {Array} tags 词性数组
 * @param {Number} index 当前词下标
 * @returns 有佐证为 true
 */
function hasPersonEvidence(tags, index) {
    const prev = tags[index - 1] || {};
    const next = tags[index + 1] || {};

    if (prev.word === '：' || prev.word === ':') return true; // 「联系人：张三」
    if (prev.word === '(' || prev.word === '（' || next.word === ')' || next.word === '）') return true; // 括号内签名
    if (PERSON_ROLE.test(prev.word || '')) return true; // 「委托……（王继飞）」
    if (PERSON_HONORIFIC.test(next.word || '')) return true; // 「张三 经理」

    if (prev.word === '、' && tags[index - 2] && tags[index - 2].tag === 'nr') return true;
    if (next.word === '、' && tags[index + 2] && tags[index + 2].tag === 'nr') return true;

    return false;
}

// 身份证校验码（GB 11643-1999，MOD 11-2）
const IDCARD_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const IDCARD_CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

// 公司类型词：与「公司」等价的中心语，「有限责任公司」= 有限+责任+公司，成分可任意堆叠。
// 一词两用：作为分词整词出现时是中心语而非宾语（「城建施工有限公司」的施工是字号定语，
// 宾语判据据此放行，见 index.js _takesObject）；产出整体仅由它构成（无字号）是残片（valid 据此拒绝）
const COMPANY_TYPE_WORD = /^(?:(?:有限|股份|责任|集团|分|子|支)+)公司$/;

// 统一社会信用代码校验码（GB 32100-2015，MOD 31）
const UCC_CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY';
const UCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

/**
 * 校验 18 位身份证号的校验位
 * @param {String} str 身份证号
 * @returns 结果 true 为校验位正确
 */
function isValidIdcardNumber(str) {
    let sum = 0;

    for (let i = 0; i < 17; i++) {
        sum += Number(str[i]) * IDCARD_WEIGHTS[i];
    }

    return IDCARD_CHECK_CODES[sum % 11] === str[17].toUpperCase();
}

/**
 * 校验 18 位统一社会信用代码的校验位
 * @param {String} str 统一社会信用代码
 * @returns 结果 true 为校验位正确
 */
function isValidUccCode(str) {
    let sum = 0;

    for (let i = 0; i < 17; i++) {
        sum += UCC_CHARS.indexOf(str[i]) * UCC_WEIGHTS[i];
    }

    return UCC_CHARS[(31 - (sum % 31)) % 31] === str[17];
}

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
        let l = str.match(leftReg);

        return r?.length === l?.length;
    });

    return res;
}

// 定义实体指示词 和 标签集合
const INDICATORS = [
    {
        type: 'location',
        word: /(国|省|市|区|县|乡|镇|村|屯|街道|路|街|巷|号|栋|座|楼|层|室|大厦|侧)$/,
        tags: new Set(['a', 'b', 'f', 'm', 'n', 'ns', 'nt', 'nz', 'nr', 'x', 'q', 'v', 'vn']),
        cut: {
            // 裁剪函数，将左侧符合条件的全部依次裁剪掉
            // f（周边/附近/上下类方位词）是相对指称不是专名——「周边街道」裁后因长度不足被拒
            left({ word, tag }) {
                return ['a', 'v', 'm', 'q', 'b', 'r', 'f'].includes(tag) || /^(\(|\)|（|）|\d)/.test(word);
            },
            right: null,
        },
        valid(entity) {
            // 词面仲裁（CA 机构简称粘连、X中国 政策运动构词等，见 blacklist.js）
            if (BLACKLIST.location.test(entity)) {
                return false;
            }

            // 两字实体只放行国名（美国/德国/中国——词典标 ns 自我佐证），其余地点长度下限 3
            if (entity.length === 2) {
                return /国$/.test(entity);
            }

            return entity.length >= 3 && areParenthesesBalanced(entity);
        },
    },
    {
        type: 'organization',
        word: /(公司|中心|局|厅|部门|集团|政府|院|所|银行|支行|分行|典当行|合作社|学社|俱乐部|基地|园区|协会|商会|学会|工会|基金会|十字会|委员会|工作室|联盟|工厂|农场|牧场|渔场|矿场|电站|办公室|幼儿园|小学|中学|大学|学院|医院|部|办|办事处)$/,
        // 公司类触发词的堆叠形态（见 COMPANY_TYPE_WORD）：宾语判据据此放行
        companySuffix: COMPANY_TYPE_WORD,
        // 连词、介词是短语边界，不进入实体
        tags: new Set(['an', 'eng', 'f', 'j', 'l', 'm', 'n', 'ns', 'nt', 'nz', 'v', 'vn', 'x']),
        cut: {
            // 裁剪函数，将左侧符合条件的全部依次裁剪掉（名词性字号不可裁）
            left({ word, tag }) {
                return ['c', 'f', 'v', 'p', 'm', 'r'].includes(tag) || /^(\(|\)|（|）|\d)/.test(word);
            },
            right: null,
        },
        valid(entity) {
            return entity.length >= 6 &&
            !/(场所)$/.test(entity) &&
            // 整体仅由公司类型词堆叠构成（无字号）是残片
            !COMPANY_TYPE_WORD.test(entity) &&
            // 整体可完全切分为触发词串接（委员会+办公室）同样不含字号，是类型词堆叠残片
            !TYPE_WORD_STACK.test(entity) &&
            areParenthesesBalanced(entity);
        },
    },
    {
        type: 'system',
        word: /(平台|系统|网|网站)$/,
        // 连词、介词是短语边界，不进入实体；a（定语形容词）按定语规则进入
        tags: new Set(['a', 'an', 'eng', 'f', 'j', 'l', 'm', 'n', 'ns', 'nt', 'nz', 'v', 'vn', 'x']),
        cut: {
            // 裁剪函数，将左侧符合条件的全部依次裁剪掉（名词性字号不可裁）
            left({ word, tag }) {
                return ['c', 'f', 'v', 'p', 'm', 'r'].includes(tag) || /^(\(|\)|（|）|\d)/.test(word);
            },
            right: null,
        },
        valid(entity) {
            return entity.length >= 6 &&
            !BLACKLIST.system.test(entity) &&
            areParenthesesBalanced(entity);
        },
    },
    {
        type: 'person',
        // 人名的结构规律（任意语句通用，非词表枚举）：
        // 姓氏开头；四字须复姓（单姓四字词是公文四字格，如「严格执行」）；
        // 名部不含大写数字（金额词「伍拾」）；末字非名词后缀（术语「操作证/布置图」）；
        // 高频词须语境佐证（公文中反复出现的是惯用语，真名高频只来自页眉级重复且必带语境）
        condition({ word, tag, tags, index, freqOf }) {
            // 词性门槛：人名标签，或未登录词（后者由下方姓氏等结构规则约束）
            if (tag !== 'nr' && tag !== 'x') {
                return false;
            }

            if (!/^[一-龥]{2,4}$/.test(word)) {
                return false; // 人名是纯汉字短词
            }

            const compound = word.length >= 3 && SURNAME_COMPOUND.has(word.slice(0, 2));

            if (!compound && !SURNAME_SINGLE.has(word[0])) {
                return false; // 姓氏必要条件
            }

            if (word.length === 4 && !compound) {
                return false;
            }

            const namePart = word.slice(compound ? 2 : 1);

            if (NUMERAL_CHAR.test(namePart)) {
                return false;
            }

            if (NOUN_SUFFIX.has(word[word.length - 1])) {
                return false;
            }

            if (tag === 'nr' && freqOf(word) >= 5 && !hasPersonEvidence(tags, index)) {
                return false;
            }

            return true;
        },
    },
    {
        type: 'time',
        reg: /\d{4} *(?:\-|\/|年) *\d{1,2} *(?:\-|\/|月) *\d{1,2} *(?:日)?/g,
        valid(entity) {
            const m = entity.match(/^(\d{4}) *[\-\/年] *(\d{1,2}) *[\-\/月] *(\d{1,2})/);

            if (!m) {
                return false;
            }

            const [, year, month, day] = m.map(Number);

            return year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
        },
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
        type: 'tel',
        reg: /(?:(?:\(|（)0[0-9]{2,3}(?:\)|）)[0-9]{7,8})|(?:0[0-9]{2,3}(?:－|-|–|—)[0-9]{7,8})|(?:400|800)-?[0-9]{3,4}-?[0-9]{4}/g,
    },
    {
        type: 'ucc',
        reg: /[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}/g,
        valid(entity) {
            return /[A-HJ-NPQRTUWXY]/.test(entity) && isValidUccCode(entity);
        },
    },
    {
        type: 'email',
        reg: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    },
    {
        type: 'idcard',
        reg: /[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g,
        valid: isValidIdcardNumber,
    },
    {
        type: 'domain',
        reg: /https?:\/\/(?:[-\w.]|(?:%[\da-fA-F]{2}))*[-\w]/g,
    },
    {
        type: 'paper',
        reg: /《(?:[^《》]+)》/g,
    },
];

// 按后缀长度拆分指示词：命中单字支（办/所/局/网……）的是弱后缀，命中多字支（公司/委员会……）的是强后缀
for (const indicator of INDICATORS) {
    if (indicator.word) {
        const branches = indicator.word.source.replace(/^\(|\)\$$/g, '').split('|');

        const weak = branches.filter((b) => b.length === 1);
        const strong = branches.filter((b) => b.length > 1);

        indicator.weakSuffix = weak.length ? new RegExp(`(${weak.join('|')})$`) : null;
        indicator.strongSuffix = strong.length ? new RegExp(`(${strong.join('|')})$`) : null;
    }
}

// 类型词堆叠正则：organization 触发词表自身的串接。整体可完全切分为触发词的实体
//（委员会办公室 = 委员会+办公室）不含任何字号/专名成分，是类型词堆叠残片——
// COMPANY_TYPE_WORD（公司族堆叠）同一判据的推广，回溯保证任意切分组合都能找到
const TYPE_WORD_STACK = new RegExp(
    '^(?:' +
        INDICATORS.find(({ type }) => type === 'organization').word.source.replace(/^\(|\)\$$/g, '') +
        ')+$'
);

module.exports = INDICATORS;
