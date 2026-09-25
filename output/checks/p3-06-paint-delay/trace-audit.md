# 首次呈现等待：同代码慢、快 trace 对照

**已定位阶段，根因仍 UNKNOWN：慢样本主要等待发生在 compositor 激活结束之后、提交 frame 之前，共 983.518 ms；快样本仅 0.173 ms。** 现有证据不支持把这段等待归给图片编码、CSS/字体下载或长 JS，也不足以调整生产配置。

输入为 `run-2026-09-17T08-41-18-090Z/browser-attempt-1/gift-render-trace` 的原 sample 2 / 3。`trace-audit.compact.json` 保留两次各 5 个输入的 SHA/字节数，与原 capture manifest **10/10 校验一致**；包含导航/进程标识、网络、阶段、RAF、绘制和丢帧摘要。下列均使用 trace navigationStart 同一时钟，未混用 LHR network audit 零点。

| 实际事件（ms） | 慢 sample 2 | 快 sample 3 |
| --- | ---: | ---: |
| 图片网络完成 | 528.146 | 274.438 |
| node 8 首次 PaintImage | 600.411 | 308.613 |
| Commit | 601.925→602.017 | 309.428→309.476 |
| Activation | 610.369→610.490 | 314.388→314.419 |
| **EndActivateToSubmitCompositorFrame** | **610.490→1594.008（983.518）** | **314.419→314.592（0.173）** |
| Submit→Presentation | 1594.008→1597.291（3.283） | 314.592→316.253（1.661） |
| **实际 FP/FCP/LCP** | **1597.291** | **316.253** |
| 模拟 FCP/LCP，单列非实际 | 4986.192/5586.192 | 3463.824/4363.824 |

关联键是 **PID/TID + id2.local + 单次 PipelineReporter 范围 + frame_sequence**。慢选 renderer86626/compositor79521807/local0x40/sequence530，快选86662/79522334/local0x3b/sequence939，均 `STATE_PRESENTED_ALL`，末段结束精确等于实际FP/FCP/LCP。没有拿全局邻近 Raster 代替目标图证据，也没误选快样本较晚的frame940。PaintImage 仅说明绘制记录，不能当作已呈现。慢样本第二次 node8 PaintImage1594.351还晚于第一次内容帧提交1594.008，不能直接称重绘触发首次提交。

慢样本此前 local0x41/sequence531 在591.268提交，直到1594.295结束（1003.027ms），最终 **STATE_DROPPED**，只有SubmitToReceive，没有Draw/Swap段。这支持检查 pending frame / BeginFrame / Viz backpressure，但**没有ACK原因，不能认定ACK阻塞**。59个DroppedFrame（533–591、608.940→1575.568）匹配的reporter均为BACKFILL；不能把约16ms间隔当作实际回调已交付。快样本没有此链。BACKFILL/FORKED分类依据[Chromium官方schema](https://chromium.googlesource.com/chromium/src/base/+/c505b1aab61c4a0e444a2aefe7b98dcf6026ebda/tracing/protos/chrome_track_event.proto)，不声称该源码对应本地Chrome精确版本。

慢样本记录的最长main RunTask41.537ms，接着31.487ms，未见覆盖约1秒窗口的X长任务；未启用事件仍可能缺失，不能宣称CPU空闲。`$RV`请求RAF1237.147→执行1593.830（356.683ms），快样本792.414→803.362（10.948ms）：与恢复时间相符，但因果方向未知。root审阅原filmstrip530.914白屏、1606.575首屏，与呈现时间吻合；并非连续可见性证据。页面/SSR边界另见`page-audit.md`。

**优先可证伪假设**：compositor/Viz的待帧或BeginFrame调度状态，在内容帧激活后仍阻止提交。最小追加是固定少量导航，仅增加cc scheduler、pending_submit_frames、ACK和实际BeginFrame收发的观测，保持Chrome特性/flags/阈值与页面不变。源码中的[Scheduler:pending_submit_frames](https://chromium.googlesource.com/chromium/src/+/master/cc/scheduler/scheduler_state_machine.cc)仅用于选择观测字段；若慢区间pending已清零、提交限制未启用且BeginFrame正常交付，则该假设不成立。visibility等竞争解释仍保留。扩展trace单列非正式诊断，全部固定尝试保留。

仅离线JSON解析与SHA校验；未启动服务/浏览器/构建/测试，未改生产或旧证据。一次性初版提取因reporter结束同刻的后续LatchToSwapEnd停止且未写输出；按严格半开范围修正后成功。所有原样本继续有效，性能门保持OPEN。
