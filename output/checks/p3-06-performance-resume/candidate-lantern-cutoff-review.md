# 候选诊断 trace：官方重放与机制边界

2026-09-16。输入为 `diagnostic-trace/attempt-2026-09-16T08-21-29.460Z-32df9e34` 中 CN gift / JA home 各 3 份保存的 LHR、trace、DevTools log、Lantern inputs；全部路径相对本目录。输出 `candidate-lantern-cutoff-replay.json` 保留 24 个原始输入 SHA-256、全部模拟节点/依赖、字体原始时间和成员判断。未覆盖历史证据、修改脚本或生产代码，未启动 Chrome。串行离线重放耗时 0.317 秒。

**这是开启 TEST diagnostics 的新 fixture，增加 schema 校验与同步 I/O，不能与旧 baseline 视作严格相同的运行条件。** 以下证明所记录导航的模拟机制；不提供去除诊断开销后的性能估计，也不把时序变化全归因于字体或本轮代码。

## 重放结果

锁定 Lighthouse 13.4.1 官方 default DevTools graph + trace paint 路径，原节流和 settings 完整保留。六份 FCP/LCP 模拟结果与 LHR 严格相等，12 个 observed timestamp 也严格相等：全部 `EXACT_OFFICIAL_REPLAY`。39 个字体节点的 cutoff 与 FCP/LCP optimistic/pessimistic 实际成员判断全部吻合。

下表字体数在 optimistic/pessimistic 两图中相同；单位 ms。

|样本|observed FCP|observed LCP|模拟 FCP|模拟 LCP|FCP / LCP 图字体数|LCP 两图终点|
|---|---:|---:|---:|---:|---|---|
|CN gift 1|625.914|625.914|3319.151|4369.151|5 / 5|UI 字体|
|CN gift 2|1552.632|1552.632|4975.738|5575.738|9 / 9|原字体 119、108 同时结束|
|CN gift 3|1511.677|1511.677|4972.544|5572.544|9 / 9|原字体 108|
|JA home 1|44.432|654.272|1505.893|3383.840|0 / 2|UI 字体|
|JA home 2|40.406|526.201|1504.581|3381.872|0 / 2|UI 字体|
|JA home 3|39.568|447.224|1505.468|3383.202|0 / 2|UI 字体|

CN 第 1 次纳入 Latin、UI、117、112、116；第 2/3 次所有 9 个实际请求字体均在 paint 前完成并进入图。第 2 次 119、108 原字体在 observed 611.260/611.425ms 完成，真实绘制迟至 1552.632ms；它们在模拟中却成为 5575.738ms 的终点。故“模拟终点是字体”不等于“真实绘制等到了同样久的字体下载”。

JA 三次 UI 在 observed 651.307/523.786/445.843ms 完成，比真实 LCP 早 2.965/2.415/1.381ms，均被纳入 LCP 两图；FCP 早得多，所以 FCP 图不含字体。两图 LCP 分别约 3157–3159ms / 3607–3609ms，均由 UI 结束，平均后稳定在约 3383ms，尽管三次 observed LCP 相差约 207ms。

## 实际时序变化，单独记录

|页面|旧 baseline observed LCP 三次|此次有诊断 observed LCP 三次|可确认的局部事实|
|---|---|---|---|
|CN gift|227.790 / 218.611 / 219.362|625.914 / 1552.632 / 1511.677|此次实际绘制都较晚，不只是模拟值变大|
|JA home|612.889 / 640.350 / 620.627|654.272 / 526.201 / 447.224|首次较晚，后两次较早；不是一致实际回退|

CN 此次 TTFB 为 538.515/485.999/452.119ms，图片发现延迟为 7.554/7.234/6.112ms，下载为 7.600/10.256/11.539ms，render delay 为 **72.245/1049.143/1041.907ms**。这是真实的文档等待与后两次绘制间隙，需要另查真实 trace/诊断时序，不能被 Lantern 截点机制解释掉；本次不追加分析或猜测间隙根因。JA TTFB 仅 4.791/3.724/3.480ms，图片发现延迟为 615.399/499.820/411.647ms，下载小于 2ms，render delay 约 21–32ms。

LCP 元素仍分别是 `Rose Palace · zh-CN` 主图和 `Mira Vale independent mobile · ja` hero。此次实际字体流量 CN 每次 9 个 / 556871B、JA 每次 4 个 / 174170B，与之前候选 attempt4 相同；没有发现此次新增字体下载数量。旧 baseline 已证明少量字体跨 paint 截点即可改变模拟图；此次候选进一步证明字体可以是模拟关键终点。**这些证据仍不能精确重建没有保存 trace 的旧 attempt4，也不能隔离 TEST diagnostics、主机调度等变量的影响。**

## 验收范围

此次完整诊断 27 份内容验证全部有效、0 collection failure；9 组只有 `en/artist`、`zh-CN/artist`、`ja/artist` 同时达到三项 lab 预算。整体仍为 `COLLECTED_DIAGNOSTIC_BUDGET_FAILED`，采集命令 exit 1。六份官方重放成功是分析工具的准确性证据，不是性能验收通过。

**27 次读取正常仅说明此轮未复现旧故障，不等于旧读取/内容错误已修复。** 保留旧无效样本与故障定位任务，不能以此次 27 份替换或拼接旧正式 63 次验收。
