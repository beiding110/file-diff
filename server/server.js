'use strict';

/**
 * BidComparator API Server
 *
 * 将 PDF 投标文件对比类库封装为 HTTP 服务，供其他应用调用。
 *
 * - 内存任务队列（默认串行执行，CPU 密集任务排队跑，无需 Redis）
 * - SSE 实时进度推送（GET /api/jobs/:jobId/events）
 * - 两种提交方式：
 *   - POST /api/compare        multipart/form-data 上传文件（远程调用）
 *   - POST /api/compare/paths  JSON 传服务器本地路径（同机调用，免上传）
 * - 结果持久化在 cache 目录，服务重启后仍可按 groupId 查询
 * - 缓存中的 PDF / 图片通过 /files/ 静态路由暴露，
 *   结果响应里的本地路径会自动映射为可下载 URL
 *
 * 环境变量见 .env.example
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');
const { randomBytes } = require('crypto');

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const fastifyStatic = require('@fastify/static');
const multipart = require('@fastify/multipart');

// 被服务化的库：默认用源码入口，可用 LIB_ENTRY 指向 dist 产物
const LIB_ENTRY = process.env.LIB_ENTRY || path.join(__dirname, '..', 'index.js');
const BidComparator = require(LIB_ENTRY);

const TaskManager = require('./taskManager.js');
const STATUS = TaskManager.STATUS;
const FINISHED_STATUSES = TaskManager.FINISHED_STATUSES;

// ============ 配置 ============

function intEnv(name, fallback) {
    const value = parseInt(process.env[name], 10);

    return Number.isFinite(value) ? value : fallback;
}

const CONFIG = {
    port: intEnv('PORT', 3000),
    host: process.env.HOST || '0.0.0.0',
    // CPU 密集型任务，默认串行；并发 >1 时注意对比设置是全局的，会互相覆盖
    concurrency: Math.max(1, intEnv('CONCURRENCY', 1)),
    // diff 线程数：留空用库默认（按 CPU 核数），也可指定数字
    workers: process.env.WORKERS || null,
    cachePath: process.env.CACHE_PATH || path.join(__dirname, '..', 'cache'),
    tmpRoot: process.env.TMP_DIR || os.tmpdir(),
    maxFileMb: Math.max(1, intEnv('MAX_UPLOAD_MB', 200)),
    maxFiles: Math.max(2, intEnv('MAX_FILES', 50)),
    maxFinishedTasks: Math.max(10, intEnv('MAX_FINISHED_TASKS', 200)),
    // 内存中保留的终态任务元数据条数上限
    defaultSettings: {
        text: { threshold: 0.8, minLength: 15 },
        image: { similarity: 0.9, minSize: 300 },
    },
};

const FILES_ROOT = path.join(CONFIG.cachePath, 'files');

// ============ 日志 ============

function log(...args) {
    console.log(`[${new Date().toLocaleString()}]`, ...args);
}

// ============ 库初始化 ============

fs.mkdirSync(FILES_ROOT, { recursive: true });

BidComparator.setCachePath(CONFIG.cachePath);

if (CONFIG.workers) {
    const workerCount = parseInt(CONFIG.workers, 10);

    // 支持数字；其他值交给库按 'multi'/'single' 处理
    const workers = Number.isFinite(workerCount) && workerCount > 0 ? workerCount : CONFIG.workers;

    BidComparator.updateSettings({ workers });

    log(`diff 线程数: ${workers}`);
}

// ============ 任务管理器 ============

const manager = new TaskManager({
    concurrency: CONFIG.concurrency,
    maxFinishedTasks: CONFIG.maxFinishedTasks,
});

// ============ 对比任务执行 ============

/**
 * 任务处理器：应用设置 → 挂进度回调 → 执行对比
 * 上传文件的临时目录在任务结束后由 _runTaskAndCleanup 清理
 */
