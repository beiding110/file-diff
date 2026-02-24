/**
 * BidComparator API Server
 *
 * 支持长时间运行的对比任务（可能超过1小时）
 *
 * 功能特性：
 * - 异步任务处理
 * - 实时进度报告
 * - 任务状态查询
 * - WebSocket 实时推送（可选）
 * - 任务取消和重试
 *
 * @version 2024-02-11-fixed (Bull 4.x compatible)
 */

const SERVER_VERSION = '2024-02-11-bull4x-fixed';
console.log(`\n🚀 BidComparator API Server v${SERVER_VERSION}\n`);

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const fastifyStatic = require('@fastify/static');
const Bull = require('bull');
const Redis = require('ioredis');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const open = require('open');
const { WebSocketServer } = require('ws');

// 导入 BidComparator
const BidComparator = require('../index.js');

// ============ 配置 ============
const CONFIG = {
    port: process.env.PORT || 3000,
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: process.env.REDIS_DB || 0,
    },
    concurrency: process.env.CONCURRENCY || 2, // 同时运行的最大任务数
    defaultSettings: {
        text: { threshold: 0.8, minLength: 15 },
        image: { similarity: 0.9, minSize: 300 },
    },
};

// ============ 初始化 Redis ============
const redis = new Redis(CONFIG.redis);
const redisSubscriber = new Redis(CONFIG.redis);

// ============ 初始化 Bull Queue ============
const compareQueue = new Bull('compare-queue', {
    redis: CONFIG.redis,
    defaultJobOptions: {
        removeOnComplete: false, // 保留完成的任务
        removeOnFail: false, // 保留失败的任务
        attempts: 1, // 失败重试次数
        timeout: 0, // 无超时限制（支持长时间任务）
    },
    settings: {
        stalledInterval: 30 * 1000, // 30秒检查一次停滞任务（默认30秒）
        maxStalledCount: 1, // 最大允许停滞次数
    },
});

// ============ 初始化 Fastify Server ============
const fastify = Fastify({
    logger: true,
});

// 注册 CORS
fastify.register(cors, {
    origin: true,
    credentials: true,
});

// 注册文件上传支持
fastify.register(require('@fastify/multipart'), {
    limits: {
        fileSize: 100 * 1024 * 1024, // 100 MB
        files: 20, // 最多20个文件
    },
});

// 不再使用 @fastify/websocket，改用原始的 ws 库
// fastify.register(websocket);

// ============ WebSocket 客户端管理 ============
// 手动维护 WebSocket 客户端集合，用于广播消息
const wsClients = new Set();

// 文件系统工具
const fs = require('fs');
const os = require('os');
const { promisify } = require('util');

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

// 注册静态文件服务
fastify.register(fastifyStatic, {
    root: path.join(__dirname, 'examples'),
    prefix: '/demo/', // 访问路径前缀
});

// 添加 /demo 路由，重定向到测试页面
fastify.get('/demo', async (request, reply) => {
    return reply.redirect('/demo/browser-client.html');
});

