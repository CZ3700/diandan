# 固定 12 次 compositor 复现：1 次长等待，持续 pending ACK 解释不成立

**G1-1 复现了 975.560 ms 激活后等待；已记录的 pending 帧在该等待开始前就收到 ACK，而 BeginFrame 需求持续开启、目标 renderer 却约 1 秒没有实际 BeginImplFrame 交付记录。** 这排除了本次“持续等待 pending-submit ACK 导致无法提交”的解释，进一步缩小到 BeginFrame 发放/传递路径。Viz 中存在 `ThrottleUndrawnFrames` 拒发记录，但事件缺少目标 sink 标识，尚不能将该机制确认为本导航根因。没有实施或证明修复。

输入是 `run-2026-09-17T16-33-58-576Z/compositor-group-{1..4}/gift-render-trace` 的固定 4×3 次，全部保留。附属 `trace-audit.compact.json` 逐个验证 60 个 LHR/Trace/Devtools/artifacts/config 文件的 SHA 与字节数，均匹配原 capture manifest；12 份 LHR settings 与各自 config 一致，且跨 12 次完全一致。非作者审核校验全部108原件/内容/读取，root执行官方指标重放，属于另一层证据。

## 全量扫描与异常定位

以每次请求 URL 对应的主 frame/navigationStart 为唯一时间基准；使用 PID/TID、local ID、**单次 reporter 起止范围**、sequence 关联。local ID 会复用，同一次呈现也可以关联两个非 FORKED reporter，因此完整保留关联集合，未强迫一对一。扫描截至最终 LCP 所有目标 renderer 的激活后→提交阶段，共 **64 条**，其中 **23 条所在 reporter 有显式 Activation 阶段**；其余合成/FORKED/丢弃状态保留区分。开始于 LCP 前但结束在其后的阶段也完整保留并标记，不截断计时。

| 组/次 | 实际 FCP（ms） | 实际 LCP（ms） | 扫描阶段数 | 最大完整激活后→提交（ms） |
| --- | ---: | ---: | ---: | ---: |
| 1/1 | 1354.144 | 1367.335 | 12 | **975.560** |
| 1/2 | 264.561 | 264.561 | 3 | 11.072 |
| 1/3 | 309.271 | 309.271 | 3 | 10.316 |
| 2/1 | 329.615 | 329.615 | 8 | 8.375 |
| 2/2 | 399.061 | 399.061 | 9 | 0.275 |
| 2/3 | 300.267 | 300.267 | 3 | 13.010 |
| 3/1 | 259.817 | 259.817 | 3 | 9.313 |
| 3/2 | 274.474 | 274.474 | 4 | 4.219 |
| 3/3 | 271.261 | 271.261 | 3 | 10.726 |
| 4/1 | 264.009 | 264.009 | 3 | 17.696 |
| 4/2 | 348.652 | 348.652 | 7 | 4.847 |
| 4/3 | 345.656 | 345.656 | 6 | 5.870 |

这不是发生率估计；仅说明固定12次中1次出现>500ms对应阶段。模拟 FCP/LCP单独存于JSON，不与实际时间互换，额外追踪样本不替代原默认profile性能门。

## G1-1 的同导航因果边界

绑定：renderer **52158** / compositor **80131700**；navigationStart **5103530571735μs**；frame `BE0F617B15C568680F284A76DE62809E`。长等待 reporter 是 **local0x92 / sequence103 / STATE_PRESENTED_ALL**：

- Activation **373.187→373.422ms**；EndActivateToSubmit **373.422→1348.982ms（975.560ms）**。
- Submit→Presentation **1348.982→1354.144ms（5.162ms）**，结束精确匹配首次文本FCP（H1 node30）。
- 图片网络545.940ms已完成，目标node27首次PaintImage1351.532ms，后续图片LCP1367.335ms。
- 后续image呈现同时关联sequence164/local0xd与sequence165/local0x7f，前者激活后等待仅12.896ms。**只看末个LCP帧会漏掉此次真正的早期长等待。**

**pending/ACK：**最后一笔等待前的pending区间为346.394→346.449ms，结束位于同compositor的ACK346.448→346.449ms调用内；下一笔直到1349.036ms才开始。长等待区间内，没有已记录pending区间占用。这只否定该次“持续pending门”解释，不等价于排除所有浏览器调度原因。

**实际BeginFrame交付和需求：**Scheduler::BeginImplFrame为331.708ms(sequence103)后直接到1348.571ms(sequence164)，间隔1016.863ms。两端的renderer ExternalBeginFrameSource::OnBeginFrame也同样出现空档，故不能仅归结为已收到BeginFrame但renderer内部不执行。needsBeginFrame在216.386ms置1，截至LCP没有置0；独立NeedsBeginFrames span从216.377持续至1698.402ms。58个DroppedFrame（106–163）对应BACKFILL，仅作补记，不冒充实际逐帧回调。已启用类别中没有单个>100ms的X任务覆盖长等待；不将事件缺失推广为全部CPU空闲。

## 跨进程已绑定的链与剩余缺口

原始 `Graphics.Pipeline` 的显式flow可跨进程关联：

| Flow ID | 起点 | 终点 |
| --- | --- | --- |
| 458 | Viz52152/80131710发BeginFrame331.657 | 目标renderer接收331.695，sequence103 |
| 479 | 目标renderer提交346.370 | Viz接收346.417，**FrameSink(8,7)** |
| 1047 | Viz发BeginFrame1348.495 | 目标renderer接收1348.554，sequence164 |
| 1055 | 目标renderer提交1348.982 | Viz接收1349.056，**同FrameSink(8,7)** |

Viz在长等待期间仍有ExternalBeginFrameSource/DisplayScheduler活动；窗口内SendBeginFrameDecision计数为ThrottleUndrawnFrames=116、SendFrameTiming=29、SendDefault=13。**这些decision只有reason/should_send，没有frame_sink_id。** 同线程处理多个sink，不能把116条全部或任意邻近false记录直接认作FrameSink(8,7)。某些巨大surface_frame_trace_id已经在原始JSON中损失精度，不能用它们恢复唯一关联；上述小整数显式flow边是单独可验证证据。

参考Chromium源码说明ThrottleUndrawnFrames与pending ACK属于不同条件分支（见独立审核报告）；源码版本与当前Chrome精确build的绑定也必须单列。到此能确认“持续pending ACK占用”不是本次解释，且需求仍开启时目标renderer的BeginFrame交付发生长空档；**为何该sink未获交付仍未完全证明**。不根据约1秒时长直接认定计时器或节流根因，不调整Chrome特性、应用动画、图片或字体来掩盖它。

## 验证与下一步边界

一次性离线命令：`python3 output/checks/p3-06-compositor-repro/extract-trace.py`，最终exit0，12次/60输入绑定/64阶段/1异常。初次两次提取停止于“最终呈现只能有一个原始reporter”的错误假设，未写结果；检查原trace确认有效的双reporter关联后保留全部关联，仅要求同compositor绑定一致，最终成功。该工具只用于本组固定原件，不是新通用采集框架。

所有12次原样本有效，原48默认与上轮3扩展证据继续保留。固定上限已达到，本轮停止补采。后续若确需确证Viz具体分支，应先解决decision到目标sink的直接标识与当前Chrome源码版本绑定，再设计有界实验；当前证据不支持生产代码修复或性能门关闭。本分析子任务未运行测试、服务、Chrome、构建，未修改生产/既有工具源码或旧证据。
