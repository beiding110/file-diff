const nodejieba = require('../jiebaCustom/index.js');

const deduplicationArray = require('./util/deduplicationArray.js');

const REG_PUNCTUATION = require('./punctuation.js'); // 不可能在实体中出现的符号

const GENERIC_ROLE_PREFIX = require('./genericRoles.js'); // 角色泛称词表：以此开头的产出是残片

// 定义实体指示词 和 标签集合
const ENTITY_INDICATORS = require('./indicators.js');

// 全部指示词分支平铺成的单个结尾锚定正则。用于判断「前一词是否已构成某类实体的收尾」——
// 名词短语以指示词收尾后，后继动词必为谓语（越界），无论对哪一类。
// 分支须整体括号分组后统一锚 $：裸 join 会把 $ 绑到最后一个分支，其余分支退化为子串匹配
// （「县城」因含「县」误命中，exec 捕获 "县"）
const CONTEXT_TRIGGERS = new RegExp(
    '(' +
        ENTITY_INDICATORS.filter((indicator) => indicator.word)
            .map((indicator) => indicator.word.source.replace(/^\(|\)\$$/g, ''))
            .join('|') +
    ')$'
);

// 触发词全部分支的字面集合：「裸分支」词（词面与分支等长，如 系统/部门/办公室）是中心语本身，不是宾语整词
const TRIGGER_BRANCHES = new Set(
    ENTITY_INDICATORS.filter((indicator) => indicator.word).flatMap((indicator) => indicator.word.source.replace(/^\(|\)\$$/g, '').split('|'))
);

// 名词性核心词性：可承接动词定语（「行政审批局」「城建施工」中动宾式定语合法）
const CORE_TAGS = new Set(['n', 'ns', 'nt', 'nz', 'nr', 'vn', 'm', 'q']);

// 专名性词性：弱后缀触发的实体，须含专名性成员作为佐证。
// 不含 nr（人名）：人名不是地点性专名——「张建国」类人名末字撞「国$」弱后缀时自我佐证，
// 「我司」被 HMM 标 nr 后给「司选择劳务层」假佐证；真地名佐证走 ns/nt/nz
const PROPER_NOUN_TAGS = new Set(['ns', 'nt', 'nz']);

// 谓语宾语标志词性：宾语位置的专名/习语/方位/简称与（非数字）量词成分——其前动词是谓语而非定语
const OBJECT_FLAG_TAGS = new Set(['ns', 'nt', 'l', 'f', 'j']);

// 行政区划弱后缀单字：机构命名中「（机构名）+市/县/区…（机构类型）」是超高频构词
// （鄂东医疗集团市妇幼保健院 = 鄂东医疗集团 + 市妇幼保健院），行政字是下一机构的级别定语
const ADMIN_SUFFIX = /^[市县区乡村镇]$/;

// 动词性词性：紧邻的动词链前驱（「辅助安装」的辅助之于安装）；
// 单字动词与能愿动词（词典标 d：能够/应该/进行…，见 userdict 能愿动词副词化节）不作链前驱
const VERBAL_PREV_TAGS = new Set(['v', 'vn', 'vb']);

class EntityExtracter {
    /**
     * @param {String} text 正文内容
     * @param {Array} taggedWords 预计算的词性标注结果（可选）：调用方已有分词结果时复用，省一次分词
     */
    constructor(text, taggedWords) {
        this._text = text;
        this._tags = taggedWords || nodejieba.tag(text);
    }

    /**
     * 主提取方法
     * @param {String} regFilter reg 类指示器的执行范围（批量入口分派用）：
     *   'skip' 跳过 reg 类（块实例）；'only' 只跑 reg 类（全文实例）；缺省全跑
     * @returns 提取到的数组
     */
    extract(regFilter) {
        let result = [];

        ENTITY_INDICATORS.forEach(({ type, word, tags, companySuffix, cut, valid, condition, reg, weakSuffix, strongSuffix }) => {
            let res = [];

            if (regFilter === 'skip' && reg) {
                return;
            }

            if (regFilter === 'only' && !reg) {
                return;
            }

            if (reg) {
                // 正文全文按正则取值
                res = this._extractByReg(this._text, { type, reg, valid });
            } else if (condition) {
                // 拆分词性后，按判断条件取值
                res = this._extractByCondition(this._tags, { type, condition });
            } else {
                // 拆分词性后，根据上下文取值
                res = this._extractByContext(this._tags, { type, word, tags, companySuffix, cut, valid, weakSuffix, strongSuffix });
            }

            result = [...result, ...res];
        });

        return deduplicationArray(result, ['entity', 'type']); // 去重
    }