async function runCompare(task) {
    const { bidFiles, biddingFile, settings } = task.meta;

    const totalPairs = (bidFiles.length * (bidFiles.length - 1)) / 2;

    manager.setProgress(task.id, { totalPairs, phase: 'parsing' }, { immediate: true });

    // 应用任务级设置。workers 传 null：不触碰服务级线程数配置
    // （updateSettings 不传 workers 时默认按 'multi' 重置，必须显式避开）
    BidComparator.updateSettings({
        text: { ...CONFIG.defaultSettings.text, ...(settings && settings.text) },
        image: { ...CONFIG.defaultSettings.image, ...(settings && settings.image) },
        workers: null,
    });

    // PDF 解析进度（静态全局回调，串行任务下逐次重设）
    BidComparator.setPreloadProgressHandler((filePath, num) => {
        manager.setProgress(task.id, {
            phase: 'parsing',
            parseFile: path.basename(filePath || ''),
            parseProgress: parseFloat(num) || 0,
        });
    });

    const comparator = new BidComparator();

    // 已出现过的对比对 id：新 id 出现即视为推进到下一对
    const seenPairIds = new Set();

    const onPairProgress = (field) => (pairId, num) => {
        if (!seenPairIds.has(pairId)) {
            seenPairIds.add(pairId);

            manager.setProgress(task.id, {
                phase: 'comparing',
                pairId,
                donePairs: seenPairIds.size - 1,
            });
        }

        manager.setProgress(task.id, {
            phase: 'comparing',
            pairId,
            [field]: parseFloat(num) || 0,
        });
    };

    comparator.textCompareProgressHandlerFactory = onPairProgress('text');
    comparator.imageCompareProgressHandlerFactory = onPairProgress('image');

    log(`任务 ${task.id} 开始对比: ${bidFiles.length} 个投标文件${biddingFile ? '，含招标文件' : ''}`);

    const groupId = await comparator.processFiles(bidFiles, biddingFile || null);

    log(`任务 ${task.id} 对比完成, groupId: ${groupId}`);

    return {
        groupId,
        fileCount: bidFiles.length,
        pairCount: totalPairs,
    };
}

/**
 * 包装 runCompare：任务结束后清理上传文件的临时目录。
 * PDF 与图片此时已由库缓存到 cache/files，删除临时目录不丢数据
 */
function _runTaskAndCleanup(task) {
    const { tempDir } = task.meta;

    return runCompare(task).finally(() => {
        if (tempDir) {
            fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    });
}

// ============ 路径 → URL 映射 ============

/**
 * 把结果对象中位于缓存 files 目录内的本地路径替换为可下载 URL，
 * 使远程调用方也能取到图片与原始 PDF（原地修改）
 */
function mapCachePathsToUrls(value, baseUrl) {
    if (typeof value === 'string') {
        // path.win32.relative 不区分大小写，可直接比较
        const relative = path.relative(FILES_ROOT, value);

        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
            const urlPath = relative.split(path.sep).map(encodeURIComponent).join('/');

            return `${baseUrl}/files/${urlPath}`;
        }

        return value;
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            value[index] = mapCachePathsToUrls(item, baseUrl);
        });

        return value;
    }

    for (const key of Object.keys(value)) {
        value[key] = mapCachePathsToUrls(value[key], baseUrl);
    }

    return value;
}

function requestBaseUrl(request) {
    const host = request.headers.host || `localhost:${CONFIG.port}`;

    return `http://${host}`;
}

// 任务对象的对外视图（隐藏内部字段）
function taskView(task) {
    return {
        jobId: task.id,
        status: task.status,
        progress: { ...task.progress },
        input: {
            fileNames: task.meta.fileNames || [],
            biddingFileName: task.meta.biddingFileName || null,
            settings: task.meta.settings || null,
        },
        result: task.result,
        error: task.error,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
    };
}

// ============ HTTP 服务 ============

const fastify = Fastify({
    logger: false,
});

fastify.register(cors, { origin: true });

fastify.register(multipart, {
    limits: {
        fileSize: CONFIG.maxFileMb * 1024 * 1024,
        files: CONFIG.maxFiles + 1,
    },
});

// 缓存静态文件：原始 PDF 与对比用图片
fastify.register(fastifyStatic, {
    root: FILES_ROOT,
    prefix: '/files/',
    decorateReply: true,
});

// 上传文件名净化：仅保留文件名部分，重名自动加随机后缀
function safeUniqueName(filename, usedNames) {
    const basename = path.basename(filename || `file-${randomBytes(2).toString('hex')}`) || 'file';

    if (!usedNames.has(basename)) {
        usedNames.add(basename);

        return basename;
    }

    const extname = path.extname(basename);
    const stem = basename.slice(0, basename.length - extname.length);

    const unique = `${stem}.${randomBytes(4).toString('hex')}${extname}`;

    usedNames.add(unique);

    return unique;
}

