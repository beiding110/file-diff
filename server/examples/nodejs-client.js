/**
 * Node.js 客户端示例
 *
 * 演示如何调用 BidComparator API
 */

const axios = require('axios');

const API_BASE_URL = 'http://localhost:3000/api';

// ============ 示例 1: 创建对比任务 ============
async function createCompareTask() {
    try {
        const response = await axios.post(`${API_BASE_URL}/compare`, {
            bidFiles: [
                './docs/file1.pdf',
                './docs/file2.pdf',
                './docs/file3.pdf',
            ],
            biddingFile: './docs/bidding.pdf', // 可选
            settings: {
                text: {
                    threshold: 0.8,
                    minLength: 15,
                },
                image: {
                    similarity: 0.9,
                    minSize: 300,
                },
            },
            cachePath: './cache', // 可选
        });

        console.log('✅ 任务已创建:', response.data);
        return response.data.jobId;
    } catch (error) {
        console.error('❌ 创建任务失败:', error.response?.data || error.message);
        throw error;
    }
}

// ============ 示例 2: 轮询查询任务状态 ============
async function pollJobStatus(jobId, pollInterval = 5000) {
    return new Promise((resolve, reject) => {
        const poll = async () => {
            try {
                const response = await axios.get(`${API_BASE_URL}/jobs/${jobId}/status`);
                const { status, progress } = response.data;

                console.log(`📊 任务状态: ${status}`);
                if (progress) {
                    console.log(`   进度: ${(progress.progress * 100).toFixed(2)}%`);
                    if (progress.message) {
                        console.log(`   消息: ${progress.message}`);
                    }
                }

                if (status === 'completed') {
                    resolve(jobId);
                } else if (status === 'failed') {
                    reject(new Error('任务执行失败'));
                } else {
                    // 继续轮询
                    setTimeout(poll, pollInterval);
                }
            } catch (error) {
                reject(error);
            }
        };

        poll();
    });
}

// ============ 示例 3: 获取任务结果 ============
async function getJobResult(jobId) {
    try {
        const response = await axios.get(`${API_BASE_URL}/jobs/${jobId}/result`);
        console.log('✅ 任务结果:', response.data);
        return response.data.result;
    } catch (error) {
        console.error('❌ 获取结果失败:', error.response?.data || error.message);
        throw error;
    }
}

// ============ 示例 4: 取消任务 ============
async function cancelJob(jobId) {
    try {
        const response = await axios.delete(`${API_BASE_URL}/jobs/${jobId}`);
        console.log('✅ 任务已取消:', response.data);
    } catch (error) {
        console.error('❌ 取消任务失败:', error.response?.data || error.message);
    }
}

// ============ 示例 5: 获取所有任务 ============
async function getAllJobs(state = 'all', limit = 10) {
    try {
        const response = await axios.get(`${API_BASE_URL}/jobs`, {
            params: { state, limit },
        });
        console.log(`📋 任务列表 (共 ${response.data.jobs.length} 个):`);
        response.data.jobs.forEach(job => {
            console.log(`   - ${job.id}: ${job.status}`);
        });
        return response.data.jobs;
    } catch (error) {
        console.error('❌ 获取任务列表失败:', error.response?.data || error.message);
    }
}

// ============ 示例 6: 获取队列统计 ============
async function getStats() {
    try {
        const response = await axios.get(`${API_BASE_URL}/stats`);
        console.log('📊 队列统计:', response.data.stats);
        return response.data.stats;
    } catch (error) {
        console.error('❌ 获取统计失败:', error.response?.data || error.message);
    }
}

// ============ 完整工作流示例 ============
async function completeWorkflow() {
    console.log('=== 完整工作流示例 ===\n');

    try {
        // 1. 创建任务
        console.log('1. 创建对比任务...');
        const jobId = await createCompareTask();

        // 2. 轮询任务状态
        console.log('\n2. 轮询任务状态...');
        await pollJobStatus(jobId, 3000); // 每3秒查询一次

        // 3. 获取结果
        console.log('\n3. 获取任务结果...');
        const result = await getJobResult(jobId);
        console.log('对比结果 GroupID:', result.groupId);

        console.log('\n✅ 工作流完成！');
    } catch (error) {
        console.error('\n❌ 工作流失败:', error.message);
    }
}

// ============ 运行示例 ============
if (require.main === module) {
    // 选择要运行的示例
    const example = process.argv[2] || 'complete';

    switch (example) {
        case 'create':
            createCompareTask();
            break;
        case 'stats':
            getStats();
            break;
        case 'jobs':
            getAllJobs();
            break;
        case 'complete':
            completeWorkflow();
            break;
        default:
            console.log('用法: node nodejs-client.js [create|stats|jobs|complete]');
    }
}

module.exports = {
    createCompareTask,
    pollJobStatus,
    getJobResult,
    cancelJob,
    getAllJobs,
    getStats,
};
