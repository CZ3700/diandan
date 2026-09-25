# P3-06 首次绘制等待：独立测量机制审计

范围：基线 `a560ac7` 的只读测量审计，按 systematic-debugging 的根因调查步骤对照同构建慢/快样本；不修改生产、Chrome参数或采集工具，不运行Chrome、构建、测试或重放。仅写本报告。root继续持有Lane D；这里不是性能验收或根因已确认声明。

## 输入与独立核验

输入为 `output/checks/p3-06-storefront-acceptance/run-2026-09-17T08-41-18-090Z/browser-attempt-1/gift-render-trace/` 中旧目录入口同组sample2、sample3。当前目录隔离代码不是这两个历史样本间的变量。实际读取两份原trace、DevTools、config、artifacts，以及pinned Lighthouse13.4.1、chrome-launcher1.2.1和仓库采集源码。

已独立按原capture清单校验六文件长度/SHA：

| 样本 | 文件 | SHA-256 |
| --- | --- | --- |
| 慢2 | trace | `50883ab9cedb177d1019e4c6deb4ea8f6d206c4fc40d84adc984859ced9c1710` |
| 慢2 | DevTools | `0b9b5bf1293349b83b2805d93fc88e55f71129cb834411ace976361a4f01964c` |
| 快3 | trace | `34f836f5f54cc3844c2f239bf7973daa7fe180420fd3a6173edf877eea7df9ce` |
| 快3 | DevTools | `e2c1481e79dc2a8709854690932f916e19fbf2cbf7fd6b0be7fcd00f91f57a4a` |
| 两者 | config，完全相同5,335B | `2844aacc91cdcd8f9795ad8c77b2772e8629b65779550a9daf758dcf725ba392` |

| 同导航事实（相对各自navigationStart） | 慢2 | 快3 |
| --- | ---: | ---: |
| 图片网络结束 | 528.146ms | 274.438ms |
| 官方FP/FCP/LCP | 1,597.291ms | 316.253ms |
| 图片结束至LCP | 1,069.145ms | 41.815ms |
| DevTools DOMContentLoaded | 1,237.797ms | 792.787ms |
| DevTools load | 1,238.130ms | 792.992ms |
| Chrome Browser / GPU pid | 86571 / 86579 | 86571 / 86579 |
| 当前目标renderer pid | 86626 | 86662 |
| artifacts BenchmarkIndex | 2665.5 | 3424.5 |

慢2的目标frame `45167DB5AD0F228668B84B3D3724405C`、loader/navigationId `2AB059CC72FCF64CDF243417E2926789`；快3对应frame `CFC3CA98D4AB3BD17FEEE415D23DC384`、navigationId `D77F6ABF7A724F14DA8D962DC09D4DDB`。原DevTools的 `Page.lifecycleEvent` 与trace所录FP/FCP值相同；不是仅依赖离线模拟值，也没有混用about:blank或另一frame的导航起点。两者warnings为空、无PageLoadError。

## 采集流程与一秒等待

仓库入口 `storefront-gift-trace-verification.mjs` 的流程是组前一次公开API读取→启动一个owned Chrome→顺序调用原生Lighthouse三次→每次返回后写完整原始文件/读取日志→组后关闭Chrome。两次Lighthouse之间没有额外浏览器预热、手写sleep、截图或bringToFront。`run-comparison.mjs` 仅在组之间按显式stage分派该入口；完整88场景在两组Lighthouse之后执行。

pinned `lighthouse/core/gather/navigation-runner.js` 的实际顺序：

1. 每次Lighthouse连接同一Chrome，建立自己的新page；导航about:blank、准备emulation/存储重置。
2. startInstrumentation / startSensitiveInstrumentation，其中Trace启动默认trace类别。
3. Page.navigate目标页面，并等待FCP、load和network quiet；之后等CPU quiet。
4. stopSensitiveInstrumentation（Trace结束）、stopInstrumentation，然后getArtifact收集内容、全页截图等。
5. 关闭本次page并disconnect，下一次重新建立page。Chrome主进程仍相同。

由此，慢2不是该组三次中唯一的Chrome主进程冷启动；两次均新建目标renderer。新page、emulation、Debugger/coverage/trace、存储重置本来就是测量环境的一部分，不能据此声称完全没有观测开销，但没有找到慢样本独有的显式操作。

`pauseAfterFcpMs=1000` 的实现位于 `driver/wait-for-condition.js:76`：收到 `Page.lifecycleEvent.name === 'firstContentfulPaint'` **之后**才在Node侧开启该计时器。`pauseAfterLoadMs`也在load后开始；CPU quiet观察器则在FCP/load/network初始等待全部满足后才安装。它们决定何时停止采集，不能直接解释慢样本在首次FCP之前的1,069ms空隙，不能因为数值同为约一秒就归因。`navigation-runner.js:204–220` 也没有在目标导航中插入一个先等待1秒再解除绘制的步骤。

## 截图、内容检查与可见性边界

仓库自定义 `AcceptanceContentGatherer` 只有getArtifact中的只读checkVisibility/querySelector；`FullPageScreenshot` 的viewport调整和 `Page.captureScreenshot` 也只在getArtifact执行。由上述顺序，这两者均在Trace结束后；不能把这次trace内首绘等待直接归因于它们。

