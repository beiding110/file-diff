# BidComparator API Server

支持长时间运行任务（超过1小时）的 BidComparator API 服务

---

## 🎯 核心特性

- ✅ **异步任务处理** - HTTP 请求立即返回 jobId，不阻塞
- ✅ **实时进度追踪** - 支持轮询和 WebSocket 实时推送
- ✅ **任务队列管理** - 基于 Bull + Redis，支持任务优先级、重试、并发控制
- ✅ **高可靠性** - Redis 持久化，服务重启不丢失任务
- ✅ **任务取消** - 支持取消正在运行的任务
- ✅ **RESTful API** - 标准 REST 接口
- ✅ **WebSocket 支持** - 实时推送进度到前端
- ✅ **智能启动** - 自动检测并启动所有必需服务

---

## 📋 系统要求

- **Node.js** >= 18.0.0
- **Redis** >= 6.0
- **操作系统**：Windows / Linux / macOS

---

## 🚀 快速开始

### 方式一：使用统一启动脚本（推荐）

#### Windows 用户

双击 `start.bat`

脚本会自动：
1. 检查 Node.js 是否安装
2. 自动安装 npm 依赖（如需要）
3. 检查 Docker 是否安装
4. 检查 Docker Desktop 运行状态
5. 自动启动 Redis 容器（使用 Docker）
6. 验证 Redis 连接（最多重试 3 次）
7. 启动 API 服务器
8. 智能处理错误并提供解决建议

**启动后会显示**：
```
╔═════════════════════════════════════╗
║   BidComparator API Server 启动脚本                  ║
╚═══════════════════════════════════════╝
```

#### Linux/Mac 用户

```bash
cd server
chmod +x start.sh
./start.sh
```

### 方式二：手动启动

#### 1. 安装依赖

```bash
cd server
npm install
```

#### 2. 启动 Redis

**选项 A：使用 Docker（推荐）**
```bash
docker run -d -p 6379:6379 --name bid-comparator-redis redis:7-alpine
```

**选项 B：安装本地 Redis**

**Windows - Memurai（Redis for Windows）**：
1. 下载：https://www.memurai.com/get-memurai
2. 安装：运行安装程序

**Ubuntu/Debian**：
```bash
sudo apt-get install redis-server
redis-server
```

**macOS**：
```bash
brew install redis
redis-server
```

**或使用 WSL**：
```bash
wsl sudo apt-get install redis-server
wsl redis-server
```

#### 3. 验证 Redis

```bash
# 使用 redis-cli
redis-cli ping

# 或使用 Docker
docker exec -it bid-comparator-redis redis-cli ping

# 期望输出：PONG
```

#### 4. 启动服务器

**开发模式**（自动重启）：
```bash
npm run dev
```

**生产模式**：
```bash
npm start
```

**启动后的体验**：

服务器启动后会：
1. 自动在浏览器中打开 Demo 页面
2. 显示所有可用的 API 端点
3. 可以直接在页面上测试 API 功能

访问地址：
- **Demo 页面**: http://localhost:3000/demo
- **健康检查**: http://localhost:3000/health
- **API 文档**: 继续阅读本文档

如需禁用自动打开浏览器：
```bash
# Windows
set NO_BROWSER=true
npm start

# Linux/Mac
NO_BROWSER=true npm start
```

### 遇到问题？

如果启动过程中遇到问题，可以使用诊断工具：

```bash
cd server
test_environment.bat
```

诊断工具会自动检查：
- ✅ Node.js 和 NPM 版本
- ✅ Docker Desktop 状态
- ✅ Redis 容器状态
- ✅ 端口占用情况

根据诊断结果快速定位并解决问题。

---


**启动后会显示**：
```
╔═══════════════════════════════════════╗
║   🚀 Server running on port 3000                       ║
║   📊 Concurrent jobs: 2                                ║
║   🔗 Redis: localhost:6379                             ║
╚═════════════════════════════════════════╝
```

### 如果 Redis 未启动或无法安装

脚本会提供详细的错误提示和替代方案：
- 显示手动启动 Redis 的命令
- 提供 Docker 启动说明
- 提供在线 Redis 选项（仅用于测试）