    // 销毁
    destroy() {
        this._tags = null;
        this._text = null;
        this._wordFreq = null;
    }

    static deduplication(...args) {
        return deduplicationArray(...args);
    }

    /**
     * 分块语料的批量提取：跨块词频注入 + reg 类全文取值，块级上下文边界不变。
     *
     * person 的语料级判定（人名高频拒绝，见 indicators.js）依赖全文词频——
     * 逐块独立构造时块内频次恒低，判据失效。此入口对全部块只分词一次，
     * 将各块词形频次求和注入每个实例的 _freqOf，恢复频次的语料级语义。
     *
     * reg 类（书名号/日期等）语义是「正文全文按正则取值」，且书名号会跨块——
     * PDF 行边界常落在书名内部（《市政工程规范和质量检验评定 | 标准》），
     * 逐块匹配丢件——改在块拼接的全文上执行，与整篇形态同口径。
     * condition/context 依赖分词序列，逐块执行。
     *
     * 分词结果全程驻留（约每万字 1MB），按单文件调用以控制内存峰值。
     *
     * @param {String[]} texts 文本块数组（如 parsePDF 产出的按句切分块）
     * @returns 去重后的实体数组
     */
    static extractMany(texts) {
        const tagsList = texts.map((text) => nodejieba.tag(text));

        const wordFreq = new Map();

        for (const tags of tagsList) {
            for (const { word } of tags) {
                wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
            }
        }

        let entities = [];

        // reg 类走全文实例：空 tags 跳过整篇分词（reg 不依赖分词结果）
        const whole = new EntityExtracter(texts.join('\n'), []);

        entities.push(...whole.extract('only'));
        whole.destroy();

        texts.forEach((text, i) => {
            const extracter = new EntityExtracter(text, tagsList[i]);

            extracter._wordFreq = wordFreq; // 注入跨块词频：懒建逻辑跳过块内统计

            entities.push(...extracter.extract('skip'));

            extracter.destroy();
        });

        return deduplicationArray(entities, ['entity', 'type']);
    }

    /**
     * 正文全文按正则取值
     * @param {String} text 正文内容
     * @param {Object} param1 条件对象
     * @returns 提取到的数组
     */
    _extractByReg(text, { type, reg, valid }) {
        var res = text.match(reg);

        if (!res) {
            return [];
        }

        // 实体内空白是排版噪声（PDF 字间空格、书名号跨行的换行），reg 类的真实值
        // （日期/证件号/邮箱等）不含空白；折叠后同形的重复由末尾去重聚合
        res = res.map((item) => item.replace(/\s+/g, ''));

        if (valid) {
            res = res.filter((item) => {
                return valid(item);
            });
        }

        const entities = res.map((item) => {
            return {
                entity: item,
                type,
            };
        });

        return entities;
    }

    /**
     * 拆分词性后，按判断条件取值
     * @param {Array} taggedWords 按词性拆分后的数组
     * @param {Object} param1 条件对象
     * @returns 提取到的数组
     */
    _extractByCondition(taggedWords, { type, condition }) {
        const entities = [];
        const freqOf = (word) => this._freqOf(word); // 全文词频，供语料级判定（如人名高频拒绝）

        for (let i = 0; i < taggedWords.length; i++) {
            const { word, tag } = taggedWords[i];

            if (condition({ word, tag, tags: taggedWords, index: i, freqOf })) {
                entities.push({
                    entity: word,
                    type,
                });
            }
        }

        return entities;
    }