不同的是默认Trace自身启用 `disabled-by-default-devtools.screenshot`，filmstrip截图在导航期间确实存在。慢2有37个Screenshot事件、快3有25个，且默认trace包含JS/stack/源码rundown等观察项。未做去除这些观察项的实验，不能声称其成本绝对为零；也不能擅自关闭它们并把较快的新结果当作产品收益。

已直接解码查看原trace内截图（未修改图片）：慢2的Screenshot[1]@271.997ms和[16]@530.914ms仍白；[17]@1,606.575ms出现黑色页面、header和正文，但主图矩形尚黑；[36]@1,922.247ms主图全显。快3[1]@322.293ms同样先出现页面与黑色主图矩形。应区别官方LCP、首张非白filmstrip和主图视觉完全呈现；截图事件的时间也不是精确的presentation边界。600ms左右PaintImage不等于600ms已经对用户呈现，空隙内没有截图也不能单凭“无截图”断言期间完全无呈现。

慢2同目标node8两次PaintImage为600.411ms和1,594.351ms；同URL的node36不能当主图节点。root/trace代理进一步关联renderer/layer/frame/submit链；本报告不把同进程的任意raster、activate或DroppedFrame事件视为该图片的因果链。

现有DevToolsLog保存Page/Network/Runtime事件，**不等于所有CDP命令往返日志**，没有完整focus、visibility、窗口occlusion、OS调度状态或Chrome内部绘制抑制原因。默认trace未见可直接断言目标页面visibility切换/paint suppression原因的事件。缺少这些事件不能证明从未发生，也不能凭截图缺口宣布是采集bug。

## Chrome与Lighthouse设置

两次config字节相同：Chrome152.0.7977.84、headless=new、Lighthouse13.4.1；mobile412×823、DPR1.75、simulate、目标RTT150ms/吞吐1638.4Kbps/CPU4；无additionalTraceCategories、无INTERNAL_LANTERN_USE_TRACE。存储重置启用，FullPageScreenshot启用，skipAboutBlank=false。缓存状态两次均为Next图片HIT；它只排除此二样本间“MISS对HIT”的简单解释，不代表所有缓存/进程资源状态相同。

保存的 `launchOptions.chromeFlags` 只有仓库显式四项（headless、TEST证书SPKI、TEST主机解析、no-proxy）。pinned chrome-launcher在ignoreDefaultFlags未开启时还追加其默认flags，包含disable-background-timer-throttling、disable-renderer-backgrounding、disable-backgrounding-occluded-windows等，并创建临时profile；因此不能把保存的四项误称完整实际argv。已从pinned源码核默认行为，但未保留当次完整进程argv/全部环境状态，仍应标明此证据边界。不给出改flags的优化建议。

pinned `lib/emulation.js:103` 对simulate只清理网络限速，不在采集期设置CPU4物理减速；CPU4属于后续模拟，并用于 `requestIdleCallback` deadline shim。shim将timeRemaining上限调整为10ms（(50−10)/4），仍转调原生requestIdleCallback，没有新增固定1秒延时。Lighthouse还启用Debugger跳过暂停/异步栈、JS使用量等标准观察；两次相同，仍可能随实际宿主负载产生不同开销。BenchmarkIndex的2665.5/3424.5差异表明不可把两次运行视为同一瞬时CPU环境，但该数字本身不能定位该一秒停顿，也不能用它“修正”原失败结果。

## 独立判断与下一证据要求

**确认：首次绘制等待在原始同导航Chrome事件中真实存在，非只由Lantern模拟或错误导航起点产生。未确认：产品代码、浏览器内部调度与观测开销三者中哪一个是根因。** 目前可排除“Lighthouse在FCP前手工等一秒才截图/验证内容”的简单解释，以及这两次之间显式Chrome/config变更的解释。不能排除内部绘制抑制/调度，也没有证据证明应修改应用。

可证伪假设应表述为：**目标页面已经产生主线程paint/commit，但后续目标frame的调度或提交/呈现条件使首绘晚约一秒**。需要把目标frame/layerTree/sourceFrame与BeginMainFrame、commit、activate、submit/presentation、scheduler状态及抑制原因绑定；仅附近事件、全renderer DroppedFrame计数或“没有长JS任务”不足以完成归因。

root已登记的下一步是显式TEST `compositor-diagnostic` profile，在默认Lighthouse类别后只追加 `cc`、`disabled-by-default-cc.debug`、`renderer.scheduler`、`disabled-by-default-renderer.scheduler`、`blink`、`viz`，同当前生产代码固定三次取证。方案可继续，但须满足：

- 默认profile逐字保持，诊断profile与输出明确标识，完整原始文件先保留，所有三次成功/失败均记录；不补采最好结果。
- Chrome参数、页面内容、图像质量/TTL、字体覆盖、网络/CPU模拟参数与原metric算法不改；仅追加观察类别。
- 类别增加会改变观察开销，新增三次不与默认profile样本作为性能前后改善比较，也不计正式性能验收通过。
- 检查新增类别实际产生哪些可关联字段；若仍无具体抑制原因，结论继续保留未定位，不凭未复现认定已修复。

本次测量审计没有阻止该有界取证的发现；不授权生产修复、浏览器设置调整或性能门升级。待工具diff与新原始trace后再独立复核根因主张。
