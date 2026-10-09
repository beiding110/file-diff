# BidComparator 服务

将 PDF 投标文件对比类库封装为 HTTP 服务，供其他应用（Web / Electron 客户端、后端服务等）调用。

相对 `server-服务化` 分支的旧方案（Bull + Redis + WebSocket），本版本：

- **零外部依赖**：内存任务队列代替 Bull/Redis，无需部署 Redis，也规避了 stalled 机制对 CPU 密集型长任务的误杀
- **SSE 代替 WebSocket**：进度推送走 HTTP 原生协议，浏览器 `EventSource`、任意 HTTP 客户端均可订阅
- **新增本地路径模式**：与服务器同机的调用方直接传文件路径，免上传
- 基于最新代码（微批合并、按 CPU 核数调度线程、内存受控、进程可自动退出）

## 启动

```bash
cd server
npm install
npm start
```

配置通过环境变量（见 [.env.example](./.env.example)）：`PORT`、`CONCURRENCY`、`WORKERS`、`CACHE_PATH`、`MAX_UPLOAD_MB`、`MAX_FILES` 等。

```bash
# Windows (cmd)
set PORT=3000 && set CONCURRENCY=1 && npm start

# 指定 dist 产物作为库入口
set LIB_ENTRY=E:\Git\file-diff\dist\BidComparator.js && npm start
```

- **CONCURRENCY 默认 1（推荐）**：对比是 CPU 密集型任务，单任务已能吃满 CPU，多任务排队执行。
  并发 >1 时注意：对比设置（`updateSettings`）是全局静态的，并发任务的自定义设置会互相覆盖。