---

## 📡 API 接口

### 1. 创建对比任务

**POST** `/api/compare`

创建一个异步对比任务，立即返回 `jobId`。

**请求体**：
```json
{
  "bidFiles": ["./docs/file1.pdf", "./docs/file2.pdf"],
  "biddingFile": "./docs/bidding.pdf",
  "settings": {
    "text": {
      "threshold": 0.8,
      "minLength": 15
    },
    "image": {
      "similarity": 0.9,
      "minSize": 300
    }
  },
  "cachePath": "./cache"
}
```

**响应**：
```json
{
  "success": true,
  "jobId": "550e8400-e29b-41d4-a716-4466554400000",
  "message": "对比任务已创建"
}
```

### 2. 查询任务状态

**GET** `/api/jobs/:jobId/status`

获取任务的当前状态和进度。

**进度说明**：
- `status`: 任务状态（`waiting` | `active` | `completed` | `failed`）
- `progress.progress`: 0-1 的进度值
- `progress.stage`: 当前阶段（`initializing` | `processing` | `comparing` | `text` | `image`）
- `progress.message`: 附加消息

**响应**：
```json
{
  "success": true,
  "jobId": "...",
  "status": "processing",
  "progress": {
    "progress": 0.45,
    "stage": "text",
    "message": "正在对比..."
  },
  "created": 1704067200000,
  "processed": 1704067201000,
  "finished": null
}
```

### 3. 获取任务结果

**GET** `/api/jobs/:jobId/result`

获取已完成任务的结果。

**响应**：
```json
{
  "success": true,
  "jobId": "...",
  "status": "completed",
  "result": {
    "success": true,
    "groupId": "group-uuid",
    "message": "对比完成"
  }
}
```

### 4. 取消任务

**DELETE** `/api/jobs/:jobId`

取消正在运行或等待中的任务。

**响应**：
```json
{
  "success": true,
  "message": "任务已取消"
}
```

### 5. 获取所有任务

**GET** `/api/jobs`

获取所有任务列表。

**查询参数**：
- `state`: 任务状态过滤（`waiting` | `active` | `completed` | `failed` | `all`）
- `limit`: 返回数量限制（默认 50）

**响应**：
```json
{
  "success": true,
  "jobs": [
    {
      "id": "...",
      "status": "completed",
      "progress": { "progress": 1 },
      "created": 1704067200000,
      "processed": 1704067800000,
      "finished": 1704067800000
    }
  ]
}
```

### 6. 获取队列统计

**GET** `/api/stats`

获取队列统计信息。

**响应**：
```json
{
  "success": true,
  "stats": {
    "waiting": 5,
    "active": 2,
    "completed": 150,
    "failed": 3,
    "delayed": 0,
    "paused": 0
  }
}
```

### 7. 健康检查

**GET** `/health`

检查服务健康状态。

**响应**：
```json
{
  "status": "ok",
  "timestamp": "2024-02-11T10:30:00.000Z"
}
```

### 8. WebSocket 连接

**WS** `/ws`

实时接收任务进度更新。

**消息格式**：

**订阅任务**：
```javascript
{ "type": "subscribe", "jobId": "550e8400-..." }
```

**进度更新**：
```javascript
{
  "type": "jobProgress",
  "jobId": "...",
  "progress": {
    "status": "processing",
    "stage": "text",
    "progress": 0.45,
    "message": "正在对比..."
  }
}
```

**任务完成**：
```javascript
{
  "type": "jobCompleted",
  "jobId": "..."
}
```

**任务失败**：
```javascript
{
  "type": "jobFailed",
  "jobId": "...",
  "error": "错误信息"
}
```

---

## 🔧 配置

### 环境变量

创建 `.env` 文件：

```bash
# 服务器端口
PORT=3000

# Redis 配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password  # 可选
REDIS_DB=0

# 并发任务数（同时运行的最大任务数）
# 建议设置为 CPU 核心数的 1-2 倍
CONCURRENCY=2

# 日志级别
LOG_LEVEL=info
```

### 代码配置

修改 `server.js` 中的 `CONFIG` 对象：