// ============ 任务处理器 ============
compareQueue.process(CONFIG.concurrency, async (job) => {
    // Bull 4.x: job.id 是任务 ID，job.data 是任务数据
    const jobId = job.id;
    const data = job.data;

    console.log(`🚀 任务处理器开始执行任务: ${jobId}`);

    await job.log(`任务开始: ${jobId}`);

    try {
        // 更新任务状态为处理中
        job.progress(0); // Bull 4.x: 只接受数字（0-100）
        console.log(`📊 任务 ${jobId}: 进度 0%`);

        // 创建 BidComparator 实例
        const comparator = new BidComparator();

        // 设置进度回调
        comparator.textCompareProgressHandlerFactory = function (id) {
            return function (num, str) {
                // 注意：不在进度回调中使用 await job.log()，避免阻塞导致 stalled
                // Bull 4.x: 只接受数字（0-100）
                job.progress(num * 100);
                console.log(`📊 任务 ${jobId}: 文字进度 ${(num * 100).toFixed(2)}%`);
            };
        };

        comparator.imageCompareProgressHandlerFactory = function (id) {
            return function (num, str) {
                // 注意：不在进度回调中使用 await job.log()，避免阻塞导致 stalled
                // Bull 4.x: 只接受数字（0-100）
                job.progress(num * 100);
                console.log(`📊 任务 ${jobId}: 图片进度 ${(num * 100).toFixed(2)}%`);
            };
        };

        // 更新配置
        if (data.settings) {
            BidComparator.updateSettings(data.settings);
        }

        // 设置缓存路径
        if (data.cachePath) {
            BidComparator.setCachePath(data.cachePath);
        }

        job.progress(10); // Bull 4.x: 开始对比
        await job.log(`开始执行文件对比...`);
        console.log(`📊 任务 ${jobId}: 进度 10% - 开始对比`);

        // 执行对比 - 添加详细错误捕获
        let groupId;
        try {
            console.log(`🔄 正在调用 comparator.processFiles...`);
            groupId = await comparator.processFiles(data.bidFiles, data.biddingFile);
            console.log(`✅ comparator.processFiles 成功返回, GroupID: ${groupId}`);
        } catch (error) {
            console.error(`❌ comparator.processFiles 抛出异常:`, error);
            console.error(`  - 错误类型: ${error.name}`);
            console.error(`  - 错误消息: ${error.message}`);
            console.error(`  - 错误堆栈:`, error.stack);
            throw error; // 重新抛出，让 Bull 的 failed 事件处理
        }

        await job.log(`文件对比完成，GroupID: ${groupId}`);
        job.progress(100); // Bull 4.x: 完成
        console.log(`📊 任务 ${jobId}: 进度 100% - 完成`);
        console.log(`✅ 任务 ${jobId} 成功完成, GroupID: ${groupId}`);

        await job.log(`任务完成: ${jobId}, GroupID: ${groupId}`);

        // 清理临时文件
        if (data.tempDir) {
            try {
                console.log(`🧹 清理临时目录: ${data.tempDir}`);
                fs.rmSync(data.tempDir, { recursive: true, force: true });
                console.log(`✅ 临时目录已清理`);
            } catch (err) {
                console.error(`⚠️ 清理临时目录失败:`, err);
            }
        }

        return {
            success: true,
            groupId,
            message: '对比完成',
        };
    } catch (error) {
        console.error(`❌ 任务 ${jobId} 执行失败:`, error);
        console.error(`  - 错误名称:`, error.name);
        console.error(`  - 错误消息:`, error.message);
        console.error(`  - 错误堆栈:`, error.stack);
        await job.log(`任务失败: ${error.message}`);

        // 即使失败也清理临时文件
        if (data.tempDir) {
            try {
                console.log(`🧹 清理临时目录: ${data.tempDir}`);
                fs.rmSync(data.tempDir, { recursive: true, force: true });
                console.log(`✅ 临时目录已清理`);
            } catch (err) {
                console.error(`⚠️ 清理临时目录失败:`, err);
            }
        }

        throw error; // 确保抛出异常，触发 Bull 的 failed 事件
    }
});

// ============ 全局事件监听 ============
console.log('🎯 正在注册 Bull 事件监听器...');

compareQueue.on('completed', (job) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 [COMPLETED 事件触发] 任务完成: ' + job.id);
    console.log('  - Job ID:', job.id);
    console.log('  - Job Data:', JSON.stringify(job.data));
    console.log('  - Return Value:', job.returnvalue);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 广播完成消息到 WebSocket
    console.log(`🔔 准备广播完成消息到 ${wsClients.size} 个客户端`);

    wsClients.forEach((client, index) => {
        console.log(`  - 客户端 ${index}: readyState=${client.readyState}, OPEN=${client.readyState === 1}`);

        if (client.readyState === 1) {
            // OPEN
            const message = JSON.stringify({
                type: 'jobCompleted',
                jobId: job.id,
            });

            try {
                client.send(message);
                console.log(`  ✅ 已发送完成消息到客户端 ${index}, jobId: ${job.id}`);
            } catch (error) {
                console.error(`  ❌ 发送到客户端 ${index} 失败:`, error);
            }
        } else {
            console.log(`  ⚠️ 客户端 ${index} 未就绪，跳过发送`);
        }
    });
});

console.log('✅ COMPLETED 事件监听器已注册');

