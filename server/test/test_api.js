'use strict';

/**
 * API 冒烟测试
 *
 * 先启动服务：npm start（默认 http://localhost:3000）
 * 再运行：npm test
 *
 * 可用环境变量：
 *   SERVER_URL   服务地址（默认 http://localhost:3000）
 *   PDF1/PDF2    测试用 PDF 路径（默认 ../../docs 下的两个小文件）
 */

const fs = require('fs');
const path = require('path');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const PDF1 = process.env.PDF1 || path.join(__dirname, '..', '..', 'docs', '暗标格式工具测试文档.pdf');
const PDF2 = process.env.PDF2 || path.join(__dirname, '..', '..', 'docs', 'g2-exclude.pdf');

const results = [];

function check(name, ok, detail = '') {
    results.push({ name, ok });

    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForJob(jobId, timeoutMs = 10 * 60 * 1000) {
    const startedAt = Date.now();
    let lastProgress = '';

    while (Date.now() - startedAt < timeoutMs) {
        const response = await fetch(`${SERVER_URL}/api/jobs/${jobId}/status`);
        const body = await response.json();

        if (!body.success) {
            throw new Error(`查询任务状态失败: ${JSON.stringify(body)}`);
        }

        const progress = `${body.status} ${body.progress.phase || ''} text=${(body.progress.text * 100).toFixed(0)}%`;

        if (progress !== lastProgress) {
            console.log(`  [job] ${progress}`);
            lastProgress = progress;
        }

        if (body.status === 'completed') {
            return body;
        }

        if (body.status === 'failed') {
            throw new Error(`任务失败: ${body.error}`);
        }

        if (body.status === 'canceled') {
            throw new Error('任务被取消');
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error('等待任务超时');
}

async function testHealth() {
    const response = await fetch(`${SERVER_URL}/health`);
    const body = await response.json();

    check('GET /health', response.status === 200 && body.status === 'ok');
}

async function testPathsMode() {
    console.log('\n--- 本地路径模式 POST /api/compare/paths ---');

    const response = await fetch(`${SERVER_URL}/api/compare/paths`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            bidFiles: [PDF1, PDF2],
            settings: { text: { threshold: 0.8, minLength: 15 } },
        }),
    });

    const body = await response.json();

    check('创建任务', response.status === 202 && body.success && body.jobId, `jobId=${body.jobId}`);

    await waitForJob(body.jobId);

    const resultResponse = await fetch(`${SERVER_URL}/api/jobs/${body.jobId}/result`);
    const resultBody = await resultResponse.json();

    check('获取结果', resultResponse.status === 200 && resultBody.success && resultBody.results.length >= 1,
        `${resultBody.count} 条结果, groupId=${resultBody.groupId}`);

    const first = resultBody.results[0];

    check('结果包含对比数据', first && Array.isArray(first.textSimilarities) && Array.isArray(first.imageMatches),
        `text=${first.textSimilarities.length}, image=${first.imageMatches.length}, meta=${first.metadataMatches.length}`);

    // 图片路径应已映射为 /files/ URL
    const imageUrls = (first.imageMatches || []).flatMap((match) => match.images || []);

    check('缓存图片映射为 URL', imageUrls.every((url) => typeof url === 'string' && !/^[A-Za-z]:[\\/]/.test(url)),
        imageUrls.length ? imageUrls[0].slice(0, 80) : '（本组无图片匹配）');

    if (imageUrls.length) {
        const imageResponse = await fetch(imageUrls[0]);

        check('图片 URL 可下载', imageResponse.status === 200, `HTTP ${imageResponse.status}`);
    }

    return resultBody.groupId;
}

async function testUploadMode() {
    console.log('\n--- 文件上传模式 POST /api/compare ---');

    const form = new FormData();

    form.append('bidFiles', new Blob([fs.readFileSync(PDF1)]), path.basename(PDF1));
    form.append('bidFiles', new Blob([fs.readFileSync(PDF2)]), path.basename(PDF2));
    form.append('settings', JSON.stringify({ text: { threshold: 0.8 } }));

    const response = await fetch(`${SERVER_URL}/api/compare`, { method: 'POST', body: form });
    const body = await response.json();

    check('上传并创建任务', response.status === 202 && body.success && body.jobId, `jobId=${body.jobId}`);

    // 相同内容文件命中解析缓存，应很快完成
    await waitForJob(body.jobId);

    const resultResponse = await fetch(`${SERVER_URL}/api/jobs/${body.jobId}/result`);
    const resultBody = await resultResponse.json();

    check('上传任务获取结果', resultResponse.status === 200 && resultBody.success && resultBody.results.length >= 1);
}

async function testPathsByGroupId(groupId) {
    console.log('\n--- 按 groupId 查询 GET /api/results/:groupId ---');

    const response = await fetch(`${SERVER_URL}/api/results/${groupId}`);
    const body = await response.json();

    check('按 groupId 查询结果', response.status === 200 && body.success && body.groupId === groupId,
        `${body.count} 条`);
}

async function testValidation() {
    console.log('\n--- 参数校验 ---');

    const response1 = await fetch(`${SERVER_URL}/api/compare/paths`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bidFiles: ['D:/not-exist-1.pdf', 'D:/not-exist-2.pdf'] }),
    });

    check('不存在的路径返回 400', response1.status === 400);

    const response2 = await fetch(`${SERVER_URL}/api/jobs/00000000-0000-0000-0000-000000000000/status`);

    check('不存在的任务返回 404', response2.status === 404);

    const response3 = await fetch(`${SERVER_URL}/api/jobs/00000000-0000-0000-0000-000000000000`, { method: 'DELETE' });

    check('取消不存在的任务返回 404', response3.status === 404);
}

async function testListAndStats() {
    console.log('\n--- 列表与统计 ---');

    const jobsResponse = await fetch(`${SERVER_URL}/api/jobs`);
    const jobsBody = await jobsResponse.json();

    check('GET /api/jobs', jobsResponse.status === 200 && jobsBody.jobs.length >= 2, `${jobsBody.jobs.length} 个任务`);

    const statsResponse = await fetch(`${SERVER_URL}/api/stats`);
    const statsBody = await statsResponse.json();

    check('GET /api/stats', statsResponse.status === 200 && statsBody.stats.completed >= 2,
        `completed=${statsBody.stats.completed}`);
}

async function main() {
    console.log(`服务地址: ${SERVER_URL}`);
    console.log(`测试文件: ${PDF1}\n         ${PDF2}`);

    await testHealth();

    const groupId = await testPathsMode();

    await testUploadMode();
    await testPathsByGroupId(groupId);
    await testValidation();
    await testListAndStats();

    const passed = results.filter((item) => item.ok).length;

    console.log(`\n测试结果: ${passed}/${results.length} 通过`);

    if (passed !== results.length) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error('测试执行失败:', error);

    process.exitCode = 1;
});