```javascript
const CONFIG = {
    port: 3000,
    redis: {
        host: 'localhost',
        port: 6379,
        password: undefined,
        db: 0,
    },
    concurrency: 2, // 同时运行的最大任务数
    defaultSettings: {
        text: { threshold: 0.8, minLength: 15 },
        image: { similarity: 0.9, minSize: 300 },
    },
};
```

---

## 📝 使用示例

### Node.js 客户端

```javascript
const axios = require('axios');

// 创建任务
const response = await axios.post('http://localhost:3000/api/compare', {
    bidFiles: ['./file1.pdf', './file2.pdf'],
    biddingFile: './bidding.pdf',
    settings: {
        text: { threshold: 0.8, minLength: 15 },
        image: { similarity: 0.9, minSize: 300 },
    },
});

const jobId = response.data.jobId;

// 轮询进度
const pollStatus = async () => {
    const { data } = await axios.get(`http://localhost:3000/api/jobs/${jobId}/status`);
    console.log('进度:', (data.progress.progress * 100).toFixed(2) + '%');

    if (data.status === 'completed') {
        const result = await axios.get(`http://localhost:3000/api/jobs/${jobId}/result`);
        console.log('结果:', result.data);
    } else if (data.status === 'failed') {
        console.log('任务失败');
    } else {
        setTimeout(pollStatus, 5000); // 5秒后再次查询
    }
};

pollStatus();
```

### 浏览器客户端

打开 `examples/browser-client.html` 查看完整的实时进度示例。

**功能特性**：
- ✅ 实时进度显示（进度条）
- ✅ 任务状态显示
- ✅ WebSocket 连接状态
- ✅ 美观的 UI 界面
- ✅ 完整的错误处理

### cURL 示例

```bash
# 创建对比任务
curl -X POST http://localhost:3000/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "bidFiles": ["./file1.pdf", "./file2.pdf"],
    "settings": {
      "text": {"threshold": 0.8, "minLength": 15}
    }
  }'

# 查询状态
curl http://localhost:3000/api/jobs/{jobId}/status

# 获取结果
curl http://localhost:3000/api/jobs/{jobId}/result

# 取消任务
curl -X DELETE http://localhost:3000/api/jobs/{jobId}

# 查看统计
curl http://localhost:3000/api/stats

# 健康检查
curl http://localhost:3000/health
```

---

## 🏗️ 架构说明

```
┌─────────────┐     POST /api/compare      ┌──────────────┐
│   Client    │ ──────────────────────────>│  Fastify     │
│ (Browser/   │                            │   Server     │
│   Node.js)  │ <───────────────────────────┤              │
└─────────────┘     返回 jobId             └──────┬───────┘
                                                 │
                                                 ▼
                                            ┌─────────────┐
                                            │  Bull   │
                                            │  Queue  │
                                            └─────┬───────┘
                                                  │
                                                  ▼
                         ┌─────────────────┴─────────────────┐
                         ▼                                   ▼
                         │  Worker 1 (处理中)  │   Worker 2 (处理中)  │
                         │  进度: 45%            │   进度: 78%            │
                         └─────────────────────────┘   └─────────────────────────┘
                                                  │
                                        ┌─────────────────────────┴──────────────────┐
                                        ▼                                   ▼
                                  ┌───────────────┐
                                  │ Redis      │
                                  │ (持久化)  │
                                  └───────────────┘
```

### 数据流程

1. **客户端** 发起对比请求
2. **Fastify** 接收请求，创建 Job
3. **Bull** 将 Job 添加到队列
4. **Redis** 持久化队列数据
5. **Worker** 从队列获取 Job 并处理
6. **Job** 处理过程中更新进度到 Bull
7. **Bull** 通过 Redis 发送进度更新
8. **WebSocket** 推送进度到客户端（可选）
9. **Worker** 完成后保存结果到 Redis
10. **客户端** 轮询或通过 WebSocket 获取结果

### 并发控制

- 默认同时运行 **2 个任务**
- 可通过 `CONCURRENCY` 环境变量调整
- 建议设置为 CPU 核心数的 1-2 倍

---

## 📊 监控与管理

### 查看队列统计

```bash
curl http://localhost:3000/api/stats
```

### 查看所有任务

```bash
# 查看所有任务
curl http://localhost:3000/api/jobs