    // 全文词频（按词形计，跨词性同形合并）：懒计算一次
    _freqOf(word) {
        if (!this._wordFreq) {
            this._wordFreq = new Map();

            for (const { word: w } of this._tags) {
                this._wordFreq.set(w, (this._wordFreq.get(w) || 0) + 1);
            }
        }

        return this._wordFreq.get(word) || 0;
    }

    /**
     * 基于上下文提取实体
     * @param {Array} taggedWords 按词性拆分后的数组
     * @param {Object} param1 条件对象
     * @returns 提取到的数组
     */
    _extractByContext(
        taggedWords,
        {
            type: indicatorType,
            word: indicatorWord,
            tags: indicatorTags,
            companySuffix: indicatorCompanySuffix,
            cut: indicatorCut,
            valid: indicatorValid,
            weakSuffix: indicatorWeakSuffix,
            strongSuffix: indicatorStrongSuffix,
        }
    ) {
        const entities = [];

        const radius = 20; // 上下文窗口大小

        let buffer = [];

        for (let i = 0; i < taggedWords.length; i++) {
            const { word, tag } = taggedWords[i];

            const nextList = [];

            // 下文
            for (let j = 1; j <= radius; j++) {
                const idx = taggedWords[j + i];

                if (idx) {
                    nextList.push(idx);
                }
            }

            const bufferHasTrigger = buffer.some(({ word: w }) => indicatorWord.test(w));

            // 检查当前词是否可能是实体的一部分
            const isEntityPart = this._isEntityPart(
                word,
                tag,
                { word: indicatorWord, tags: indicatorTags, companySuffix: indicatorCompanySuffix },
                nextList,
                {
                    prev: taggedWords[i - 1],
                    bufferHasTrigger,
                }
            );

            if (isEntityPart) {
                buffer.push({ word, tag });
            } else if (buffer.length > 0) {
                this._collectBuffer(
                    buffer,
                    {
                        indicatorWord,
                        weakSuffix: indicatorWeakSuffix,
                        strongSuffix: indicatorStrongSuffix,
                        cut: indicatorCut,
                        valid: indicatorValid,
                        type: indicatorType,
                    },
                    entities
                );

                buffer = [];
            }
        }

        // 处理最后一个实体
        if (buffer.length > 0) {
            this._collectBuffer(
                buffer,
                {
                    indicatorWord,
                    weakSuffix: indicatorWeakSuffix,
                    strongSuffix: indicatorStrongSuffix,
                    cut: indicatorCut,
                    valid: indicatorValid,
                    type: indicatorType,
                },
                entities
            );
        }

        return entities;
    }

    /**
     * 组装 buffer 产出实体
     * 名词短语必须以指示词收尾；命中单字（弱）后缀支的实体须有专名性成员佐证
     * @param {Array} buffer 已收集的词性数组
     * @param {Object} param1 条件对象
     * @param {Array} entities 产出到该数组
     */
    _collectBuffer(buffer, { indicatorWord, weakSuffix, strongSuffix, cut, valid, type }, entities) {
        // 断点出现在指示词之前的前缀不成实体
        const triggerMember = [...buffer].reverse().find(({ word: w }) => indicatorWord.test(w));

        if (!triggerMember) {
            return;
        }

        // 命中单字支（弱后缀）的实体语义弱，要求含专名性成员
        const weakHit =
            weakSuffix &&
            weakSuffix.test(triggerMember.word) &&
            !(strongSuffix && strongSuffix.test(triggerMember.word));

        if (weakHit && !buffer.some(({ tag }) => PROPER_NOUN_TAGS.has(tag))) {
            return;
        }

        buffer = this._cutBufferEnds(buffer, cut, indicatorWord);

        const entity = buffer.map((item) => item.word).join('');

        if (valid(entity)) {
            entities.push({
                entity,
                type,
            });
        }
    }

