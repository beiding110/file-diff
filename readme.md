# pdf 内容对比

## 对比内容

-   正文
-   图片
-   文件属性

## 对比过程

-   将 pdf 进行缓存
-   将 pdf 进行解析，解析为：拆分的文字段落、图片、属性。解析期间将所有图片提取、缓存
-   将解析结果进行缓存
-   计算 pdf 两两交叉数组，准备用来检测
-   按组进行对比：
    -   （如果有需要排除的文字内容，则先对文字内容进行排除）
    -   文字对比，将阈值以上的结果保留（包括句长、两段文字的长度比）
    -   图片对比，将阈值以上的结果保留（包括图片尺寸、两图片的像素数比）
    -   属性对比，将相同值的属性进行标记
    -   得到结果数组
-   缓存结果
-   返回结果

## 实体提取

通过三种方式实现实体提取：

1. 【reg】全文正则匹配：如：时间、邮箱，等 `有固定格式的`。
1. 【condition】拆分词性后，根据条件匹配：如：手机号、人名，等`存在于单个词语中，有固定规律的`。
1. 【context】拆分词性后，根据上下文匹配：如：地点、组织，等`多个词语链接而成，有一定规律的`。

工作流程：

1. 【reg】全文正则匹配：匹配 - 校验 - 得到结果
1. 【condition】拆分词性后，根据条件匹配：切割词性 - 逐个判断是否满足条件 - 得到结果
1. 【context】拆分词性后，根据上下文匹配：切割词性 - 根据上下文摘取候选词组 - 切割两端 - 校验 - 得到结果

其中，context 支持 cut（包括 left、right 两个可选属性），即从渠到的待选词组两端（left 对应左端，right 对应右端），将满足 cut 条件的词切割抛弃掉，留下不需要切割的结果；reg、context 支持使用 valid 进行校验，将不符合校验结果的项直接排除；

词性参考：

[CTCLAS 汉语词性标注集](https://www.cnblogs.com/chenbjin/p/4341930.html)
[常见中文词性标注集整理](https://www.pianshen.com/article/940110595/)

## 使用方法

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
    images: {
        similarity: 0.9, // 相似程度阈值
        resizeWidth: 100, // 对比时统一尺寸
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

### 注意

-   nodejieba 安装时，自动编译脚本会报错
    1. 需要电脑安装 vs2022，并勾选使用 c++ 开发
    2. 先忽略执行脚本并安装 `npm i nodejieba@2.6.0 --save --ignore-scripts`
    3. 将 `backup/StringUtil.hpp` 内容替换到 `node_modules/nodejieba/deps/limonp/StringUtil.hpp`
    4. 进入 `node_modules/nodejieba` 运行 `npm run install`
       参考：https://travisbikkle.github.io/zh-hant/2024/07/chinese-search/