- **任务可靠性**：结果持久化在 `CACHE_PATH/result/<groupId>/` 下，服务重启后已完成任务仍可通过 `GET /api/results/:groupId` 查询；仅重启时正在排队（waiting）的任务会丢失，需要调用方重新提交。
- 上传的文件保存在系统临时目录，任务结束后自动清理；PDF 与图片副本已由库缓存到 `CACHE_PATH/files/`，删除临时文件不丢数据。

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/compare` | 创建任务（multipart 文件上传） |
| POST | `/api/compare/paths` | 创建任务（服务器本地路径，同机调用免上传） |
| GET | `/api/jobs/:jobId/status` | 查询任务状态与进度 |
| GET | `/api/jobs/:jobId/events` | SSE 进度事件流 |
| GET | `/api/jobs/:jobId/result` | 获取任务结果 |
| DELETE | `/api/jobs/:jobId` | 取消任务（仅 waiting 状态） |
| GET | `/api/jobs` | 任务列表（`?status=&limit=`） |
| GET | `/api/results/:groupId` | 按组 ID 查询历史结果（服务重启后仍可用） |
| GET | `/api/stats` | 队列与内存统计 |
| GET | `/health` | 健康检查 |
| GET | `/files/*` | 缓存文件静态下载（PDF 副本、对比图片） |

### 1. 创建任务 — 上传模式

`POST /api/compare`，`multipart/form-data`：

- `bidFiles`：投标 PDF 文件，字段重复多次，至少 2 个
- `biddingFile`：招标 PDF 文件，可选
- `settings`：可选，JSON 字符串，如 `{"text":{"threshold":0.8,"minLength":15,"excludeToc":true},"image":{"similarity":0.9,"minSize":300}}`
  - `text.excludeToc`：是否排除目录点线行（`标题............12` 这类排版元素），默认 `true`；设 `false` 时目录行参与文字对比

```bash
curl -X POST http://localhost:3000/api/compare \
  -F "bidFiles=@D:/docs/a.pdf" \
  -F "bidFiles=@D:/docs/b.pdf" \
  -F "biddingFile=@D:/docs/exclude.pdf" \
  -F 'settings={"text":{"threshold":0.8}}'
```

响应 `202`：

```json
{ "success": true, "jobId": "9b8…", "status": "waiting", "message": "对比任务已创建" }
```

### 2. 创建任务 — 本地路径模式

`POST /api/compare/paths`，`application/json`（服务器可直读的路径，同机部署时最省事）：

```bash
curl -X POST http://localhost:3000/api/compare/paths \
  -H "Content-Type: application/json" \
  -d '{"bidFiles":["E:/docs/a.pdf","E:/docs/b.pdf"],"biddingFile":"E:/docs/exclude.pdf"}'
```

### 3. 查询状态

`GET /api/jobs/:jobId/status`

```json
{
  "success": true,
  "jobId": "9b8…",
  "status": "running",
  "progress": {
    "phase": "comparing",       // queued | parsing | comparing | done
    "parseFile": "a.pdf",       // parsing 阶段：当前解析的文件
    "parseProgress": 0.42,
    "pairId": "1f0…",           // comparing 阶段：当前对比对
    "text": 0.67,               // 当前对的文字对比进度 0~1
    "image": 0,
    "donePairs": 3,             // 已完成的对比对数
    "totalPairs": 10
  },
  "createdAt": 1690000000000,
  "startedAt": 1690000000120,
  "finishedAt": null,
  "result": null,
  "error": null
}
```

状态机：`waiting → running → completed / failed`；`waiting → canceled`（被取消）。

### 4. SSE 进度订阅

`GET /api/jobs/:jobId/events`，`text/event-stream`。连接后先推一条当前快照，之后每次状态/进度变化推一条；任务进入终态推送最后一条并关闭连接。每 15 秒发送心跳注释行，断线可自动重连（`retry: 3000`）。

```js
const es = new EventSource('http://localhost:3000/api/jobs/<jobId>/events');

es.onmessage = (event) => {
    const { status, progress, result, error } = JSON.parse(event.data);

    if (status === 'completed') { /* 取结果 */ es.close(); }
    if (status === 'failed') { /* 报错 */ es.close(); }
};
```

### 5. 获取结果

`GET /api/jobs/:jobId/result`（任务完成后）。结果数组中每项为一对文件的对比（文字相似 / 图片匹配 / 属性对比明细）。

**路径已映射为 URL**：结果里的图片、文件路径位于服务器缓存目录内，响应中已替换为 `http://<host>/files/<hash>/images/xxx.png` 形式的下载地址；仅在服务器本机调用且需要本地路径时，可用 `GET /api/results/:groupId` 之外的方式自行换算（URL 去掉 `/files/` 前缀拼回 `CACHE_PATH/files` 即可）。

任务记录淘汰（默认保留最近 200 条终态）后，仍可随时用 `GET /api/results/:groupId` 按组查询。

### 6. 取消任务

`DELETE /api/jobs/:jobId`。仅 `waiting` 状态可取消；运行中的任务暂不支持中止（库未提供中断机制），返回 `409`。

## 架构

```
调用方 ──HTTP──▶ fastify ──▶ TaskManager（内存队列，串行调度）
                                 │
                                 ▼
                          BidComparator（worker 线程池）
                                 │
                                 ▼
                    CACHE_PATH/files（PDF、图片缓存）
                    CACHE_PATH/result/<groupId>/（结果持久化）
```

- `server.js`：HTTP 路由、上传处理、SSE、结果路径→URL 映射、优雅关闭
- `taskManager.js`：任务状态机、串行调度、进度合并广播（约 250ms 窗口）
- 优雅关闭：Ctrl+C 后停止接受新任务 → 取消排队任务 → 等运行中任务完成（最长 10 分钟）→ 回收线程 → 退出

## 测试

```bash
npm start        # 终端 1：启动服务
npm test         # 终端 2：冒烟测试（路径模式 / 上传模式 / 校验 / SSE 状态流转）
```

测试默认用仓库 `docs/` 下的两个小 PDF，可用 `PDF1`/`PDF2` 环境变量替换。
