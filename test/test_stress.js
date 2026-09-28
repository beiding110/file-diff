// 压力测试:7 个大 PDF 两两对比(21 对),监控内存峰值与总耗时
// 可用 WORKERS 环境变量指定 diff 线程数,如: WORKERS=20 node test/test_stress.js
const BidComparator = require('../index.js');

const comparator = new BidComparator();

// 注意:updateSettings 不传 workers 时默认按 'multi' 处理,
// 因此线程数设置必须放在最后,避免被后续调用覆盖
const workerCount = process.env.WORKERS ? parseInt(process.env.WORKERS, 10) : 0;

BidComparator.updateSettings({
    text: { threshold: 0.8, minLength: 15 },
    image: { similarity: 0.9, minSize: 300 },
});

if (workerCount > 0) {
    BidComparator.updateSettings({ workers: workerCount });
    console.log(`diff workers = ${workerCount}`);
}

// 每 5 秒采样一次内存
let peakRss = 0;
let peakHeap = 0;
let peakExternal = 0;

const timer = setInterval(() => {
    const m = process.memoryUsage();

    peakRss = Math.max(peakRss, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
    peakExternal = Math.max(peakExternal, m.external);

    console.log(`[mem] rss=${(m.rss / 1048576).toFixed(0)}MB heap=${(m.heapUsed / 1048576).toFixed(0)}MB external=${(m.external / 1048576).toFixed(0)}MB`);
}, 5000);

timer.unref();

const files = [
    './docs/g1-1.pdf',
    './docs/g1-2.pdf',
    './docs/g2-1.pdf',
    './docs/g2-2.pdf',
    './docs/g2-3.pdf',
    './docs/g3-1.pdf',
    './docs/g3-2.pdf',
];

const start = Date.now();

comparator
    .processFiles(files, './docs/g2-exclude.pdf')
    .then(async (groupId) => {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);

        console.log(`\n对比完成: 21 对, 总耗时 ${elapsed}s`);
        console.log(`内存峰值: rss=${(peakRss / 1048576).toFixed(0)}MB heap=${(peakHeap / 1048576).toFixed(0)}MB external=${(peakExternal / 1048576).toFixed(0)}MB`);

        // 验证结果读取
        const readStart = Date.now();
        const results = await BidComparator.history(groupId);

        console.log(`结果读取: ${results.length} 条, 耗时 ${Date.now() - readStart}ms`);

        clearInterval(timer);
    })
    .catch((e) => {
        console.error('压测失败:', e);
        clearInterval(timer);
        process.exitCode = 1;
    });
