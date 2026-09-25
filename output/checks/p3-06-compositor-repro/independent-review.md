# P3-06 固定十二次compositor复现：独立评审

范围：基线`a01cefe`的本轮一次性编排及有限取证结论。按phase登记只读源码/原始证据，仅写本报告；未运行Chrome、服务、构建、测试或官方重放。生产代码和既有profile/helper不在本轮修改范围。

## 编排预审（采集前快照）

已完整阅读本轮 `run-diagnostic.mjs`、`plan.md` 和原 `verifyGiftTraceComparison` / `collectGiftTraceAttempts` / fixture资源清理路径。预审时runner SHA为`5ea477d35d4bc95e0824e52f4344265b7158586eb6d78528827be39fd8f00074`；原helper及其测试相对当前HEAD无diff。**编排无阻断发现，可以执行登记的固定四组；当前不提前接受尚未完成的实测。**

- 外层只启动一个真实PG/TLS S3/worker/Next fixture；单callback中顺序`await`四组，原helper每组固定三次，不并行Chrome。保存最初next generation并在每组调用前验证，runner没有重建或变更生产源码的操作。
- 四组输出为fixture根下的`compositor-group-1`至`-4`，与`browser-attempt-1`同层，既有helper的`path.dirname(output)/next-runtime-<generation>.log`因此仍正确。不将分组目录误嵌到browser-attempt内部，不覆盖旧fixture路径。
- 每组复用原helper，公开API证明一次、独立owned Chrome及临时profile一次、三次Lighthouse顺序导航。显式`mode:"candidate"`继续表示0+1内容读取，`traceProfile:"compositor-diagnostic"`表示已有六追加类别；未改Chrome参数、原预算、主图、字体或内容，也没有额外预热或优选补采。
- 组开始前写RUNNING条目；正常返回保留原组状态及实际attempt数。组调用抛错时记录安全错误并继续剩余预定组，末端才AggregateError。组内已有逻辑先写九份原始证据再校验，保留失败后完成其三次固定尝试。最外层COLLECTED_DIAGNOSTIC仅表示组调用完成，不把其中COLLECTED_DIAGNOSTIC_BUDGET_FAILED升级为预算通过。
- 每组Chrome句柄由原helper的try/finally调用`await chrome.kill()`释放。fixture为`serve:false`，成功或异常都经`withAcceptanceResources`对已登记owned资源逆序清理，一项关闭失败不会跳过其他资源；外层PG/S3仍走原harness。最终应查实际exit/端口证据，而非仅靠存在finally宣称无残留。
- 四组×三次是预定采样上限。若Chrome启动、I/O或fixture前置失败，原始结果可能少于12；最终汇总应按实到条目计数并保留组FAIL，不能用fixedNavigations字段冒称已成功采满。磁盘写入失败不应继续制造无法保留的“有效”结果。

## 根因复核标准与结果边界

旧异常已定位到同一个内容frame的激活后、提交前983.518ms，触发根因仍UNKNOWN。有限结果应围绕这个阶段检验pending/ACK竞争假设：

1. 每份报告绑定同导航URL/公开内容、主frame/navigationId、renderer/compositor、reporter local ID及起止范围、frame sequence。首次文本FCP与最终image LCP分别处理，不能用FORKED partial reporter或同URL另一图片节点替代目标内容帧。
2. 若复现长激活后等待，核该区间真实pending计数、对应ACK、实际BeginImplFrame收发和needsBeginFrame变化。BACKFILL DroppedFrame不是已执行帧回调；仅事件名或与恢复相邻不能证明ACK阻塞。
3. 若慢区间pending已清零、提交限制未启用且真实BeginFrame正常交付，pending/ACK解释将被削弱或否定；若只有时间重合而缺少关联状态，仍保留竞争解释。若12次都无异常，这只能表示本轮有限样本未复现，不能证明任一假设为假或问题已修复。
4. 四组共用服务/图片缓存但各自Chrome进程不同，组间顺序与MISS/STALE/HIT等实况应明示，不能当作等价冷启动或从总LCP差额推导编码/CPU根因。扩展类别有观察开销，不与原48份默认条件报告当作性能前后收益，也不代替正式63次矩阵/RUM。

此处保留采集前标准；最终实际验收与S.U.P.E.R结果见末节。性能、人工和商户门继续OPEN。

