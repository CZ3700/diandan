# P3-06 调度证据的可观测性边界

2026-09-21，`/root/scheduler_audit`；只读审计旧原件与官方源码，未启动 Chrome、服务、构建、测试或新性能采样。当前任务仍由 root 独占 Lane D。本报告没有生产修改，也没有新增性能通过结论。

## 结论

**旧 G1-1 原件仍不能把慢窗内任一 `ThrottleUndrawnFrames` 唯一绑定到 FrameSink(8,7)。**本轮补齐了该采样报告的版本号到官方 Chromium tag 源码的对应，并确认缺少 sink 不是漏开既有追踪类别：此版本的相关事件本身没有写入该字段。重复同配置采样不能弥补这个结构性缺口。

旧报告已经证明的 975.560ms 激活后等待、renderer pending 在等待前归零、BeginImplFrame 约 1017ms 无交付，本轮不重复计作新进展。异常触发原因继续 UNKNOWN；另十一份没有该长等待仍未整体达到模拟 LCP 预算，应用资源路径和这条异常应分别处理。

## 本轮新增版本绑定

输入根为 `output/checks/p3-06-storefront-acceptance/run-2026-09-17T16-33-58-576Z/compositor-group-1/gift-render-trace/`。

- `zh-CN-gift-mobile-1-artifacts.json` 的 `HostProduct` 为 `Chrome/152.0.7977.84`。同份 LHR 的 HostUserAgent 只保留 `152.0.0.0`，不能从 UA 反推 patch。
- 官方 `refs/tags/152.0.7977.84` JSON 返回 commit `4334922f44c77b1208072c4deac29db3af39bbea`；该 commit 的 `chrome/VERSION` 为 152 / 0 / 7977 / 84。
- 官方源码通过 Gitiles `?format=TEXT` 读取并在内存 base64 解码，没有向仓库下载源码。网页版 open 不可读后采用此只读入口。
- 这是 **artifact 声明版本 → 对应官方 tag** 的绑定；旧 capture 没有 `Browser.getVersion.revision`、二进制 SHA 或构建证明，不能升级为二进制精确来源证明，也不能倒用现在机器上的 Chrome 版本补证旧采样。

