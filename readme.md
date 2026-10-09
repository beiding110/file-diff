# 👑 pdf 内容对比 🚀

## 🔍️ 对比内容

- 📄 正文
- 🗺️ 图片
- 💼 文件属性

支持单线程、多线程对比。多线程模式下文字对比由 diff 线程池并行执行（线程数默认为 CPU 核数，上限 20），图片对比为解析期预计算哈希后的纯内存计算，与线程模式无关。对比速率如下：

|线程|单线程|多线程（4 线程）|
|---|---|---|
|文字对比速率|≈4.5 万段文字/s|≈7.5 万段文字/s|
|图片对比速率|≈100 万图/s|≈100 万图/s|
|对比时间|≈1.1s|≈0.85s|

以上数据实测环境：Intel i5-7400（4 核）/ Node.js 24 / Windows 11，对比设置与下文「使用方法」示例相同。文字对比速率按对比阶段自身耗时折算（不含缓存加载与结果写盘）；「对比时间」为对比阶段端到端耗时，均不含 PDF 解析（首次解析约 15s，由 4 个解析线程并行完成后缓存，重复对比不再解析）。多线程下文字对比速率约为单线程的 1.6 倍，核数更多时并行度相应提高。复测命令：

```bash
node test/test_speed.js multi    # 或 single
```

速率实验参考文件（A × B 共 1 个对比对，实际执行文字对比 47300 对、图片对比 6461 对）：

|文件|A 文件（g2-1.pdf）|B 文件（g2-2.pdf）|
|---|---|---|
|文字段数（≥15 字）|525 段 / 22131 字|427 段 / 18390 字|
|图片数量|72 图|92 图|
|总页数|95 页|92 页|
|总大小|19.99MB|14.84MB|

## 🧬 对比过程

- 将 pdf 进行缓存
- 将 pdf 进行解析，解析为：拆分的文字段落、图片（同时预计算感知哈希）、属性。解析期间将所有图片提取、缓存
- 将解析结果进行缓存
- 计算 pdf 两两交叉数组，准备用来检测
- 按组进行对比（文字对比走 diff 线程池、图片对比在主线程内存计算，二者并行执行）：
  - （如果有需要排除的文字内容，则先对文字内容进行排除）
  - 文字对比，将阈值以上的结果保留（包括句长、两段文字的长度比）
  - 图片对比，将阈值以上的结果保留（包括图片尺寸、两图片的宽高比）
  - 属性对比，将相同值的属性进行标记
  - 得到结果并增量写入缓存
- 返回 GROUPID，通过 `BidComparator.history(GROUPID)` 按需读取结果

## ⛓️ 功能点

### pdf 解析

> worker/parsePDF.worker.factory.js

使用 pdfjs 将文件内容进行解析，分别提取每页的文字、图片。

文字：

> parsePDF.worker.factory.js/\_getPageTexts

提取页内文字时，根据以下规则对文字进行分段：

- 按字体、字号不同，认为是不同的语句
- 按坐标重组行，按内容是否占满整行、按缩进切分段落
- 常见标点符号（\n.!?;。！？；）分割的，认为是不同语句

将解析后的文字段和页码关联存放，进行缓存

图片：

> parsePDF.worker.factory.js/\_getPageImages

根据 pdfjs 中识别到的对象（getOperatorList），将图片的 data 数据转换为 png 的 rgba 数据，使用 `sharp` 进行缓存。缓存的同时为每张图片预计算感知哈希（dHash）：缩放到 10×10、灰度、按均值二值化为 100 位 0/1 字符串，供对比阶段直接使用。

### 文字对比

> worker/diff.worker.factory.js

根据预设的规则，将文字段进行两两对比。对比时：

- 移除长度过短的项
- 默认排除目录点线行（`标题............12` 这类排版元素，`excludeToc` 控制）：解析缓存保留 PDF 原文，仅在对比时按设置剔除，切换该设置无需重新解析
- 跳过长度差距过大的项（两段文字的长度比需落在阈值附近）
- 使用 `向量算法`（字符频率向量 + 余弦相似度）粗筛，排除不符合相似度的项
- 符合的项使用 `diff` 进行对比，并获取相似度
- 留存符合相似度要求的项（仅达标项构造高亮串）

多线程模式下由 diff 线程池并行执行（线程数默认为 CPU 核数，上限 20）：同一事件循环内提交的任务微批合并为一条消息，摊薄线程通信开销；文字段的向量带缓存，同一段文字不会重复计算。

### 图片对比

> utils/ImageComparator.js

图片的感知哈希已在解析缓存时由 `sharp` 预计算（见上文），对比阶段不再解码图片，直接在内存中比较哈希字符串：

- 按哈希对图片去重：页眉、logo、印章等每页重复出现的图片只对比一次，结果附带各侧出现的全部页码
- 移除长、宽过小的图片
- 跳过长、宽比例差距过大的图片
- 比较两个哈希的相同位数比例（汉明距离思路），留存符合相似度要求的项

由于只是百次字符比较（微秒级），图片对比在主线程执行即可，不需要 worker 线程。

### 实体提取

> utils/EntityExtracter

通过三种方式实现实体提取：

