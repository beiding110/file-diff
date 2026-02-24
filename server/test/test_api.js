/**
 * API 快速测试脚本
 *
 * 测试服务器基本功能是否正常
 */

const axios = require('axios');

const API_BASE_URL = 'http://localhost:3000';

console.log('=== BidComparator API 测试 ===\n');

async function runTests() {
    let passedTests = 0;
    let totalTests = 0;

    // 测试 1: 健康检查
    totalTests++;
    try {
        console.log('测试 1: 健康检查...');
        const response = await axios.get(`${API_BASE_URL}/health`);
        if (response.data.status === 'ok') {
            console.log('✓ 健康检查通过\n');
            passedTests++;
        } else {
            console.log('✗ 健康检查失败\n');
        }
    } catch (error) {
        console.log('✗ 健康检查失败:', error.message, '\n');
    }

    // 测试 2: 获取队列统计
    totalTests++;
    try {
        console.log('测试 2: 获取队列统计...');
        const response = await axios.get(`${API_BASE_URL}/api/stats`);
        if (response.data.success) {
            console.log('✓ 队列统计获取成功');
            console.log('  统计信息:', response.data.stats, '\n');
            passedTests++;
        } else {
            console.log('✗ 队列统计获取失败\n');
        }
    } catch (error) {
        console.log('✗ 队列统计获取失败:', error.message, '\n');
    }

    // 测试 3: 获取任务列表
    totalTests++;
    try {
        console.log('测试 3: 获取任务列表...');
        const response = await axios.get(`${API_BASE_URL}/api/jobs`);
        if (response.data.success) {
            console.log('✓ 任务列表获取成功');
            console.log(`  当前任务数: ${response.data.jobs.length}\n`);
            passedTests++;
        } else {
            console.log('✗ 任务列表获取失败\n');
        }
    } catch (error) {
        console.log('✗ 任务列表获取失败:', error.message, '\n');
    }

    // 测试 4: 创建任务（不实际执行，只测试接口）
    totalTests++;
    try {
        console.log('测试 4: 创建对比任务...');
        const response = await axios.post(`${API_BASE_URL}/api/compare`, {
            bidFiles: ['./test1.pdf', './test2.pdf'],
            settings: {
                text: { threshold: 0.8, minLength: 15 },
            },
        });

        if (response.data.success && response.data.jobId) {
            console.log('✓ 任务创建成功');
            console.log(`  任务ID: ${response.data.jobId}\n`);

            // 测试 5: 查询任务状态
            totalTests++;
            console.log('测试 5: 查询任务状态...');
            const statusResponse = await axios.get(`${API_BASE_URL}/api/jobs/${response.data.jobId}/status`);
            if (statusResponse.data.success) {
                console.log('✓ 任务状态查询成功');
                console.log(`  状态: ${statusResponse.data.status}\n`);
                passedTests++;
            } else {
                console.log('✗ 任务状态查询失败\n');
            }

            // 清理：删除测试任务
            try {
                await axios.delete(`${API_BASE_URL}/api/jobs/${response.data.jobId}`);
                console.log('✓ 测试任务已清理\n');
            } catch (error) {
                // 忽略清理错误
            }

            passedTests++;
        } else {
            console.log('✗ 任务创建失败\n');
        }
    } catch (error) {
        console.log('✗ 任务创建失败:', error.response?.data || error.message, '\n');
    }

    // 测试结果汇总
    console.log('=================================');
    console.log(`测试结果: ${passedTests}/${totalTests} 通过`);
    console.log('=================================\n');

    if (passedTests === totalTests) {
        console.log('✅ 所有测试通过！API 服务正常。\n');
        process.exit(0);
    } else {
        console.log(`❌ 有 ${totalTests - passedTests} 个测试失败！\n`);
        process.exit(1);
    }
}

// 运行测试
runTests().catch((error) => {
    console.error('测试运行失败:', error);
    process.exit(1);
});
