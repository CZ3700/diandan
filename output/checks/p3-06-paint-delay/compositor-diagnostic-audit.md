# 固定三次扩展 compositor trace：观测有效，异常未复现

**三次均未出现原来的约 1 秒激活后等待；新 trace 确实拿到了 pending/ACK 和实际 BeginImplFrame 事件，但无法由“本轮 0 异常”推导原问题已修复。** 没有生产修复变更，本组仅为扩展观测诊断，额外 trace 开销与原样本不同，不能替换原性能数据或关闭门禁。

输入：`run-2026-09-17T12-38-57-411Z/browser-attempt-1/gift-render-trace` 三次固定尝试。附属 `compositor-diagnostic-audit.compact.json` 含 15 个原始 LHR/Trace/Devtools/artifacts/config 文件的 SHA/bytes，全部与原 capture manifest 一致；保留每次主 frame/navigation/PID/TID、原始帧与 FORKED 关联、pending 区间和同线程 ACK 对应。所有下表使用 trace navigationStart 同一时钟。

| 实际事件（ms） | 第 1 次 | 第 2 次 | 第 3 次 |
| --- | ---: | ---: | ---: |
| FCP | 408.826 | 433.427 | 371.471 |
| 最终 image LCP | 628.637 | 433.427 | 371.471 |
| 主图网络完成 | 626.436 | 393.751 | 338.405 |
| 主图首次 PaintImage（node26） | 627.065 | 422.676 | 364.876 |
| 最终 LCP 原始 frame_sequence / local | 112 / 0xd | 535 / 0x7f | 991 / 0x7e |
| Activation 结束 | 627.588 | 429.232 | 369.667 |
| **激活后→提交前** | **0.225** | **0.389** | **0.341** |
| 提交→呈现 | 0.824 | 3.806 | 1.463 |
| 对应呈现结束 | 628.637 | 433.427 | 371.471 |

每次选中 `STATE_PRESENTED_ALL` 的原始 reporter，按 PID/TID/local ID/起止/sequence 关联，其 presentation 结束精确等于实际 LCP；没有拿 FORKED partial reporter 代替原始链。第 1 次先出现 H1 text candidate（node29）并形成 FCP408.826，后图片成为最终 LCP628.637；它的首次文本帧 sequence98/local0x8e 激活后等待0.250ms、提交后呈现3.161ms，**首帧和最终图像帧分开保留**。其余两次 FCP 与 image LCP 重合。模拟 FCP/LCP另存 JSON，不与实际时间互换。

新增观测能力已得到正证据：同 renderer compositor 在导航至 LCP 窗口内分别记录 **16/11/7 个真正 `Scheduler::BeginImplFrame`**，带 sequence、NORMAL/MISSED、frames_throttled_since_last；不是从 BACKFILL 推算。该窗口开始的 `Scheduler:pending_submit_frames` 完整区间分别14/11/7条，最长 **19.073/17.407/17.546ms**，begin记录的pending_frames均为1。全部区间结束都落在同一 compositor 的 `ProxyImpl::DidReceiveCompositorFrameAckOnImplThread` 调用内部；第2次末区间结束在LCP之后，JSON显式标记，未截断它。三次该窗口内 DroppedFrame 均为0。

`TriggerDeadlineDueToThrottling` 在三次正常导航中也存在，事件名本身不能当作异常证据。第1次有162.477ms的实际BeginImplFrame间隔，但此前已FCP：480.859ms明确 `needsBeginFrame=0`，626.647ms恢复1、626.700ms启动MISSED帧，随后快速呈现图片。这说明单看两BeginFrame之间的空档也不足以认定阻塞；需结合需求状态与内容帧链。

本次能证明新增类别提供了下一次异常所需的重要字段；未提供旧慢样本不存在的ACK/调度原因，也未捕获完整SchedulerStateMachine状态快照。原假设（已激活内容因待帧/BeginFrame调度状态迟迟无法提交）仍待在**实际异常同一导航**检验。优先保留当前固定、可开关诊断入口，在后续本来需要的受控采样中复用；不追加无限重跑，不停用Chrome特性或降低阈值。原慢样本983.518ms阶段定位仍成立，根因UNKNOWN，正式性能门OPEN。

本报告只解析原JSON、校验SHA、写两个新产物；没有额外服务、Chrome、构建或测试运行，也未改工具/生产源码和旧证据。
