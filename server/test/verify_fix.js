/**
 * 验证服务器基本功能（不需要 Redis）
 */

const { execSync } = require('child_process');
const path = require('path');

console.log('=== 服务器代码验证 ===\n');

try {
    // 1. 检查语法
    console.log('1. 检查语法...');
    execSync('node -c server.js', {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe',
    });
    console.log('   ✓ 语法检查通过\n');

    // 2. 检查依赖
    console.log('2. 检查依赖...');
    const fs = require('fs');
    const packageJson = require('../package.json');

    const requiredDeps = [
        'fastify',
        '@fastify/websocket',
        '@fastify/cors',
        'bull',
        'ioredis',
        'uuid',
        'axios',
    ];

    for (const dep of requiredDeps) {
        try {
            require.resolve(dep);
            console.log(`   ✓ ${dep}`);
        } catch (error) {
            console.log(`   ✗ ${dep} 未安装`);
            throw new Error(`缺少依赖: ${dep}`);
        }
    }

    console.log('\n✅ 所有检查通过！\n');
    console.log('下一步:');
    console.log('1. 启动 Redis: docker run -d -p 6379:6379 redis:7-alpine');
    console.log('2. 运行服务器: npm start');
    console.log('3. 运行测试: npm test\n');

    process.exit(0);
} catch (error) {
    console.error('\n❌ 检查失败:', error.message);
    process.exit(1);
}
