# RUM 默认关闭时的实际下载成本

2026-09-24，只读编译产物与已经完成的浏览器响应清单；没有重建、重新采样或修改产品。机器证据及SHA绑定见 `rum-disabled-bundle-cost.json`。

**结论：默认 disabled 并非 RUM 相关代码零下载。** 当前 Next 编译把小型 collector/发送包装和异步导入注册合入一个原本就加载的共享块；独立 `web-vitals` 指标实现块在正式294格初始加载中均未请求。可对照的基线三页每页净增 **1009 B Node gzip（约0.99 KiB）**，全部来自该共享块的替换。

## 浏览器响应与磁盘编译内容相互验证

候选产物：`18cceb47-ced9-43f8-a19a-61fde7ecdaee/workspace/apps/storefront/.next/static/chunks`。正式证据：`formal-performance/browser-attempt-1/six-screen/results.json`。

- 七语言 × 七公开页面 × 六视口，共 **294格/2352条script响应**；每条响应SHA、原始体积和原门使用的Node gzip体积都与当前候选磁盘产物吻合。
- **294/294格**下载 `34ezpajeoo8oe.js`，16659原始字节、4670 B Node gzip。读取编译正文可见 `RumCollector` 导出、固定 `/api/storefront/rum` 发送包装、`samplePermille`、按文档去重及 `load:()=>e.A(77332)`；77332异步注册明确指向 `38xug_56lnpts.js`。这是编译正文和实际下载的直接证据，不是从文件hash变化推断模块归属。
- `38xug_56lnpts.js` 为8790原始字节、3249 B Node gzip，编译正文导出 `onLCP`、`onINP`、`onCLS` 等标准指标实现。它在 **0/294格**初始script响应中出现。
- 以上观察窗口是实际初次导航至network-idle/fonts-ready，未滚动、未强制图片eager；不能外推到之后任意交互或导航。该资源观察器不记录fetch/POST响应，所以本文件单独不能证明“POST次数为零”。采集是否执行仍须结合配置/挂载边界和专门RUM浏览器证据，而不是把collector字节下载等同于采集执行。

## 与原基线的同locale/同页/同视口对照

基线 `baseline-browser-1` 仅有以下三个zh-CN/390×844诊断资源单元，不能冒称基线也做了七语294格。

| 页面 | 基线JS Node gzip | 候选disabled | 差值 |
| --- | ---: | ---: | ---: |
| home | 152393 B | 153402 B | +1009 B |
| artist | 150744 B | 151753 B | +1009 B |
| gift | 154012 B | 155021 B | +1009 B |

每页同为8个script，**7个响应SHA/原始字节/gzip全部相同**；字体SHA集合也相同。唯一替换为：

- 旧共享块 `3rrddfj_zf4lv.js`：14378原始字节 /3661 B gzip，无collector导出、固定RUM endpoint或web-vitals异步映射。
- 新共享块 `34ezpajeoo8oe.js`：16659原始字节 /4670 B gzip；新增collector工厂及惰性loader，原共享实现也有压缩变量重命名等编译差异。

因此净增 **2281原始字节/1009 B gzip** 可精确定位到这一共享块。不能把整个4670 B算成RUM开销，也不能从压缩后共享块净差进一步精确拆分collector、loader与压缩重排各占多少；本次未测解析/执行CPU开销，不宣称1009 B就是独立模块的压缩体积或稳定跨版本常量。

这里的gzip都是原验收方法：对实际解压后的响应正文用Node `gzipSync`重新压缩，便于同口径预算比较；**不是浏览器实际网络传输字节**。正式环境的压缩协议、缓存与CDN仍影响真实成本。150000 B仍为原SHOULD预算，三页基线本来就超过；不能因正式LH硬门通过而把此建议差异隐去。

## 文档口径建议（由协调者修改）

`docs/operations/rum.md` 的 disabled 条目可以保留“不挂载collector、当前初始页面不加载独立web-vitals指标实现、不开启采集”，但应明确：**默认关闭不等于RUM相关包装代码零下载；本次编译的共享块净增加约1009 B Node gzip，正式294格均已计入资源预算。** 原“没有collector引用”若指React挂载，应明确写“没有collector组件挂载”，避免与编译共享块注册混淆。

采集开启的完整浏览器运行仍待最终通过。独立web-vitals块的磁盘3249 B只能描述该编译产物大小，不能在获得开启模式实际响应前当成已观测的下载差值。默认disabled H2矩阵与enabled HTTP证据可比较资源正文/体积；不能把两种传输的时间差写成严格性能A/B或真实用户p75。