    // 判断是否是实体的一部分
    _isEntityPart(word, tag, { word: indicatorWord, tags: indicatorTags, companySuffix }, nextList, { prev, bufferHasTrigger }) {
        if (REG_PUNCTUATION.test(word)) {
            // 过滤不可能在实体中出现的符号
            return false;
        }

        // 检查是否是地点指示词
        if (indicatorWord.test(word) && indicatorTags.has(tag)) {
            // 行政弱后缀单字紧跟组织触发词收尾词（集团/院/部…）时，组织实体已在前词收尾，
            // 该字是下一机构名的级别定语（「鄂东医疗集团市妇幼保健院」的市），此处断开。
            // 前词是本类触发词时不断——「XX市市中区」是专名链
            if (
                tag === 'n' &&
                ADMIN_SUFFIX.test(word) &&
                prev && CONTEXT_TRIGGERS.test(prev.word) && !indicatorWord.test(prev.word)
            ) {
                return false;
            }

            return true;
        }

        // 检查词性标签、
        // 边界动词（系词、存现动词与纯谓语动词——「是/位于/采用/办理」）在 userdict 标 vb：
        // 不属于任何 tags 池而在此被拒，两侧实体永不粘连；与可作定语的动宾式动词（审批/采购/监理）相对
        if (!indicatorTags.has(tag)) {
            return false;
        }

        // 动词紧跟在其它实体的收尾词之后必为越界谓语（地名做字号前缀的动名词不受此限）
        if (tag === 'v' && prev && CONTEXT_TRIGGERS.test(prev.word)) {
            return false;
        }

        // 谓语判据一（vn 旁路封堵）：副词/形容词后的 vn 是谓语（「立即启动」「严重影响」）——
        // vn 不走下方 v 的核心前邻要求，是谓语粘连进实体的主通道
        if (tag === 'vn' && prev && ['a', 'ad', 'd'].includes(prev.tag)) {
            return false;
        }

        // 谓语判据二（宾语判据）：后邻宾语是整词触发（「影响监控系统」）或含
        // 专名/习语/方位/简称/量词成分（「监测变压器内部」「涉及多个部门」）时，
        // 触发词是动词的宾语而非中心语，动宾结构不是定语。免责三支：
        // 宾语内部另有动词是连续定语链（「智能辅助安装定位系统」的辅助）；
        // 前一词是 ≥2 字动词且区间干净是链上定语（「辅助安装定位系统」的安装——
        // 与之相对，「项目施工涉及多个部门」的涉及与宾语间隔了量词，是谓语；
        // 能愿动词词典标 d，天然不在链前驱之列，「能够检查监控系统」的检查是谓语）；
        // 触发词后还有触发词是双触发复合名（「认证管理中心有限公司」的认证）
        if ((tag === 'v' || tag === 'vn') && this._takesObject(nextList, indicatorWord, indicatorTags, word.length >= 2 && !!prev && prev.word.length >= 2 && VERBAL_PREV_TAGS.has(prev.tag), companySuffix)) {
            return false;
        }

        // 谓语动词、定语形容词是名词短语边界，仅作定语时可进入实体：
        // 须为双字及以上（单字功能动词 到/在/给/让 永不作定语），
        // 前一词是名词性成分，且指示词尚未出现（实体未收尾）
        if (tag === 'v' || tag === 'a') {
            return word.length >= 2 && !!prev && CORE_TAGS.has(prev.tag) && !bufferHasTrigger;
        }

        // 实体已出现指示词（收尾）后，人名不开后缀成分——人名是独立实体的开端
        if (bufferHasTrigger && tag === 'nr') {
            return false;
        }

        // 获取下文中是否存在关键词
        var firstIndex = nextList.findIndex((item) => {
            if (item && indicatorWord.test(item.word)) {
                return true;
            }

            return false;
        });

        // 目标字符前所有项都符合词性，且不存在标点符号；链上动词须作定语（前一词为名词性核心成分）
        if (firstIndex >= 0) {
            let checkList = nextList.slice(0, firstIndex + 1);

            const everyWordBeforeKeyWordIsRightKey = checkList.every((item, idx) => {
                if (!indicatorTags.has(item.tag) || REG_PUNCTUATION.test(item.word)) {
                    return false;
                }

                if (item.tag === 'v') {
                    const p = idx > 0 ? checkList[idx - 1] : { word, tag };

                    return CORE_TAGS.has(p.tag) && !CONTEXT_TRIGGERS.test(p.word);
                }

                return true;
            });

            return everyWordBeforeKeyWordIsRightKey;
        }

        return false;
    }