# 查看特定状态的任务
curl http://localhost:3000/api/jobs?state=active&limit=10

# 只查看等待中的任务
curl http://localhost:3000/api/jobs?state=waiting
```

### 取消任务

```bash
# 取消正在运行的任务
curl -X DELETE http://localhost:3000/api/jobs/{jobId}
```

---

## 🚀 生产部署

### 1. 使用 PM2（推荐）

```bash
npm install -g pm2

# 启动
pm2 start server.js --name bid-comparator-api

# 查看状态
pm2 status

# 查看日志
pm2 logs bid-comparator-api

# 重启
pm2 restart bid-comparator-api

# 开机自启
pm2 startup
pm2 save
```

### 2. Docker 部署

创建 `Dockerfile`：

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    container_name: bid-comparator-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes
    restart: unless-stopped

  api:
    build: .
    container_name: bid-comparator-api
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - CONCURRENCY=4
    depends_on:
      - redis
    volumes:
      - ./docs:/app/docs:ro
      - ./cache:/app/cache
    restart: unless-stopped

volumes:
  redis-data:
    driver: local
```

启动：

```bash
docker-compose up -d
```

### 3. Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

---

## 🔧 常见问题

### 使用诊断工具

如果启动过程中遇到问题，可以先运行诊断工具：

```bash
cd server
test_environment.bat
```

诊断工具会检查：
- Node.js 和 NPM 是否安装
- Docker Desktop 是否运行
- Redis 容器状态
- 端口占用情况（3000、6379）

根据诊断结果，可以快速定位问题所在。

### 启动脚本闪退

如果 `start.bat` 运行后立即退出，可能的原因：

1. **Docker Desktop 启动超时**
   - 症状：显示"Docker已安装"后退出
   - 解决：手动启动 Docker Desktop，等待 1-2 分钟后重新运行
   - 或者运行 `test_environment.bat` 查看详细状态

2. **Redis 容器创建失败**
   - 症状：显示"Redis创建失败"
   - 解决：检查端口 6379 是否被占用
   - 手动创建：`docker run -d -p 6379:6379 --name bid-comparator-redis redis:7-alpine`

3. **端口被占用**
   - 症状：服务器启动失败，提示端口已被使用
   - 解决：
     ```bash
     # 查看 3000 端口占用情况
     netstat -ano | findstr ":3000"
     # 修改 .env 文件中的 PORT 配置
     ```

### 任务卡住不动

```bash
# 查看队列状态
curl http://localhost:3000/api/stats

# 查看 Bull 任务
# 在 server.js 中添加日志
compareQueue.on('error', (error) => {
    console.error('Queue error:', error);
});
```

### Redis 连接失败

```bash
# 检查 Redis 是否运行
redis-cli ping

# 查看 Redis 日志
tail -f /var/log/redis/redis.log
```

### 进度更新不及时

- 使用 WebSocket 代替轮询
- 检查 `job.updateProgress()` 调用频率
- 确保进度回调不执行耗时操作

### 内存管理

大文件对比时注意内存使用：
- 调整 `CONCURRENCY` 环境变量
- 监控 Redis 内存使用
- 设置适当的 Node.js 内存限制

### 端口被占用

修改 `.env` 文件：
```bash
PORT=3001  # 改为其他端口
```

### Docker Desktop 启动慢

首次运行可能需要 1-2 分钟启动

---

## 🔑 任务状态说明

### 任务生命周期

```
waiting (等待中)
    ↓
active (正在处理)
    ↓
completed (完成)
    ↓
failed (失败)
```

### 进度阶段说明

- `initializing` - 初始化中
- `processing` - 处理中
  - `text` - 文字对比阶段
  - `image` - 图片对比阶段
  - `comparing` - 综合对比阶段
- `completed` - 已完成

---

## ✅ 问题修复记录

### 1. WebSocket 插件导入错误

**错误**: `FastifyError [Error]: Plugin must be a function or a promise. Received: 'undefined'`

