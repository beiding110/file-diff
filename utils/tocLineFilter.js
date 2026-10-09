/**
 * 目录行识别：目录页的引导点线（"标题............12"）是排版元素而非正文，
 * 参与文字对比只会制造"两份文件目录结构相似"的重复噪音。
 * 解析侧（parsePage.js）与对比侧（TextComparator.js）共用同一判据：
 * 前者让新解析的文件从源头干净（缓存/实体提取同步受益），
 * 后者兜底过滤旧缓存中的目录行（缓存按文件 hash 存，解析逻辑变更不会触发重解析）。
 *
 * 判据基于点线的伴随结构而非单纯点数——目录点线最短可到 4 个点（短标题宽页码），
 * 与正文省略号（......，6 点）在点数上重叠，无法只按长度区分
 * （判据在 docs/ 全量样例上验证：321 条目录行全命中，"依次类推......" 等正文省略号零误伤）。
 */

// 目录引导点线：4 个及以上连续点（全角点 ． 已在上游 NFKC 归一化为半角）
const DOT_RUN = /\.{4,}/g;

// 点线后跟页码数字结尾："七、施工方案............340"
const PAGE_NUMBER_TAIL = /\.{4,}\s*\d+$/;

/**
 * 是否为目录行（整块视为排版元素，应从文字对比中剔除）
 * @param {string} text 句块文本（已经 NFKC 归一化、断句后的形态）
 * @returns {boolean}
 */
function isTocLine(text) {
    const runs = text.match(DOT_RUN);

    if (!runs) {
        return false;
    }

    // 单处点线但以页码结尾：典型的一行式目录条目
    if (PAGE_NUMBER_TAIL.test(text)) {
        return true;
    }

    // 多处点线：多行目录被分段/断句拼进同一句块
    //（目录条目间没有断句标点，"标题....3标题....4" 是常态形态）
    if (runs.length >= 2) {
        return true;
    }

    // 点与空白撑满句块：被字体分组/断句拆开的纯引导线（页码落在别的句块）。
    // 阈值 8 高于正文省略号（6 点），"依次类推......"（7 点）不会误伤
    if (text.replace(/[^\s.]/g, '').length >= 8) {
        return true;
    }

    return false;
}

module.exports = { isTocLine };
