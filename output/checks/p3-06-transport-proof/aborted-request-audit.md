# P3-06 H1 首组取消请求独立审计

2026-09-21，`/root/scheduler_audit`。只读解析已有原件与已安装 Lighthouse 13.4.1 源码；未重采、重放、运行测试或修改原报告。结论：**首组预注册的全代理请求完整性检查仍为 FAIL；第1次测量中的 LCP 图片和九个字体请求完整，两个取消请求出现在其捕获窗口之后。** 这两类结论应并列，不互相替代。

## 原件与时间边界

输入为 `output/checks/p3-06-storefront-acceptance/run-2026-09-21T15-45-06-322Z/browser-attempt-1/transport-results.json`，以及同 run 下 `transport-h1-a/gift-render-trace/zh-CN-gift-mobile-1{.json,-artifacts.json,-devtools.json,-trace.json}`。本次真实浏览器 `HostProduct=Chrome/153.0.8010.48`，不能沿用上一检查点的 Chrome 152 版本。

原 DevTools `Network.requestWillBeSent` 同时提供 wallTime 与 monotonic timestamp。以其差值将其他 CDP/Trace 时间投影到 UTC；所有此类事件的差值跨度为0.188ms，远小于下面约1.79s以上的边界间隔。时间表示用于跨日志定位，不把两个独立日志的毫秒精度当请求ID绑定。

| 证据 | UTC时间 / 状态 |
| --- | --- |
| 第1次测量唯一 Image 请求 `9516.6` | `w=750&q=75`，响应200，MIME image/avif；loadingFinished为15:49:52.948056，encodedDataLength=48416 |
| 第1次最终 image LCP候选 | 15:49:52.951364；nodeId=60，eager/high，首屏380×380图 |
| 九个字体请求 | 均200、有loadingFinished；最后完成15:49:52.869706 |
| 已捕获 DevTools 事件最大timestamp | 15:49:53.079134 |
| 已捕获 Trace 事件最大timestamp | 15:49:55.395976 |
| 代理请求26 | `/_next/image`，15:49:57.187→57.197，0 bytes，CLIENT_ABORTED，complete=false |
| 代理请求27 | `/_next/image`，15:49:57.188→57.198，0 bytes，CLIENT_ABORTED，complete=false |
| 第2次测量文档请求（代理28） | 15:49:58.552开始 |

两个取消请求开始于最终 image LCP 之后约4.24s、Trace末尾之后约1.79s；取消结束约1.35s之后才发生第2次测量文档请求。第1份 LHR 的24条网络记录无 `Network.loadingFailed`，无 runtimeError/runWarnings，同导航 `storefront-content` score=1；模拟LCP仍为5732.806ms，原失败预算保持。

## 能确定与不能确定的原因

`ImageElements` 中确有两个 DOM 图片元素：首屏 eager/high 与下方 lazy/auto，两者采集时均引用相同 gift 图片的750宽版本。因此不能称代理26/27已被证明是“另一张非LCP图片”。代理为保护信息仅保存 pathname、未保存query/CDP requestId；两个事件又位于原CDP/Trace窗口之外，无法将其精确绑定到图片宽度、DOM节点或发起操作。

已安装的 Lighthouse 13.4.1 源码显示：

- `core/gather/gatherers/full-page-screenshot.js` 在 `_resizeViewport` 改变视口高度并将DPR设为1，等待网络后截图，最后恢复原emulation；此操作可能触发图片请求。
- `core/gather/gatherers/bf-cache-failures.js` 的主动检查导航到 `chrome://terms`，再返回历史项。
- `core/gather/navigation-runner.js` 在所有gatherer之后清理storage、断开CDP，并关闭其自行创建的page。

该份 `Timing` 记录包含依次发生的 FullPageScreenshot（1140.360ms）与 BFCacheFailures（234.887ms）；BFCacheFailures结果为空数组。它们证明后置采集/清理确实存在，但没有原始请求事件把代理26/27直接连到其中某个动作。因此严格归类为 **测量窗口之后、辅助采集/收尾期间的客户端取消；具体触发动作未确认**，不宣布“截图导致”或“下一次测量导航导致”。

取消记录的 `status=200` 是代理读取 `outgoing.statusCode` 的值；客户端在首部发出前断开时该值也可能仍为默认200。它不能证明浏览器收到完整HTTP200，更不能覆盖 complete=false/CLIENT_ABORTED。

## 对本轮解释的影响

两个事后请求不能反向改变已记录第1次导航的 FCP/LCP、完整字体传输或其冻结的官方模型输入；这使继续对该原件做离线重放与路径解释具有意义。它们可能影响后续上游图片缓存或工作量，而query缺失阻止精确判断，故不能宣称整组没有副作用、缓存条件完全相同或协议差异具有纯因果解释。

保留 h1-a 原组 FAIL、全部81条组内请求和两条失败，不改门、不删样、不补采。可将“测量原件及官方重放的有效性”和“全代理请求完整性”分开列出，展示原12次结果，但最终诊断完整性仍失败。后续任何应用优化必须单独验证；本审计不构成性能、SEO、真实用户p75、浏览器证书链或生产部署验收。