    /**
     * 谓语宾语判据：动词到首个触发词之间无其他动词（定语链免责）时，
     * 区间或触发词本身命中宾语标志（专名/习语/方位/简称/量词，或非裸分支的整词触发），
     * 说明触发词是动词的宾语——其前动词是谓语
     * @param {Array} nextList 下文窗口
     * @param {RegExp} indicatorWord 指示词正则
     * @param {Set} indicatorTags 指示词标签池
     * @param {Boolean} chainHead 前一词是 ≥2 字动词：到宾语区间无标志成分时本词是链定语（「辅助安装定位系统」的安装）
     * @param {RegExp} companySuffix 公司类触发词的堆叠形态（organization 专有，见 indicators.js）：与「公司」等价的中心语
     * @returns 是谓语（拒绝入实体）为 true
     */
    _takesObject(nextList, indicatorWord, indicatorTags, chainHead, companySuffix) {
        let chain = false; // 宾语内部另有动词：连续定语链（「辅助安装定位系统」的辅助）

        for (let i = 0; i < nextList.length; i++) {
            const item = nextList[i];

            if (!indicatorTags.has(item.tag) || REG_PUNCTUATION.test(item.word)) {
                return false; // 短语边界先于触发词出现，无宾语可言
            }

            if (indicatorWord.test(item.word)) {
                if (chainHead && !chain) {
                    return false; // 动词链的后续动词（区间无标志成分）：链定语
                }

                if (companySuffix && companySuffix.test(item.word)) {
                    return false; // 公司后缀堆叠形态是中心语（「城建施工有限公司」）
                }

                // 触发词之后还有触发词（含公司类型词——它必以「公司」收尾，同样命中指示词）：
                // 双触发复合名的内部成分（「认证管理中心有限公司」的认证）
                if (i + 1 < nextList.length && indicatorWord.test(nextList[i + 1].word)) {
                    return false;
                }

                return !chain && (!TRIGGER_BRANCHES.has(item.word) || OBJECT_FLAG_TAGS.has(item.tag));
            }

            if (item.tag === 'v' || item.tag === 'vn') {
                chain = true;
            } else if (!chain && (OBJECT_FLAG_TAGS.has(item.tag) || (item.tag === 'm' && !/^\d/.test(item.word)))) {
                return true;
            }
        }

        return false;
    }

    /**
     * 根据条件，从两端切除满足条件的项
     * @param {Array} buffer 已经提取到的词性数组
     * @param {Object} cut 条件对象
     * @param {RegExp} indicatorWord 指示词正则
     * @returns 切除后的结果数组
     */
    _cutBufferEnds(buffer, cut = {}, indicatorWord) {
        if (!buffer || !buffer.length) {
            return [];
        }

        const { left, right } = cut;

        let res = [...buffer];

        if (left) {
            // 单字普通名词、角色泛称开头的产出是残片（中文实体首成分以双字专名为主）
            let index = buffer.findIndex(({ word, tag }) => {
                return !(word.length === 1 && tag === 'n') && !GENERIC_ROLE_PREFIX.test(word) && !left({ word, tag });
            });

            // 裁剪不得越过指示词：整词实体（如「工业和信息化部」）不会被裁空
            const keepFrom = buffer.findIndex(({ word }) => {
                return indicatorWord.test(word);
            });

            const stop = Math.min(index === -1 ? Infinity : index, keepFrom);

            res = Number.isFinite(stop) ? buffer.slice(stop) : [];
        }

        if (right) {
            res = res.reverse();

            let index = res.findIndex(({ word, tag }) => {
                return !right({ word, tag });
            });

            res = index === -1 ? [] : res.slice(index);

            res = res.reverse();
        }

        return res;
    }
}

module.exports = EntityExtracter;