/**
 * 创建对比任务（文件上传模式）
 * POST /api/compare
 * multipart/form-data:
 *   - bidFiles    投标 PDF 文件（>=2 个，字段可重复）
 *   - biddingFile 招标 PDF 文件（可选，最多 1 个）
 *   - settings    可选 JSON 字符串：{"text":{"threshold":0.8,"minLength":15},"image":{...}}
 */
fastify.post('/api/compare', async (request, reply) => {
    const tempDir = path.join(CONFIG.tmpRoot, `bid-comparator-${Date.now()}-${randomBytes(4).toString('hex')}`);

    try {
        await fs.promises.mkdir(tempDir, { recursive: true });

        const bidFiles = [];
        let biddingFile = null;
        let settings = null;
        const usedNames = new Set();

        const parts = request.parts();

        for await (const part of parts) {
            if (part.file) {
                const filename = safeUniqueName(part.filename, usedNames);
                const filepath = path.join(tempDir, filename);

                // 流式落盘，避免大文件整体进内存
                await pipeline(part.file, fs.createWriteStream(filepath));

                if (part.fieldname === 'bidFiles') {
                    bidFiles.push(filepath);
                } else if (part.fieldname === 'biddingFile') {
                    biddingFile = filepath;
                } else {
                    // 未知字段的文件直接丢弃
                    await fs.promises.rm(filepath, { force: true });
                }
            } else if (part.fieldname === 'settings') {
                try {
                    settings = JSON.parse(part.value);
                } catch (e) {
                    settings = null;
                }
            }
        }

        if (bidFiles.length < 2) {
            await fs.promises.rm(tempDir, { recursive: true, force: true });

            return reply.code(400).send({
                success: false,
                error: '至少需要上传 2 个投标文件（multipart 字段名 bidFiles）',
            });
        }

        if (bidFiles.length > CONFIG.maxFiles) {
            await fs.promises.rm(tempDir, { recursive: true, force: true });

            return reply.code(400).send({
                success: false,
                error: `投标文件数量超过上限 ${CONFIG.maxFiles}`,
            });
        }

        const task = manager.submit(
            {
                bidFiles,
                biddingFile,
                settings,
                tempDir,
                fileNames: bidFiles.map((file) => path.basename(file)),
                biddingFileName: biddingFile ? path.basename(biddingFile) : null,
            },
            _runTaskAndCleanup,
        );

        return reply.code(202).send({
            success: true,
            jobId: task.id,
            status: task.status,
            message: '对比任务已创建',
        });
    } catch (error) {
        // 上传中断 / 文件超限等
        fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});

        const isTooLarge = error && (error.statusCode === 413 || /file size/i.test(error.message || ''));

        return reply.code(isTooLarge ? 413 : 500).send({
            success: false,
            error: error.message,
        });
    }
});

/**
 * 创建对比任务（本地路径模式，同机调用免上传）
 * POST /api/compare/paths
 * application/json:
 *   {
 *     "bidFiles": ["D:/docs/a.pdf", "D:/docs/b.pdf"],
 *     "biddingFile": "D:/docs/exclude.pdf",     // 可选
 *     "settings": { "text": {...}, "image": {...} }  // 可选
 *   }
 */
fastify.post('/api/compare/paths', async (request, reply) => {
    const body = request.body || {};

    if (!Array.isArray(body.bidFiles) || body.bidFiles.length < 2) {
        return reply.code(400).send({
            success: false,
            error: 'bidFiles 必须是包含至少 2 个文件路径的数组',
        });
    }

    if (body.bidFiles.length > CONFIG.maxFiles) {
        return reply.code(400).send({
            success: false,
            error: `投标文件数量超过上限 ${CONFIG.maxFiles}`,
        });
    }

    if (body.bidFiles.some((file) => typeof file !== 'string')) {
        return reply.code(400).send({
            success: false,
            error: 'bidFiles 中的每一项都必须是字符串路径',
        });
    }

    // 校验文件存在，一次性给出完整清单
    const missing = [...body.bidFiles, body.biddingFile].filter(
        (file) => typeof file === 'string' && !fs.existsSync(file),
    );

    if (missing.length) {
        return reply.code(400).send({
            success: false,
            error: `以下文件在服务器上不存在: ${missing.join(', ')}`,
        });
    }

    const task = manager.submit(
        {
            bidFiles: body.bidFiles,
            biddingFile: body.biddingFile || null,
            settings: body.settings || null,
            fileNames: body.bidFiles.map((file) => path.basename(file)),
            biddingFileName: body.biddingFile ? path.basename(body.biddingFile) : null,
        },
        _runTaskAndCleanup,
    );

    return reply.code(202).send({
        success: true,
        jobId: task.id,
        status: task.status,
        message: '对比任务已创建',
    });
});

