/**
 * 将字符串向量化（字符频率向量）
 * 预计算模长与维数：模长在两两配对的余弦计算中会被反复使用，
 * 构建时一次算好，避免每次配对都重复遍历求平方和
 * @param {String} str 待向量化的字符串
 * @returns {{freq: Object, mag: Number, size: Number}} 向量化后的数据
 */
function getVector(str) {
    const freq = {};

    for (const ch of str) {
        freq[ch] = (freq[ch] || 0) + 1;
    }

    let magSq = 0;
    let size = 0;

    for (const key in freq) {
        magSq += freq[key] * freq[key];
        size++;
    }

    return { freq, mag: Math.sqrt(magSq), size };
}

/**
 * 计算两个向量的余弦相似度
 * 只遍历维数较少一方的频率表，向维数较多一方查表，减少无效查找
 * @param {{freq: Object, mag: Number, size: Number}} vec1 向量1
 * @param {{freq: Object, mag: Number, size: Number}} vec2 向量2
 * @returns Number 相似度
 */
function calculateCosineSimilarity(vec1, vec2) {
    if (!vec1.size || !vec2.size) {
        return 0;
    }

    const [small, large] = vec1.size <= vec2.size ? [vec1, vec2] : [vec2, vec1];

    const smallFreq = small.freq;
    const largeFreq = large.freq;

    let dotProduct = 0;

    for (const key in smallFreq) {
        const lv = largeFreq[key];

        if (lv !== undefined) {
            dotProduct += smallFreq[key] * lv;
        }
    }

    return dotProduct / (vec1.mag * vec2.mag);
}

module.exports = {
    getVector,
    calculateCosineSimilarity,
};
