# 👑 pdf 内容对比 🚀

## 🔍️ 对比内容

- 📄 正文
- 🗺️ 图片
- 💼 文件属性

支持单线程、多线程对比。对比速率如下：

| 线程         | 单线程         | 多线程         |
| ------------ | -------------- | -------------- |
| 文字对比速率 | 29200 段文字/s | 56054 段文字/s |
| 图片对比速率 | 10000 图/s     | 23002 图/s     |
| 对比时间     | 22.53s         | 3.14s          |

速率实验参考文件：

| 文件     | A 文件   | B 文件   |
| -------- | -------- | -------- |
| 文字数量 | 27767 字 | 22810 字 |
| 图片数量 | 92 图    | 91 图    |
| 总页数   | 95页     | 92页     |
| 总大小   | 19.99MB  | 14.84MB  |

## 🧬 对比过程

- 将 pdf 进行缓存
- 将 pdf 进行解析，解析为：拆分的文字段落、图片、属性。解析期间将所有图片提取、缓存
- 将解析结果进行缓存
- 计算 pdf 两两交叉数组，准备用来检测
- 按组进行对比：
  - （如果有需要排除的文字内容，则先对文字内容进行排除）
  - 文字对比，将阈值以上的结果保留（包括句长、两段文字的长度比）
  - 图片对比，将阈值以上的结果保留（包括图片尺寸、两图片的像素数比）
  - 属性对比，将相同值的属性进行标记
  - 得到结果数组
- 缓存结果
- 返回结果

## ⛓️ 功能点

### pdf 解析

> worker/parsePDF.worker.factory.js

使用 pdfjs 将文件内容进行解析，分别提取每页的文字、图片。

文字：

> parsePDF.worker.factory.js/\_getPageTexts

提取页内文字时，根据以下规则对文字进行分段：

- 不同字体的，认为是不同的语句
- 常见标点符号（\n.!?;。！？；）分割的，认为是不同语句

将解析后的文字段和页码关联存放，进行缓存

图片：

> parsePDF.worker.factory.js/\_getPageImages

根据 pdfjs 中识别到的对象（getOperatorList），将图片的 data 数据转换为 png 的 rgba 数据，并使用 `sharp`进行缓存

### 文字对比

> worker/diff.worder.factory.js

根据预设的规则，将文字段进行两两对比。对比时：

- 移除长度过短的项
- 跳过排除长度差距过大的项
- 使用 `向量算法` 对比，排除不符合相似度的项
- 符合的项使用 `diff`进行对比，并获取相似度
- 留存符合相似度要求的项

### 图片对比

> worker/sharp.worker.factory.js

根据预设的规则，将图片进行两两对比，对比时：

- 移除长、宽过小的图片
- 跳过长、宽差距过大的图片
- 使用 `sharp` 将图片进行大小调整、灰度并二值化，结果存为一个字符串
- 使用字符串计算 `汉明距离`
- 留存符合相似度要求的项

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

```js
import BidComparator from './index.js';

// setCachePath 可设置缓存位置。默认为本库上层的 /cache 文件夹
// BidComparator.setCachePath('path/to/cache')

// 实例化
let comparator = new BidComparator();

// 设置文字检查进度回调函数
comparator.textCompareProgressHandlerFactory = function (id) {
    return function (num, str) {
        console.log(id, num, str);
    };
};

// 设置图片检查进度回调函数
comparator.imageCompareProgressHandlerFactory = function (id) {
    return function (num, str) {
        console.log(id, num, str);
    };
};

// 文件属性检查较快，不用设置回调

// 预处理文件，将文件缓存、解析
BidComparator.preload('./docs/g2-3.pdf');

// 更新对比设置
BidComparator.updateSettings({
    text: {
        threshold: 0.8, // 相似程度阈值
        minLength: 15, // 最短句长
    },
    image: {
        similarity: 0.9, // 相似程度阈值
        minSize: 200, // 最小图片尺寸
    },
    workers: 'multi', // 'single'时，为锁定单线程检测
});

// 进行对比
comparator
    .processFiles(
        [
            './docs/g2-1.pdf',
            './docs/g2-2.pdf',
            './docs/g2-3.pdf',
        ]
        './docs/g2-exclude.pdf' // 需要排除的文字内容
    )
    .then((res) => {
        // 全部解析完成的回调
        console.log(res);
    });
```

## ⚠️ 注意

- nodejieba 安装时，自动编译脚本会报错
  1. 需要电脑安装 vs2022，并勾选使用 c++ 开发
  2. 先忽略执行脚本并安装 `npm i nodejieba@2.6.0 --save --ignore-scripts`
  3. 将 `backup/StringUtil.hpp` 内容替换到 `node_modules/nodejieba/deps/limonp/StringUtil.hpp`
  4. 进入 `node_modules/nodejieba` 运行 `npm run install`
     参考：https://travisbikkle.github.io/zh-hant/2024/07/chinese-search/