/**
 * 查询任务状态
 * GET /api/jobs/:jobId/status
 */
fastify.get('/api/jobs/:jobId/status', async (request, reply) => {
    const task = manager.get(request.params.jobId);

    if (!task) {
        return reply.code(404).send({ success: false, error: '任务不存在' });
    }

    return reply.send({ success: true, ...taskView(task) });
});

/**
 * 任务进度事件流（SSE）
 * GET /api/jobs/:jobId/events
 * 每条消息 data 为 JSON：{ jobId, status, progress, result, error }
 * 任务进入终态后推送最后一条并关闭连接
 */
fastify.get('/api/jobs/:jobId/events', (request, reply) => {
    const task = manager.get(request.params.jobId);

    if (!task) {
        return reply.code(404).send({ success: false, error: '任务不存在' });
    }

    // 接管原生响应，绕开 fastify 的序列化
    reply.hijack();

    const raw = reply.raw;

    raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // SSE 不经过 fastify 的 CORS 插件，需手动声明
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
    });

    raw.write(`retry: 3000\n\n`);

    let closed = false;

    const writeEvent = (currentTask) => {
        if (closed) {
            return;
        }

        const payload = JSON.stringify({
            jobId: currentTask.id,
            status: currentTask.status,
            progress: currentTask.progress,
            result: currentTask.result,
            error: currentTask.error,
        });

        raw.write(`data: ${payload}\n\n`);

        if (FINISHED_STATUSES.includes(currentTask.status)) {
            cleanup();
            raw.end();
        }
    };

    const heartbeat = setInterval(() => {
        if (!closed) {
            raw.write(': hb\n\n');
        }
    }, 15000);

    heartbeat.unref();

    const listener = (updatedTask) => writeEvent(updatedTask);

    function cleanup() {
        if (closed) {
            return;
        }

        closed = true;

        clearInterval(heartbeat);
        manager.off(`update:${task.id}`, listener);
    }

    manager.on(`update:${task.id}`, listener);

    request.raw.on('close', cleanup);

    // 先推当前快照
    writeEvent(task);
});

/**
 * 获取任务结果
 * GET /api/jobs/:jobId/result
 * 结果中的缓存文件路径已映射为 /files/ 下载 URL
 */
fastify.get('/api/jobs/:jobId/result', async (request, reply) => {
    const task = manager.get(request.params.jobId);

    if (!task) {
        return reply.code(404).send({ success: false, error: '任务不存在' });
    }

    if (task.status !== STATUS.COMPLETED) {
        return reply.code(409).send({
            success: false,
            jobId: task.id,
            status: task.status,
            error: task.error,
            message: task.status === STATUS.FAILED ? '任务已失败' : '任务尚未完成',
        });
    }

    const groupId = task.result && task.result.groupId;
    const results = await BidComparator.history(groupId);

    mapCachePathsToUrls(results, requestBaseUrl(request));

    return reply.send({
        success: true,
        jobId: task.id,
        groupId,
        count: Array.isArray(results) ? results.length : 1,
        results,
    });
});

/**
 * 按 groupId 直接查询历史结果（不依赖任务记录，服务重启后仍可用）
 * GET /api/results/:groupId
 */
fastify.get('/api/results/:groupId', async (request, reply) => {
    const results = await BidComparator.history(request.params.groupId);

    if (!results || (Array.isArray(results) && results.length === 0)) {
        return reply.code(404).send({ success: false, error: '未找到该组结果' });
    }

    mapCachePathsToUrls(results, requestBaseUrl(request));

    return reply.send({
        success: true,
        groupId: request.params.groupId,
        count: Array.isArray(results) ? results.length : 1,
        results,
    });
});