## 固定四组实际采集完整性复核

实际根目录为 `output/checks/p3-06-storefront-acceptance/run-2026-09-17T16-33-58-576Z/`。已独立对四组capture清单所列 **108个原始文件逐一重算长度/SHA，全部匹配**。四组各三个attempt完整保留，没有failure或Lighthouse runtimeError；同导航内容检查12/12有效。逐份原生日志按capture.afterSequence切窗，均只含一个成功STOREFRONT_GIFT请求，无GIFT_CONTENT请求（0+1），与报告读取计数一致。

十二次LHR/settings与各自config中的LHR/artifact settings完全相等，六追加类别及compositor-diagnostic标记一致；显式launchOptions也一致。组内Chrome端口保持，四组分别51935 / 52000 / 52051 / 52099，外层buildGeneration为1。四次组前完整公开API响应SHA均为`4c4955744b8ef1e7fb7809bc24cabb2e6c3c35613ab73caf43b061b85c126f8a`，十二份MainDocumentContent的SHA也相同。组前响应相同仍不是每次导航不可变版本的独立证明；此处没有扩大该证据范围。

| 组 | 实到样本 | 模拟LCP中位数 | 原预算状态 |
| --- | ---: | ---: | --- |
| 1 | 3 | 2572.0995ms | FAILED |
| 2 | 3 | 2629.8720ms | FAILED |
| 3 | 3 | 4061.5365ms | FAILED |
| 4 | 3 | 2629.1330ms | FAILED |

以上中位数已从各自三份原LHR独立重算。外层COLLECTED_DIAGNOSTIC表示预定四组执行完成，**四组原LCP预算均未通过**。G1-1原LHR记录observed FCP/LCP约1354/1367ms；现已通过下述原始pipeline复核确认同类激活后等待，结论不只依赖该数值。

fixture-result和原日志确认402.135秒exit0、真实协议32,461断言及四组三次导航回调完成。source-binding沿用前检查点2,229输入/聚合SHA`b9d3fb5b842c6a6ac028018a0063e3bd0fcfa45fa30553e776b6c83342f9cf7c`，runner SHA与预审一致。最终保护、cleanup及官方复算复核见末节；本轮不再追加采样。


## 异常原件交叉检查与结论边界

已读取 `trace-audit.md` / `trace-audit.compact.json`，并独立解析G1-1原始43MB Trace，按原事件索引复核PID **52158**、compositor TID **80131700**、local **0x92**、sequence **103**的单次reporter范围及每个阶段：Activation **373.187→373.422ms**；EndActivateToSubmit **373.422→1348.982ms = 975.560ms**；随后Submit→Presentation **5.162ms**，结束精确对齐首次**文本FCP1354.144ms**。最终主图LCP为**1367.335ms**，属于后续呈现；不能把长reporter说成最终LCP图片帧。

为避免精简器只选择导航后开始的pending区间产生盲区，我另对原trace同PID/TID的**全时段** `Scheduler:pending_submit_frames` b/e按local ID配对：全部闭合，没有区间跨越373.422→1348.982ms。最后一笔346.394→346.449ms的结束落在ACK346.448→346.449ms调用内；下一笔1349.036ms才开始。这足以反驳**本次renderer被前一帧持续待ACK占用**的解释，不能泛化为所有ACK、所有运行或所有浏览器调度问题均已排除。

同一原trace中，实际 `Scheduler::BeginImplFrame` 从331.708ms/seq103跳至1348.571ms/seq164。needsBeginFrame于216.386ms置1，跨等待无置0；独立NeedsBeginFrames span也覆盖整个等待。58条BACKFILL DroppedFrame不当作实际逐帧交付。显式小整数Graphics.Pipeline flow 458/1047确认前后Viz发放到目标renderer接收，479/1055确认前后提交到同FrameSink(8,7)；这些是链路边界证据，尚不标识中间每个拒发decision所属sink。