1. 【reg】全文正则匹配：如：时间、邮箱，等 `有固定格式的`。
2. 【condition】拆分词性后，根据条件匹配：如：手机号、人名，等 `存在于单个词语中，有固定规律的`。
3. 【context】拆分词性后，根据上下文匹配：如：地点、组织，等 `多个词语链接而成，有一定规律的`。

其中拆分词性使用 `nodejiaba`实现。

工作流程：

1. 【reg】全文正则匹配：匹配 - 校验 - 得到结果
2. 【condition】拆分词性后，根据条件匹配：切割词性 - 逐个判断是否满足条件 - 得到结果
3. 【context】拆分词性后，根据上下文匹配：切割词性 - 根据上下文摘取候选词组 - 切割两端 - 校验 - 得到结果

其中，context 支持 cut（包括 left、right 两个可选属性），即从渠到的待选词组两端（left 对应左端，right 对应右端），将满足 cut 条件的词切割抛弃掉，留下不需要切割的结果；reg、context 支持使用 valid 进行校验，将不符合校验结果的项直接排除；

词性参考：

[CTCLAS 汉语词性标注集](https://www.cnblogs.com/chenbjin/p/4341930.html)
[常见中文词性标注集整理](https://www.pianshen.com/article/940110595/)

## 📖 使用方法

本库为 CommonJS（`require`）导出：

```js
const BidComparator = require('./index.js');

// 设置缓存位置（可选）。默认为本库上层的 /cache 文件夹
// BidComparator.setCachePath('path/to/cache');

// 更新对比设置（可选）
BidComparator.updateSettings({
    text: {
        threshold: 0.8, // 相似程度阈值
        minLength: 15, // 最短句长
        excludeToc: true, // 排除目录点线行（`标题............12` 这类排版元素），默认 true；设 false 时目录行参与对比
    },
    image: {
        similarity: 0.9, // 相似程度阈值
        minSize: 200, // 最小图片尺寸
    },
    workers: 'multi', // 'single' 时为单线程对比，默认 'multi'
});

// 解析进度回调（可选）
BidComparator.setPreloadProgressHandler((filePath, num, str) => {
    console.log('解析进度', filePath, num, str);
});

(async () => {
    // 预处理文件（可选）：提前解析并缓存，后续对比直接命中缓存
    await BidComparator.preload('./docs/g2-3.pdf');

    // 实例化
    const comparator = new BidComparator();

    // 文字对比进度回调（可选）
    comparator.textCompareProgressHandlerFactory = function (id) {
        return function (num, str) {
            console.log('文字对比', id, num, str);
        };
    };

    // 图片对比进度回调（可选）
    comparator.imageCompareProgressHandlerFactory = function (id) {
        return function (num, str) {
            console.log('图片对比', id, num, str);
        };
    };

    // 文件属性检查较快，不用设置回调

    // 进行对比。返回 GROUPID 而非结果数组，结果增量写入缓存
    const groupId = await comparator.processFiles(
        ['./docs/g2-1.pdf', './docs/g2-2.pdf', './docs/g2-3.pdf'],
        './docs/g2-exclude.pdf' // 需要排除的文字内容（可选）
    );

    // 按 GROUPID 读取结果
    const results = await BidComparator.history(groupId);

    console.log(results);
})();
```

每对文件的对比结果中包含 `similarity` 字段，即文件级相似度（0~1）：

```js
similarity: {
    overall: { score: 0.073, a: 0.058, b: 0.092 },    // a/b 为该文件内容在对方中重复的比例，score 为合并命中率
    text:     { score: 0.228, a: 0.204, b: 0.256 }, // score 为 Dice 系数，a/b 为单向文字覆盖率（判断谁包含谁）
    image:    { score: 0.073, a: 0.058, b: 0.092 },  // 同上，图片按像素体量计
    metadata: { score: 0, same: 0, compared: 4 },    // 属性相同比例（仅统计两侧都有值的项）
}
```

每侧的 `a`/`b` 把该文件三类内容的命中字节除以自己的总字节（文字 + 图片 + 属性），`score` 则是两文件所有字节合并后的总体命中率（Dice 系数），适合排序与阈值告警。字节换算口径：文字按字符数 × 2（UTF-16），图片按 `width × height × 4`（未压缩位图），属性按值长度 × 2。注意该口径下图片体量通常远大于文字（一张中等图片抵近百万字），含图对的分数主要由图片决定；某类内容缺失时其权重自动归零，对应分项 `score` 为 `null`。

## 🌐 HTTP 服务

[server/](./server) 目录提供将本库封装为 HTTP 服务的版本：Fastify + 内存任务队列 + SSE 进度推送，支持文件上传与服务器本地路径两种提交方式，结果持久化在缓存目录、服务重启后仍可查询。用法与 API 文档见 [server/README.md](./server/README.md)。

## ⚠️ 注意

- nodejieba 安装时，自动编译脚本会报错
  1. 需要电脑安装 vs2022，并勾选使用 c++ 开发
  2. 先忽略执行脚本并安装 `npm i nodejieba@2.6.0 --save --ignore-scripts`
  3. 将 `backup/StringUtil.hpp` 内容替换到 `node_modules/nodejieba/deps/limonp/StringUtil.hpp`
  4. 进入 `node_modules/nodejieba` 运行 `npm run install`
     参考：<https://travisbikkle.github.io/zh-hant/2024/07/chinese-search/>