**修复**:
```javascript
// 错误
const { WebSocket } = require('@fastify/websocket');
fastify.register(WebSocket);

// 正确
const websocket = require('@fastify/websocket');
fastify.register(websocket);
```

### 2. 异步 map 函数语法错误

**错误**: `SyntaxError: Unexpected identifier 'job'`

**修复**:
```javascript
// 错误
jobs.map(job => ({
    status: await job.getState(),
}));

// 正确
const jobList = await Promise.all(jobs.map(async (job) => ({
    status: await job.getState(),
})));
```

### 3. Windows 中文乱码

**问题**: start.bat 启动时中文显示为乱码

**修复**: 在批处理文件开头添加 `chcp 65001` 命令

**效果**: 所有中文都能正确显示

---

## 📄 项目结构

```
server/
├── server.js                 # 主服务器文件
├── package.json              # 依赖配置
├── Dockerfile                # Docker 镜像构建
├── docker-compose.yml        # Docker Compose 配置
├── .env.example              # 环境变量示例
├── start.bat                # Windows 启动脚本（已更新）
├── README.md                 # 本文档
└── examples/                # 示例代码
    ├── nodejs-client.js      # Node.js 客户端
    └── browser-client.html   # 浏览器客户端（含实时进度）
```

---

## 📈 性能优化建议

### 1. 并发控制

默认同时运行 2 个任务，可根据服务器配置调整：

```bash
# 设置并发数（在 .env 中）
CONCURRENCY=4  # 同时运行 4 个任务
```

### 2. 任务超时

Bull 队列默认配置：
- `removeOnComplete: false` - 保留完成的任务
- `removeOnFail: false` - 保留失败的任务
- `attempts: 1` - 失败重试次数
- `timeout: 0` - 无超时限制（支持长时间任务）

### 3. Redis 连接池

默认使用单个 Redis 连接，可优化为：

```javascript
const redis = new Redis(CONFIG.redis, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: (retries) => {
        if (retries < 3) return new Error('retry strategy');
        return null;
    },
});
```

---

## 🎓 总结

### ✅ 完整功能

- ✅ 异步任务处理 - 不阻塞 HTTP 请求
- ✅ 实时进度追踪 - REST API 轮询 + WebSocket 推送
- ✅ 任务队列管理 - 查询、取消、列表
- ✅ 高可靠性 - Redis 持久化，服务重启不丢失
- ✅ 并发控制 - 可配置同时运行任务数
- ✅ 智能启动脚本 - 自动检测并启动所有服务
- ✅ 完美中文支持 - 防止乱码

### 🎯 适用场景

- ✅ PDF 文件对比（支持超长时间运行）
- ✅ 大批量任务处理
- ✅ 分布式任务处理（可选部署多个实例）
- ✅ 前后分离部署
- ✅ 生产环境部署

### 📦 快速开始

```bash
# 1. 克隆或下载项目
cd server
npm install

# 2. 启动 Redis（Windows 使用 start.bat）
docker run -d -p 6379:6379 --name bid-comparator-redis redis:7-alpine

# 3. 启动服务器
npm start
```

---

## 📞 License

MIT

---

## 🙏 常见问题

<details>
<summary><b>Q: Docker Desktop 启动很慢？</b>
A: 这是正常的，首次启动可能需要 1-2 分钟。可以查看 Docker Desktop 应用日志确认启动进度。
</summary>

<details>

<details>
<summary><b>Q: 如何完全卸载 Redis？</b>
A:
```bash
# Docker
docker stop bid-comparator-redis
docker rm bid-comparator-redis

# WSL
wsl sudo service redis-server stop
wsl sudo apt-get remove redis-server
```
</summary>

<details>

<details>
<summary><b>Q: 如何增加更多 Worker 实例？</b>
A: 修改 `CONCURRENCY` 环境变量。注意增加 Worker 数会消耗更多服务器资源，需要根据 CPU 和内存配置合理的值。建议设置为 CPU 核心数的 1-2 倍。
</summary>

---

**需要帮助？**

- 查看 `examples/` 目录中的客户端示例
- 阅读本文档的相关章节
- 检查服务器日志获取详细错误信息