原件长等待窗口里的116条 `ThrottleUndrawnFrames`，载荷实际仅有reason/should_send，不能归因于目标sink。作为**参考实现**，Chromium固定commit `19e070e3b1996c305ecd4c689541fcd369c6f762` 的该分支综合“距上次发帧不足1秒、未绘制帧超过阈值、活动帧允许节流”，并与ACK相关分支分开；相同源码也只为decision写reason/boolean。此commit未与本机Chrome **152.0.7977.84**二进制建立版本绑定，因此不把这些条件宣称为本次执行分支，也不因接近1秒就判定触发原因。[Chromium参考源码](https://chromium.googlesource.com/chromium/src/+/19e070e3b1996c305ecd4c689541fcd369c6f762/components/viz/service/frame_sinks/compositor_frame_sink_support.cc)

精简器保留十二份全部64条相关阶段、23条含显式Activation、FORKED/非FORKED及LCP后结束标记，没有按最终LCP单帧筛去早期长等待。所述“其余十一份未见>500ms”限于已启用类别、目标renderer与导航至最终LCP的扫描窗口，不是发生率估计或系统无异常证明。**认可诊断结论：复现同类等待，排除本次持续pending占用，缩窄至需求开启时BeginFrame发放/交付的长空档；触发根因UNKNOWN，未修复。**

## 末端证据与S.U.P.E.R

- 四份官方重放results共12报告、24个FCP/LCP比较，全部差0；`performanceAcceptance:false`保持。首个离线重放因输出父目录不存在而ENOENT退出的log/result完整保留，之后只修正输出目录并离线重放；没有重采导航。
- `affected.log`及result确认采集/重放相关25/25通过；`check-dev-result.json` exit0 / 15.854秒，原log类型62、测试62、构建36均全缓存，不能描述为冷跑。本轮真实fixture实际构建/协议32,461断言及12次导航是另行证据。
- adapter / build-artifacts分别exit0 / 3.691秒、0.564秒。`protection.json`确认4,479个原未跟踪文件逐SHA未变、2,229个采集输入未变、生产应用无修改。
- `cleanup.json`实际记录的Next端口50948和四个Chrome端口51935/52000/52051/52099均无LISTEN；fixture正常退出0，未对旧PID操作。此结论限于已登记owned资源与端口，不宣称扫描过系统一切进程。
- 只读核对README、capture-summary、source-binding及相关logs，与上述范围一致；没有扩大到七语言双端UI、完整 `pnpm check`、RUM或正式63次性能矩阵。秘密扫描待root最终暂存后补入结果。

| # | 检查 | 本轮结论 |
| --- | --- | --- |
| 1 | 单一文件职责 | PASS：runner只编排固定复现，分析器只读取既定原件，报告只记证据。 |
| 2 | 单一函数概念 | PASS：采集编排、资源入口和离线提取各自有界；不为了少行混入应用逻辑。 |
| 3 | 单向数据流 | PASS：fixture→原helper→原始产物→离线分析；未反向写业务内容。 |
| 4 | 无循环依赖 | PASS：一次性入口只动态调用既有工具，生产无反向导入。 |
| 5 | 显式接口 | PASS：沿用既有context/profile契约，结果schemaVersion=1和状态范围明确。 |
| 6 | 可序列化I/O | PASS：证据为JSON/文本及既有原始artifact；失败只序列化安全错误字段。 |
| 7 | 环境与配置 | PASS（诊断范围）：URL/端口/fixture资源来自context，原配置未改；固定4×3、TEST开关和分析原件路径是登记实验边界，不进入生产。 |
| 8 | 依赖声明 | PASS：无新依赖或锁文件变更，沿用仓库已固定运行时。 |
| 9 | 可替换部件 | PASS：一次性编排可独立移除，原helper/profile/应用不受影响。 |
| 10 | 验证通过 | PASS（本轮工具与诊断范围）：25相关测试、check:dev、真实fixture、官方重放与边界检查通过；预算失败单独保留。 |

**独立结论：本轮固定复现和诊断证据范围局部ACCEPT，无阻断代码/取证发现。**最终秘密扫描门仍待root补齐；P3-06整体、正式性能/人工/商户门保持OPEN，任务计数不增加。48份默认profile历史诊断、上轮3份扩展和本轮12份扩展分别标注，不把合计63份异质诊断报告当成正式63次矩阵完成。

### root最终补记

显式暂存后 `pnpm security:secrets` exit0，47.165秒，结果见 `secrets-result.json`；既有ignore下的原始log只在本机保留，没有force-add。离线提取复跑除生成时间外与原精简证据完全相同（`extraction-verification.json`）；本补记不改变非作者对性能/根因/阶段门的保留结论。
