/**
 * 将字符串向量化
 * @param {String} str 待向量化的字符串
 * @returns Object 向量化后的数据
 */
function getVector(str) {
    // 使用结巴分词提取关键词及其权重（或简单计数）
    // const words = nodejieba.cut(str);
    const words = str.split('');
    const freqMap = {};

    words.forEach((word) => {
        freqMap[word] = (freqMap[word] || 0) + 1;
    });

    return freqMap;
}

/**
 * 计算两个向量的相似度
 * @param {Object} vec1 向量1
 * @param {Object} vec2 向量2
 * @returns Number 相似度
 */
function calculateCosineSimilarity(vec1, vec2) {
    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;

    // 优化：单次循环处理相似度
    for (const key in vec1) {
        if (vec2[key]) dotProduct += vec1[key] * vec2[key];
        mag1 += vec1[key] ** 2;
    }

    for (const key in vec2) mag2 += vec2[key] ** 2;

    return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2)) || 0;
}

module.exports = {
    getVector,
    calculateCosineSimilarity,
};
