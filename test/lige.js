const Diff = require('diff');
const vectorComparator = require('../utils/vectorComparator.js');

const textA =
    '13、使用木材烧火时，要随时有人看管，不准用易燃油料点火，用火完毕要认真熄火。 14、现场应设吸烟室，场内严禁游烟。 15、现场内从事电焊、气焊工作的人员均应受过消防知识教育，持有操作合格证，在 作业前要办理用火手续，并应配备适当的看火人员，看火人员随身应有灭火器具，在焊接 过程中不准撤离岗位。';
const textB =
    '（4）现场设吸烟室，场内严禁吸烟。 （5）现场从事电气焊人员均应受过消防知识教育，持有操作合格证。 在作业前办理用火手续，并配备适当的看火人员，看火人员随身应有灭火 器具，再焊接过程中不准离开岗位。 5、季节施工';

const vectorA = vectorComparator.getVector(textA);
const vectorB = vectorComparator.getVector(textB);

const vsimilarity = vectorComparator.calculateCosineSimilarity(vectorA, vectorB);

console.log(vsimilarity);

function calculateSentenceSimilarity(diff, a, b) {
    let sameCount = 0;

    let strA = '',
        strB = '';

    diff.forEach((part) => {
        if (part.removed) {
            // 被移除的，属于左边
            strA += part.value;
        } else if (part.added) {
            // 新增的，属于右边
            strB += part.value;
        } else {
            // 两边相同的部分
            sameCount += part.value.length;

            strA += `<b>${part.value}</b>`;
            strB += `<b>${part.value}</b>`;
        }
    });

    return {
        a: strA.replaceAll('</b><b>', ''),
        b: strB.replaceAll('</b><b>', ''),
        similarity: sameCount / Math.max(a.length, b.length),
    };
}

const diff = Diff.diffWords(textA, textB);

const res = calculateSentenceSimilarity(diff, textA, textB);

console.log(res);