const BidComparator = require('../dist/BidComparator.js');

console.log('=== BidComparator 打包验证测试 ===\n');

let passedTests = 0;
let totalTests = 0;
let comparator;

function test(name, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`✓ ${name}`);
        return true;
    } catch (error) {
        console.log(`✗ ${name}`);
        console.log(`  错误: ${error.message}`);
        return false;
    }
}

// ========== 第一部分：模块结构验证 ==========
console.log('【第一部分：模块结构验证】\n');

test('1.1 模块正确导出', () => {
    if (typeof BidComparator !== 'function') {
        throw new Error('BidComparator 不是函数');
    }
});

test('1.2 静态方法存在', () => {
    const methods = ['preload', 'history', 'setCachePath', 'setLogCustomHandler', 'setPreloadProgressHandler', 'updateSettings'];
    methods.forEach(method => {
        if (typeof BidComparator[method] !== 'function') {
            throw new Error(`静态方法 ${method} 不存在`);
        }
    });
});

test('1.3 实例化成功', () => {
    comparator = new BidComparator();
    if (typeof comparator !== 'object') {
        throw new Error('实例创建失败');
    }
});

test('1.4 实例方法存在', () => {
    const methods = ['processFiles', 'across', 'compareBids'];
    methods.forEach(method => {
        if (typeof comparator[method] !== 'function') {
            throw new Error(`实例方法 ${method} 不存在`);
        }
    });
});

test('1.5 实例属性正常', () => {
    if (!Array.isArray(comparator.bidDocsMatrix)) {
        throw new Error('bidDocsMatrix 应该是数组');
    }
    if (comparator.textComparator !== null) {
        throw new Error('textComparator 应该初始为 null');
    }
    if (comparator.imageComparator !== null) {
        throw new Error('imageComparator 应该初始为 null');
    }
});

console.log('');

// ========== 第二部分：配置方法测试 ==========
console.log('【第二部分：配置方法测试】\n');

test('2.1 设置回调工厂', () => {
    comparator.textCompareProgressHandlerFactory = function (id) {
        return function (num, str) {
            // console.log(`  [文本对比 ${id}] ${(num * 100).toFixed(2)}%`);
        };
    };

    comparator.imageCompareProgressHandlerFactory = function (id) {
        return function (num, str) {
            // console.log(`  [图片对比 ${id}] ${(num * 100).toFixed(2)}%`);
        };
    };
});

test('2.2 调用 updateSettings', () => {
    BidComparator.updateSettings({
        text: {
            threshold: 0.8,
            minLength: 15,
        },
        image: {
            similarity: 0.9,
            minSize: 300,
        },
    });
});

test('2.3 调用 setCachePath', () => {
    BidComparator.setCachePath('./cache_test');
});

test('2.4 调用 setLogCustomHandler', () => {
    BidComparator.setLogCustomHandler(
        function (msg) {
            // 自定义日志处理
        },
        { path: null, funName: null }
    );
});

test('2.5 调用 setPreloadProgressHandler', () => {
    BidComparator.setPreloadProgressHandler(function (num, str) {
        // 预加载进度处理
    });
});

console.log('');

// ========== 测试结果汇总 ==========
console.log('=================================');
console.log(`测试结果: ${passedTests}/${totalTests} 通过`);
console.log('=================================\n');

if (passedTests === totalTests) {
    console.log('✅ 所有测试通过！打包文件可以正常使用。\n');
    console.log('📦 打包文件位置: dist/BidComparator.js');
    console.log('📖 使用文档: dist/README.md\n');
    process.exit(0);
} else {
    console.log(`❌ 有 ${totalTests - passedTests} 个测试失败！\n`);
    process.exit(1);
}
