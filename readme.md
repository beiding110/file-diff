# pdf内容对比

## 对比内容

- 正文
- 图片
- 文件属性

## 对比过程

- 将pdf进行缓存
- 将pdf进行解析，解析为：拆分的文字段落、图片、属性
- 将解析结果进行缓存
- 计算pdf两两交叉数组，准备用来检测
- 按组进行对比：
  - （如果有需要排除的内容，则先对文字内容进行排除）
  - 文字对比，将阈值以上的结果保留
  - 图片对比，将阈值以上的结果保留
  - 属性对比，将相同值的属性进行标记
  - 得到结果数组
- 缓存结果
- 返回结果

## 使用方法

```js
import { BidComparator, setCachePath } from './index.js';

// setCachePath 可设置缓存位置
// 默认为本库上层的 /cache 文件夹
// setCachePath('path/to/cache')

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