compareQueue.on('failed', (job, err) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💀 [FAILED 事件触发] 任务失败: ' + job.id);
    console.log('  - Job ID:', job.id);
    console.log('  - 错误信息:', err.message);
    console.log('  - 错误堆栈:', err.stack);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    console.error(`❌ 任务失败: ${job.id}`, err.message);
    console.error('  - 错误堆栈:', err.stack);
    // 广播失败消息到 WebSocket
    console.log(`🔔 准备广播失败消息到 ${wsClients.size} 个客户端`);

    wsClients.forEach((client, index) => {
        console.log(`  - 客户端 ${index}: readyState=${client.readyState}, OPEN=${client.readyState === 1}`);

        if (client.readyState === 1) {
            // OPEN
            const message = JSON.stringify({
                type: 'jobFailed',
                jobId: job.id,
                error: err.message,
            });

            try {
                client.send(message);
                console.log(`  ✅ 已发送失败消息到客户端 ${index}, jobId: ${job.id}`);
            } catch (error) {
                console.error(`  ❌ 发送到客户端 ${index} 失败:`, error);
            }
        } else {
            console.log(`  ⚠️ 客户端 ${index} 未就绪，跳过发送`);
        }
    });
});

console.log('✅ FAILED 事件监听器已注册');

compareQueue.on('progress', (job, progress) => {
    console.log(`📊 [PROGRESS 事件触发] 任务进度: ${job.id}`, progress);
    // 广播进度到 WebSocket
    console.log(`🔔 准备广播进度消息到 ${wsClients.size} 个客户端`);

    wsClients.forEach((client, index) => {
        console.log(`  - 客户端 ${index}: readyState=${client.readyState}, OPEN=${client.readyState === 1}`);

        if (client.readyState === 1) {
            // OPEN
            const message = JSON.stringify({
                type: 'jobProgress',
                jobId: job.id,
                progress,
            });

            try {
                client.send(message);
                console.log(`  ✅ 已发送到客户端 ${index}`);
            } catch (error) {
                console.error(`  ❌ 发送到客户端 ${index} 失败:`, error);
            }
        } else {
            console.log(`  ⚠️ 客户端 ${index} 未就绪，跳过发送`);
        }
    });
});

console.log('✅ PROGRESS 事件监听器已注册');

// ============ API 路由 ============

/**
 * 创建对比任务
 * POST /api/compare
 * 支持文件上传（multipart/form-data）
 */
fastify.post('/api/compare', async (request, reply) => {
    try {
        console.log('📝 收到文件上传请求');

        // 创建临时目录保存上传的文件
        const tempDir = path.join(os.tmpdir(), `bid-comparator-${Date.now()}`);
        await mkdir(tempDir, { recursive: true });
        console.log('📁 创建临时目录:', tempDir);

        const bidFiles = [];
        let biddingFile = null;
        const settings = {};

        // 解析 multipart form data
        const parts = request.parts();
        for await (const part of parts) {
            console.log('📦 处理表单项:', part.fieldname);

            if (part.file) {
                // 这是一个文件
                const filename = part.filename;
                const filepath = path.join(tempDir, filename);

                console.log('  - 保存文件:', filename, '->', filepath);

                // 保存文件到临时目录
                const buffer = await part.toBuffer();
                await writeFile(filepath, buffer);

                if (part.fieldname === 'bidFiles') {
                    bidFiles.push(filepath);
                } else if (part.fieldname === 'biddingFile') {
                    biddingFile = filepath;
                }
            } else {
                // 这是一个普通表单字段
                const value = part.value;
                console.log('  - 字段值:', part.fieldname, '=', value);

                if (part.fieldname === 'threshold') {
                    settings.text = settings.text || {};
                    settings.text.threshold = parseFloat(value);
                } else if (part.fieldname === 'minLength') {
                    settings.text = settings.text || {};
                    settings.text.minLength = parseInt(value);
                }
            }
        }

        console.log('✅ 文件上传完成:', {
            bidFiles: bidFiles.length,
            biddingFile: biddingFile ? 'yes' : 'no',
            settings,
        });

        // 验证必需参数
        if (!bidFiles || bidFiles.length < 2) {
            // 清理临时文件
            try {
                const fsExtra = require('fs');
                fsExtra.rmSync(tempDir, { recursive: true, force: true });
            } catch (err) {
                console.error('清理临时文件失败:', err);
            }

            return reply.code(400).send({
                success: false,
                error: '至少需要2个投标文件',
            });
        }

        // 创建任务
        const customJobId = uuidv4();
        console.log('✅ 生成任务 ID:', customJobId);

        const job = await compareQueue.add(
            {
                bidFiles,
                biddingFile,
                settings: Object.keys(settings).length > 0 ? settings : CONFIG.defaultSettings,
                tempDir, // 保存临时目录路径，用于清理
            },
            {
                jobId: customJobId,
            },
        );

        console.log('✅ 任务已添加到队列, job.id:', job.id, 'customJobId:', customJobId);

        reply.send({
            success: true,
            jobId: job.id,
            message: '对比任务已创建',
        });
    } catch (error) {
        console.error('❌ 创建任务失败:', error);
        reply.code(500).send({
            success: false,
            error: error.message,
        });
    }
});