/**
 * 取消任务（仅 waiting 状态可取消）
 * DELETE /api/jobs/:jobId
 */
fastify.delete('/api/jobs/:jobId', async (request, reply) => {
    const { ok, reason } = manager.cancel(request.params.jobId);

    if (reason === 'not_found') {
        return reply.code(404).send({ success: false, error: '任务不存在' });
    }

    if (ok) {
        // 取消的等待任务可能已写入上传临时目录，清理之
        const task = manager.get(request.params.jobId);

        if (task && task.meta.tempDir) {
            fs.promises.rm(task.meta.tempDir, { recursive: true, force: true }).catch(() => {});
        }

        return reply.send({ success: true, jobId: task.id, message: '任务已取消' });
    }

    const message = reason === 'running' ? '任务正在运行，暂不支持取消' : '任务已结束，无法取消';

    return reply.code(409).send({ success: false, jobId: request.params.jobId, message });
});

/**
 * 任务列表
 * GET /api/jobs?status=all|waiting|running|completed|failed|canceled&limit=50
 */
fastify.get('/api/jobs', async (request) => {
    const { status = 'all', limit = 50 } = request.query;

    let tasks = manager.list();

    if (status !== 'all') {
        tasks = tasks.filter((task) => task.status === status);
    }

    return {
        success: true,
        jobs: tasks.slice(0, Math.max(1, parseInt(limit, 10) || 50)).map(taskView),
    };
});

/**
 * 服务统计
 * GET /api/stats
 */
fastify.get('/api/stats', async () => {
    const memory = process.memoryUsage();

    return {
        success: true,
        stats: {
            ...manager.stats(),
            concurrency: CONFIG.concurrency,
            uptimeSeconds: Math.floor(process.uptime()),
            memory: {
                rssMb: Math.round(memory.rss / 1048576),
                heapUsedMb: Math.round(memory.heapUsed / 1048576),
            },
        },
    };
});

// 健康检查
fastify.get('/health', async () => ({
    status: 'ok',
    version: require('./package.json').version,
    timestamp: new Date().toISOString(),
}));

// ============ 优雅关闭 ============

let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    log(`收到 ${signal}，开始优雅关闭…`);

    manager.close();
    manager.cancelAllWaiting();

    const idle = await manager.waitForIdle(10 * 60 * 1000);

    if (!idle) {
        log('等待运行中任务超时（10 分钟），强制退出');
    }

    try {
        await fastify.close();
    } catch (e) {
        // 忽略关闭阶段的连接错误
    }

    // 回收全部 worker 线程
    BidComparator.dispose();

    log('服务已关闭');

    process.exit(idle ? 0 : 1);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ============ 启动 ============

async function start() {
    // 清理超过 24 小时的历史临时目录（异常退出遗留的上传文件）
    try {
        const entries = await fs.promises.readdir(CONFIG.tmpRoot);

        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

        for (const entry of entries) {
            if (!entry.startsWith('bid-comparator-')) {
                continue;
            }

            const entryPath = path.join(CONFIG.tmpRoot, entry);

            try {
                const stat = await fs.promises.stat(entryPath);

                if (stat.mtimeMs < dayAgo) {
                    await fs.promises.rm(entryPath, { recursive: true, force: true });
                }
            } catch (e) {
                // 单个目录清理失败不影响启动
            }
        }
    } catch (e) {
        // 临时目录不可读不影响启动
    }

    await fastify.listen({ port: CONFIG.port, host: CONFIG.host });

    log(`BidComparator 服务已启动: http://localhost:${CONFIG.port}`);
    log(`  并发任务数: ${CONFIG.concurrency}, 上传上限: ${CONFIG.maxFileMb}MB/文件, 最多 ${CONFIG.maxFiles} 个文件`);
    log(`  缓存目录: ${CONFIG.cachePath}`);
    log('  API: POST /api/compare | POST /api/compare/paths | GET /api/jobs/:id/status|events|result');
    log('       DELETE /api/jobs/:id | GET /api/jobs | GET /api/results/:groupId | GET /api/stats | GET /health');
}

start().catch((error) => {
    console.error('服务启动失败:', error);

    process.exit(1);
});
