module.exports = function (thisFileName) {
    const { Worker, MessageChannel, isMainThread } = require('worker_threads');

    if (isMainThread) {
        const { log } = require('../utils/log.js');

        // 用独立 MessageChannel 通信：Worker 自带的内部端口无法单独 unref，
        // 空闲线程会一直阻止进程退出；自有 port 可以在空闲时 unref，
        // 任务在途时再 ref，实现“忙时保活、闲时放行”
        const { port1, port2 } = new MessageChannel();

        const worker = new Worker(thisFileName, {
            workerData: { port: port2 },
            transferList: [port2],
        });

        worker.unref();

        // 微批合并：同一事件循环内提交的任务打包成一条消息，
        // 摊薄每对文本一次 postMessage 的序列化与调度开销
        const MAX_BATCH = 64;

        let pending = []; // 等待发送的请求
        let batchItems = null; // 当前在途批次
        let flushScheduled = false;
        let dead = false;
        let deadCallback = null;

        const rejectAll = (error) => {
            const items = pending.splice(0);

            if (batchItems) {
                batchItems.forEach((x) => x.reject(error));
                batchItems = null;
            }

            items.forEach((x) => x.reject(error));
        };

        const die = (error) => {
            dead = true;

            rejectAll(error);

            port1.unref();
        };

        worker.on('error', (error) => {
            log('diff.worker error:', error && (error.stack || error.message));

            die(error instanceof Error ? error : new Error(String(error)));

            if (typeof deadCallback === 'function') {
                deadCallback();
            }
        });

        worker.on('exit', (code) => {
            die(new Error(`diff.worker 意外退出，exit code: ${code}`));

            if (typeof deadCallback === 'function') {
                deadCallback();
            }
        });

        port1.on('message', (results) => {
            // 批处理模式下同一时刻只有一条批次在途，响应对应当前批次
            const items = batchItems;
            batchItems = null;

            if (!items) {
                return;
            }

            items.forEach((x, i) => {
                const result = Array.isArray(results) ? results[i] : undefined;

                if (result && result.__error) {
                    x.reject(new Error(result.message));
                    return;
                }

                x.resolve(result);
            });

            if (!pending.length) {
                port1.unref();
            } else {
                pump();
            }
        });

        function pump() {
            if (batchItems || dead || !pending.length) {
                return;
            }

            batchItems = pending.splice(0, MAX_BATCH);

            port1.ref();

            port1.postMessage({
                batch: batchItems.map((x) => x.json),
            });
        }

        // 注意：on('message') 注册监听会使 port 重新 ref，
        // 空闲 unref 必须放在监听注册之后才生效
        port1.unref();

        return {
            diffWords(json) {
                return new Promise((resolve, reject) => {
                    if (dead) {
                        reject(new Error('diff.worker 已退出'));
                        return;
                    }

                    pending.push({ json, resolve, reject });

                    if (!flushScheduled) {
                        flushScheduled = true;

                        // setImmediate 让同一同步块内提交的任务（如 processDoubleLoop 的整块循环）一起打包
                        setImmediate(() => {
                            flushScheduled = false;
                            pump();
                        });
                    }
                });
            },
            // 终止 worker 线程
            terminate() {
                die(new Error('diff.worker 已被终止'));

                try {
                    port1.close();
                } catch (e) {
                    // 端口可能已随线程关闭
                }

                return worker.terminate();
            },
            // 线程退出（含主动 terminate）后的回调，供线程池移除引用
            onDead(cb) {
                deadCallback = cb;
            },
        };
    } else {
        const { workerData } = require('worker_threads');
        const Diff = require('diff');
        const vectorComparator = require('../utils/vectorComparator.js');

        // 主线程通过 MessageChannel 移交的端口通信
        const port = workerData.port;

        // 只统计相同部分长度（不需要高亮串时的轻量路径）
        function calcSameLength(diff) {
            let sameCount = 0;

            for (const part of diff) {
                if (!part.added && !part.removed) {
                    sameCount += part.value.length;
                }
            }

            return sameCount;
        }

        // 构造带 <b> 标记的两侧文本（仅在相似度达标、需要展示时才调用）
        function buildMarkup(diff) {
            let strA = '';
            let strB = '';

            for (const part of diff) {
                if (part.removed) {
                    // 被移除的，属于左边
                    strA += part.value;
                } else if (part.added) {
                    // 新增的，属于右边
                    strB += part.value;
                } else {
                    // 两边相同的部分
                    strA += `<b>${part.value}</b>`;
                    strB += `<b>${part.value}</b>`;
                }
            }

            return [strA.replaceAll('</b><b>', ''), strB.replaceAll('</b><b>', '')];
        }

        // 向量缓存：同一段文字会与多段文字比较，避免重复计算字符频率
        const vectorCache = new Map();
        const VECTOR_CACHE_MAX = 20000;

        function getVectorCached(str) {
            if (vectorCache.has(str)) {
                return vectorCache.get(str);
            }

            const vector = vectorComparator.getVector(str);

            if (vectorCache.size >= VECTOR_CACHE_MAX) {
                vectorCache.clear();
            }

            vectorCache.set(str, vector);

            return vector;
        }

        // 处理一批对比任务，按提交顺序返回结果，保证调用方按索引对齐
        function compareBatch(batch) {
            return batch.map(({ a, b, threshold }) => {
                try {
                    const vectorA = getVectorCached(a);
                    const vectorB = getVectorCached(b);
                    const vsimilarity = vectorComparator.calculateCosineSimilarity(vectorA, vectorB);

                    if (vsimilarity < threshold) {
                        return { similarity: vsimilarity };
                    }

                    const diff = Diff.diffWords(a, b);
                    const similarity = calcSameLength(diff) / Math.max(a.length, b.length);

                    // 未达标的对比不需要高亮串，跳过字符串构造与传输
                    if (similarity < threshold) {
                        return { similarity };
                    }

                    const [markupA, markupB] = buildMarkup(diff);

                    return { a: markupA, b: markupB, similarity };
                } catch (error) {
                    return {
                        __error: true,
                        message: error && (error.stack || error.message),
                    };
                }
            });
        }

        port.on('message', (msg) => {
            try {
                port.postMessage(compareBatch(msg.batch || []));
            } catch (error) {
                // 整批失败时按等长返回错误项，维持索引对齐
                const filler = {
                    __error: true,
                    message: error && (error.stack || error.message),
                };

                port.postMessage((msg.batch || []).map(() => filler));
            }
        });

        return null;
    }
};