/**
 * 查询任务状态
 * GET /api/jobs/:jobId/status
 */
fastify.get('/api/jobs/:jobId/status', async (request, reply) => {
    try {
        const { jobId } = request.params;
        const job = await compareQueue.getJob(jobId);

        if (!job) {
            return reply.code(404).send({
                success: false,
                error: '任务不存在',
            });
        }

        const state = await job.getState();
        const progress = job.progress();

        reply.send({
            success: true,
            jobId,
            status: state,
            progress,
            created: job.timestamp,
            processed: job.processedOn,
            finished: job.finishedOn,
        });
    } catch (error) {
        reply.code(500).send({
            success: false,
            error: error.message,
        });
    }
});

/**
 * 获取任务结果
 * GET /api/jobs/:jobId/result
 */
fastify.get('/api/jobs/:jobId/result', async (request, reply) => {
    try {
        const { jobId } = request.params;
        const job = await compareQueue.getJob(jobId);

        if (!job) {
            return reply.code(404).send({
                success: false,
                error: '任务不存在',
            });
        }

        const state = await job.getState();

        if (state === 'completed') {
            const result = job.returnvalue;
            reply.send({
                success: true,
                jobId,
                status: state,
                result,
            });
        } else if (state === 'failed') {
            reply.send({
                success: false,
                jobId,
                status: state,
                error: job.failedReason,
            });
        } else {
            reply.send({
                success: false,
                jobId,
                status: state,
                message: '任务尚未完成',
            });
        }
    } catch (error) {
        reply.code(500).send({
            success: false,
            error: error.message,
        });
    }
});

/**
 * 取消任务
 * DELETE /api/jobs/:jobId
 */
fastify.delete('/api/jobs/:jobId', async (request, reply) => {
    try {
        const { jobId } = request.params;
        const job = await compareQueue.getJob(jobId);

        if (!job) {
            return reply.code(404).send({
                success: false,
                error: '任务不存在',
            });
        }

        const state = await job.getState();

        if (state === 'completed' || state === 'failed') {
            return reply.send({
                success: false,
                message: '任务已结束，无法取消',
            });
        }

        await job.remove();
        reply.send({
            success: true,
            message: '任务已取消',
        });
    } catch (error) {
        reply.code(500).send({
            success: false,
            error: error.message,
        });
    }
});

/**
 * 获取所有任务列表
 * GET /api/jobs
 */
fastify.get('/api/jobs', async (request, reply) => {
    try {
        const { state = 'all', limit = 50 } = request.query;

        const jobs = await compareQueue.getJobs(
            state === 'all' ? ['waiting', 'active', 'completed', 'failed'] : [state],
            0,
            parseInt(limit),
        );

        // 使用 Promise.all 处理异步操作
        const jobList = await Promise.all(
            jobs.map(async (job) => ({
                id: job.id,
                status: await job.getState(),
                progress: job.progress(),
                created: job.timestamp,
                processed: job.processedOn,
                finished: job.finishedOn,
            })),
        );

        reply.send({
            success: true,
            jobs: jobList,
        });
    } catch (error) {
        reply.code(500).send({
            success: false,
            error: error.message,
        });
    }
});

/**
 * 获取队列统计信息
 * GET /api/stats
 */
fastify.get('/api/stats', async (request, reply) => {
    try {
        const counts = await compareQueue.getJobCounts();

        reply.send({
            success: true,
            stats: {
                waiting: counts.waiting || 0,
                active: counts.active || 0,
                completed: counts.completed || 0,
                failed: counts.failed || 0,
                delayed: counts.delayed || 0,
                paused: counts.delayed || 0,
            },
        });
    } catch (error) {
        reply.code(500).send({
            success: false,
            error: error.message,
        });
    }
});

/**
 * WebSocket 连接（实时进度推送）
 * 注意：不再使用 @fastify/websocket 的路由，而是在服务器启动后手动附加 WebSocket 服务器
 */

// ============ 健康检查 ============
fastify.get('/health', async (request, reply) => {
    reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
    });
});

