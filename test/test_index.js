const BidComparator = require('../index.js');

let comparator = new BidComparator();

comparator.textCompareProgressHandlerFactory = function (id) {
    return function (num, str) {
        console.log(id, num, str);
    };
};

comparator.imageCompareProgressHandlerFactory = function (id) {
    return function (num, str) {
        console.log(id, num, str);
    };
};

// BidComparator.preload('./docs/g2-2.pdf');

// 更新对比设置
BidComparator.updateSettings({
    text: {
        threshold: 0.8,
        minLength: 15,
    },
    images: {
        similarity: 0.9,
        resizeWidth: 100,
        minSize: 300,
    },
});

// 开始对比
comparator
    .processFiles(
        [
            './docs/g2-1.pdf',
            './docs/g2-2.pdf',
            // './docs/g2-3.pdf',
        ],
        './docs/g2-exclude.pdf'
    )
    .then((res) => {
        console.log(res);
    });