[官方 tag 引用](https://chromium.googlesource.com/chromium/src/+refs/tags/152.0.7977.84?format=JSON)、[版本提交](https://chromium.googlesource.com/chromium/src/+/4334922f44c77b1208072c4deac29db3af39bbea)、[VERSION](https://chromium.googlesource.com/chromium/src/+/4334922f44c77b1208072c4deac29db3af39bbea/chrome/VERSION)。

| 本轮只读对象 | 字节数 / SHA256 |
| --- | --- |
| G1-1 trace 原件 | 43,053,148 / `894840ca1992f7ed6d67a311692df00acd4c579f7ba1f03c60dbdb3eab0ba723` |
| G1-1 artifacts 原件 | 47,797,709 / `cb7ca69539fae7ed8a1b53ffdb6e7e515200654f96a211f6c0832b39cf0f04b6` |
| 官方 VERSION 解码文本 | `2553cda95fed9480d6b64cc2ed5a530b11bc8459e550892d47bde4b36c2f08d0` |
| 官方 compositor_frame_sink_support.cc 解码文本 | `c34f9889ac4151c7129f1646836a456cd6d3f3b05df6e22082b0a4832d738034` |

## 为什么现有关联不足

本轮对 G1-1 原 trace 独立解析。主导航基准 `5103530571735µs`；Viz PID/TID `52152/80131710`；慢窗 `[373.422, 1348.982]ms`。

1. 窗内共有 158 条 decision：116 `ThrottleUndrawnFrames`、29 `SendFrameTiming`、13 `SendDefault`。158 条 args 键都精确只有 `reason` 与 `should_send`。
2. 第一个窗内拒发为原 `traceEvents[11316]`，时间 380.599ms。它被 `traceEvents[11315]` 的 `STEP_ISSUE_BEGIN_FRAME` 作用域包含；外层载荷只有 trace ID / task 时间，无 sink ID / observer 身份。该数值型 trace ID 的精度在原 JSON 中已受损，但即使完整恢复它，拒发路径仍没有下游 renderer edge 可帮助确定目标。
3. 前边界 flow 458 出现在 331.657ms 的 scope 内，scope 内 decision 是 `SendFrameTiming`，终点是目标 renderer。后边界 flow 1047 的 1348.495ms scope 同样嵌套 `SendFrameTiming`。这两条允许直接绑定成功发放的 decision；不能把中间没有显式 flow 的 false decision 沿线程/相邻位置继承为同一 sink。
4. 同 Viz 线程确实处理其他 sink；窗内存在 FrameSink(0,1) 的 receive / activate / did-not-produce 事件。`SurfaceAggregator::EmitDefaultBackgroundColorQuad` 虽含目标 FrameSink(8,7)，记录的是聚合时的 surface range，不是此前 `ShouldSendBeginFrame` 的接收者。

对应官方 tag 源码的 `RecordShouldSendBeginFrame`（77–80 行）只写 reason/boolean。`OnBeginFrame`（1139–1150 行）外层只写 global trace ID 和步骤；`ShouldSendBeginFrame` 在 1167–1170 行被调用，只有返回 true 后才沿 1187–1207 行向客户端发送并更新 last-frame 时间。false 分支不会创建可用于追到目标 renderer 的成功发送边。参见[对应版本实现](https://chromium.googlesource.com/chromium/src/+/4334922f44c77b1208072c4deac29db3af39bbea/components/viz/service/frame_sinks/compositor_frame_sink_support.cc)。

该版本的 `ThrottleUndrawnFrames` 判断确实组合未绘制帧数、上次发帧间隔与 active-frame metadata；它与 `PendingAck` 分支不同。由于未捕获目标 sink 的这些输入，**约一秒时长与源代码条件相似仍只能构成假设**。旧参考 commit 的代码不能替代这里的版本绑定，当前源码也不能替代缺失的运行时状态。

## 有界、能区分假设的下一实验

如果后续必须给这条浏览器异常定因，最低充分观测是 **带直接 sink 身份的 decision**；不建议继续原四组十二次随机补采。

1. 先准备与采样版本明确绑定的诊断 Chromium，唯一源码差异为 trace 增补：在 OnBeginFrame 外层写 `frame_sink_id`、begin-frame source / sequence 和 observer 身份；在 decision 处写同一 sink、`frame_time`、`last_frame_time`、active/last-drawn frame index、`may_throttle_if_undrawn_frames`、pending 计数和需求状态。保留原分支、返回值、调度、Chrome flags 与页面代码；只观测，不关闭节流。
2. 记录 `Browser.getVersion` 完整结果、实际浏览器二进制 SHA、源码 commit 与诊断补丁 SHA；沿用同真实 fixture 和内容校验。固定最多三个导航，不额外预热或挑选重采。保留原始 Perfetto 二进制或无损整数表示，避免 trace ID 舍入。
3. 若复现，按目标导航 renderer → submit flow → sink 绑定，再直接查询该 sink 的慢窗 decisions。若每次返回 `ThrottleUndrawnFrames` 且记录的输入满足条件，才能将“这个 sink 被该分支拒发”从假设提升为证据；若没有该 sink 的拒发，转向其 BeginFrameSource 观察者/发放链。没有复现只能写有限样本未复现，不能写根因排除或修复。
4. 诊断编译及追踪有观测开销，其 LCP 不计产品预算。即使确证了拒发分支，也仍需查明为何产生未绘制帧/表面不可达，不能直接将责任归于应用或 OS。

以上是调查设计，**本轮未构建或运行诊断浏览器**。这项工作的成本显著高于继续应用资源优化；建议当前 P3-06 检查点先处理已识别的正常导航关键路径，把旧异常准确留作未决项。若后续顺带采样现有 Chrome，可在启动后只读保存 `Browser.getVersion` 与实际 launch 参数以改善未来版本证明；这仍不能补出旧 decision 所缺的 sink。

## 审计范围

本轮只新增本报告；未触碰旧 evidence、源码、依赖、性能阈值、图片质量、字体覆盖或浏览器行为。没有全量重新核验 108 原件，只重算上表两个输入并读取必要原事件、原 README / trace-audit / independent-review 与对应版本官方源码。不将只读推断当作新测试、性能收益、P3-06 DONE 或生产验收。