// ============ 启动服务器 ============
const start = async () => {
    try {
        await fastify.listen({ port: CONFIG.port, host: '0.0.0.0' });

        // ============ 手动附加 WebSocket 服务器 ============
        const server = fastify.server;
        const wss = new WebSocketServer({ server, path: '/ws' });

        wss.on('connection', (socket, req) => {
            console.log('✅ WebSocket 客户端已连接');
            console.log('  - 客户端信息:', {
                url: req.url,
                ip: req.socket.remoteAddress,
            });

            try {
                // 将客户端添加到集合中
                wsClients.add(socket);
                console.log(`📊 当前 WebSocket 客户端数量: ${wsClients.size}`);

                // 发送连接确认消息
                socket.send(
                    JSON.stringify({
                        type: 'connected',
                        message: 'WebSocket 连接已建立',
                        timestamp: new Date().toISOString(),
                    }),
                );
                console.log('📤 已发送连接确认消息');
            } catch (error) {
                console.error('❌ 发送连接确认消息失败:', error);
            }

            socket.on('message', async (message) => {
                console.log('📥 收到 WebSocket 消息:', message.toString());
                try {
                    const data = JSON.parse(message);

                    if (data.type === 'subscribe') {
                        // 客户端订阅特定任务的更新
                        socket.send(
                            JSON.stringify({
                                type: 'subscribed',
                                jobId: data.jobId,
                            }),
                        );
                        console.log(`✅ 客户端已订阅任务: ${data.jobId}`);
                    }
                } catch (error) {
                    console.error('❌ 处理消息失败:', error);
                    socket.send(
                        JSON.stringify({
                            type: 'error',
                            message: error.message,
                        }),
                    );
                }
            });

            socket.on('close', (code, reason) => {
                console.log('🔌 WebSocket 客户端已断开');
                console.log('  - 关闭代码:', code);
                console.log('  - 关闭原因:', reason ? reason.toString() : '无');
                // 从集合中移除客户端
                wsClients.delete(socket);
                console.log(`📊 当前 WebSocket 客户端数量: ${wsClients.size}`);
            });

            socket.on('error', (error) => {
                console.error('❌ WebSocket 错误:', error);
                console.error('  - 错误详情:', error.message);
                // 从集合中移除客户端
                wsClients.delete(socket);
            });
        });

        console.log('✅ WebSocket 服务器已启动在路径: /ws');

        const demoUrl = `http://localhost:${CONFIG.port}/demo`;

        console.log(`
╔═══════════════════════════════════════════════════════╗
║   BidComparator API Server                            ║
╠═══════════════════════════════════════════════════════╣
║   🚀 Server running on port ${CONFIG.port}                     ║
║   📊 Concurrent jobs: ${CONFIG.concurrency}                               ║
║   🔗 Redis: ${CONFIG.redis.host}:${CONFIG.redis.port}                          ║
╠═══════════════════════════════════════════════════════╣
║   API Endpoints:                                      ║
║   POST   /api/compare           创建对比任务          ║
║   GET    /api/jobs/:jobId/status 查询任务状态          ║
║   GET    /api/jobs/:jobId/result 获取任务结果          ║
║   DELETE /api/jobs/:jobId        取消任务              ║
║   GET    /api/jobs               获取任务列表          ║
║   GET    /api/stats              获取统计信息          ║
║   WS     /ws                     WebSocket 实时推送    ║
╠═══════════════════════════════════════════════════════╣
║   🌐 Web Demo:                                         ║
║   ${demoUrl}                              ║
╚═══════════════════════════════════════════════════════╝
        `);

        // 自动打开浏览器（除非设置了环境变量 NO_BROWSER）
        if (process.env.NO_BROWSER !== 'true') {
            console.log('🌐 正在打开浏览器...');
            setTimeout(async () => {
                try {
                    await open(demoUrl);
                    console.log('✅ 浏览器已打开');
                } catch (err) {
                    console.log('⚠️  无法自动打开浏览器，请手动访问:', demoUrl);
                }
            }, 1000);
        } else {
            console.log('💡 跳过自动打开浏览器（NO_BROWSER=true）');
            console.log(`💡 请在浏览器中访问: ${demoUrl}`);
        }
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();

// ============ 优雅关闭 ============
const gracefulShutdown = async () => {
    console.log('\n正在关闭服务器...');

    await fastify.close();
    await compareQueue.close();
    await redis.quit();
    await redisSubscriber.quit();

    console.log('服务器已关闭');
    process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
