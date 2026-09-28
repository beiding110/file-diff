/**
 * 对比速率基准测试
 *
 * 用法：
 *   node test/test_speed.js multi    # 多线程（diff 线程数 = CPU 核数，上限 20）
 *   node test/test_speed.js single   # 单线程（1 个 diff 线程）
 *
 * 可用环境变量：
 *   PDFS            参与对比的 PDF 列表（逗号分隔），默认 docs/g2-1.pdf 与 docs/g2-2.pdf
 *   PDF_A / PDF_B   兼容旧变量：只设置这两个时等效两文件列表
 *
 * 方法：
 *   1. 使用独立的临时缓存目录，保证 PDF 解析为冷启动（不被已有缓存跳过）
 *   2. 先 preload 全部文件（4 个解析线程并行），单独计解析时间
 *   3. 再 processFiles 对比（命中解析缓存，不含解析），单独计对比时间
 *   4. 文字/图片对比次数从各对比对完成回调（num===1）的 "current / total" 中累计
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const BidComparator = require('../index.js');

const mode = process.argv[2] === 'single' ? 'single' : 'multi';
// 可用 PDFS 环境变量覆盖对比文件列表（逗号分隔），默认 g2-1 + g2-2
const PDFS = (process.env.PDFS ? process.env.PDFS.split(',') : null) ||
    [process.env.PDF_A || path.join(__dirname, '..', 'docs', 'g2-1.pdf'),
        process.env.PDF_B || path.join(__dirname, '..', 'docs', 'g2-2.pdf')];

// 独立临时缓存目录：保证冷启动，且不污染项目 cache/
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bid-speed-'));

BidComparator.setCachePath(cacheDir);

// 屏蔽主线程调试日志，避免 IO 影响计时
BidComparator.setLogCustomHandler(() => {}, {});

// 与 readme 用法示例一致的对比设置
BidComparator.updateSettings({
    text: {
        threshold: 0.8,
        minLength: 15,
    },
    image: {
        similarity: 0.9,
        minSize: 200,
    },
    workers: mode,
});

// 记录一个阶段的进度：首末回调时间戳 + 各对比对完成回调的精确计数累计
// （processFiles 每个对比对调用一次工厂，完成回调 num===1 携带该对 "current / total"）
function trackProgress() {
    const state = {
        firstAt: null,
        lastAt: null,
        count: 0,
    };

    return {
        factory(id) {
            return (num, str) => {
                const now = Date.now();

                if (state.firstAt === null) {
                    state.firstAt = now;
                }

                state.lastAt = now;

                if (Number(num) === 1) {
                    state.count += Number(String(str).split('/')[0].trim()) || 0;
                }
            };
        },
        getCount() {
            return state.count;
        },
        getElapsedMs() {
            if (state.firstAt === null) {
                return 0;
            }

            return Math.max(state.lastAt - state.firstAt, 1);
        },
    };
}

async function main() {
    console.log(`模式: ${mode}（diff 线程数: ${mode === 'single' ? 1 : Math.min(20, Math.max(2, os.cpus().length))}）`);
    console.log(`文件: ${PDFS.join('\n      ')}`);
    console.log(`缓存: ${cacheDir}\n`);

    // 解析阶段（4 个解析线程并行，两种模式下相同）
    const t0 = Date.now();

    await Promise.all(PDFS.map((file) => BidComparator.preload(file)));

    const parseMs = Date.now() - t0;

    // 对比阶段（命中解析缓存，不含解析时间）
    const comparator = new BidComparator();
    const text = trackProgress();
    const image = trackProgress();

    comparator.textCompareProgressHandlerFactory = text.factory;
    comparator.imageCompareProgressHandlerFactory = image.factory;

    const t1 = Date.now();

    const groupId = await comparator.processFiles(PDFS);

    const compareMs = Date.now() - t1;

    // 每对结果的 compareBids 精确耗时（不含缓存加载与结果写盘）
    const results = await BidComparator.history(groupId);

    console.log(`各对比对耗时: ${results.map((r) => `${r.names[0].slice(0, 12)}×${r.names[1].slice(0, 12)} ${(r.duration / 1000).toFixed(2)}s`).join('，')}`);

    const textPairs = text.getCount();
    const textElapsedMs = text.getElapsedMs();
    const imagePairs = image.getCount();
    const imageElapsedMs = image.getElapsedMs();

    console.log('\n--------- 结果 ---------');
    console.log(`解析时间（冷缓存，4 解析线程）: ${(parseMs / 1000).toFixed(2)}s`);
    console.log(`对比时间（不含解析）: ${(compareMs / 1000).toFixed(2)}s`);
    console.log(`文字对比: ${textPairs} 对，阶段耗时 ${textElapsedMs}ms，速率 ${Math.round(textPairs / (textElapsedMs / 1000))} 段/s`);
    console.log(`图片对比: ${imagePairs} 对，阶段耗时 ${imageElapsedMs}ms，速率 ${Math.round(imagePairs / (imageElapsedMs / 1000))} 图/s（主线程内存哈希对比，与线程数无关）`);
}

main()
    .catch((error) => {
        console.error('基准测试失败:', error);
        process.exitCode = 1;
    })
    .finally(() => {
        // 清理临时缓存（worker 线程可能仍占用文件，失败可忽略，由系统临时目录兜底）
        try {
            fs.rmSync(cacheDir, { recursive: true, force: true });
        } catch (e) {
            /* ignore */
        }
    });
