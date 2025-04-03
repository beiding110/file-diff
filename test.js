import { BidComparator } from './index.js';

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

BidComparator.preload('./docs/g2-3.pdf');

comparator
    .processFiles(
        [
            './docs/g2-1.pdf',
            './docs/g2-2.pdf',
            // './docs/g2-3.pdf',
        ]
        // './docs/g2-exclude.pdf'
    )
    .then((res) => {
        console.log(res);
    });
