# P3-06 首次绘制等待定位

本轮从 `a560ac7` 接续；生产应用源码保持不变。P3-06 仍 IN_PROGRESS，正式性能验收未通过；任务计数27 DONE / 2 IN_PROGRESS / 20 PENDING，Phase5 LOCKED。只作本地检查点，不push/merge/部署。

## 已证实的等待位置

前次同一构建、相同HTML/CSS/Chrome配置的慢2与快3样本，在目标renderer、layer tree、frame sequence与同一个PipelineReporter内比较：

| 环节 | 慢2 | 快3 |
| --- | ---: | ---: |
| 图片网络结束至官方LCP | 1069.145ms | 41.815ms |
| 激活完成至提交compositor frame | 983.518ms | 0.173ms |
| 提交至呈现 | 3.283ms | 1.661ms |

慢样本已完成主图/页面首轮绘制，CSS、脚本、字体网络没有持续等待至首绘，也没有覆盖这段时间的长JS任务。主图不在隐藏的流式边界内；相同页面的快样本在尾部数据到齐之前已经显示。由此可排除具体的应用隐藏/等待全页流式完成假设，尚不能把浏览器提交等待的触发原因指定为产品代码、浏览器缺陷或测量开销。

59个DroppedFrame为BACKFILL，不代表原线程真的每16ms执行过一次帧回调。600ms的PaintImage也不等于已向用户显示。详情见 `trace-audit.md`、`page-audit.md`、`measurement-audit.md`。

## 本轮工具修改

只修改TEST采集器及其测试：`traceProfile` 默认 `standard`，显式 `compositor-diagnostic` 才追加六类浏览器调度追踪。标准Lighthouse输入逐结构不变；原Chrome参数、内容、图片质量/TTL、语言字形、预算均保持。未知profile在运行前拒绝。诊断样本必须由LHR与artifacts的实际settings共同确认追踪类别；失败也先保存全部原始文件，三次固定样本均保留。

新增追踪有额外开销，诊断profile不得与原默认trace比较并宣称提速，也不算正式性能验收。

## 复跑与证据

从仓库根目录执行：

```sh
mise exec node@24.20.0 -- node --test apps/api/scripts/storefront-gift-trace-verification.test.mjs
FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS=1 mise exec node@24.20.0 -- node output/checks/p3-06-paint-delay/run-diagnostic.mjs
mise exec node@24.20.0 -- corepack pnpm check:dev
```

第一条RED为9通过/5预期失败；实现及格式化后14/14通过，命令/退出状态见 `trace-profile-results.json`。第二条复用真实PG/TLS S3/worker/Next生产构建，固定中文礼物3次导航，无预热或补采；serve=false，结束清理owned服务。SOURCE关联见 `source-binding.json`：沿用前次2229输入，只两份TEST工具文件变化。

初始4419个未跟踪文件逐SHA保护，旧证据保持。本轮不改变前台，因此不重复上轮已完成的七语言88场景UI，也不把上轮结果说成本轮新验收。人工译审、运营计时、VoiceOver/物理手机、真实商户/PSP与staging证据继续保留。

## 本轮结果与下一入口

固定3次扩展profile全部保留，真实协议32,461项通过，27个原文件长度/SHA与设置/内容/0+1读取验证通过；6个官方FCP/LCP离线复算差值均0。实际LCP为628.637/433.427/371.471ms，激活后至提交仅0.225/0.389/0.341ms；本轮未复现旧异常。模拟LCP为5273.910/2785.393/2110.707ms，预算仍FAILED，不能用它们与默认profile声称收益。新追踪确实捕获pending、ACK和实际BeginImplFrame，为后续异常提供定位字段；见 `compositor-diagnostic-audit.md`。原48份诊断另保留，新3份为独立扩展口径，不是正式63次矩阵或RUM。

受影响4个工具文件25 tests通过。check:dev首次因上轮保存的19份压缩JS响应被当源码检查而lint失败（2333条）；增加只针对该原始响应目录的ESLint ignore后，全仓重跑通过28.463秒：typecheck/test各62/62、build36/36，缓存61/61/35。相邻分析工具与生产代码仍被lint，19份原证据未修改；见 `lint-evidence-scope.json`。这一配置修复发生在采集后，其源码差异单列 `post-capture-source-delta.json`。

adapter/artifact边界检查通过。原4419未跟踪文件逐SHA不变，2229采集输入除采集后ESLint配置外保持；生产应用源码无修改。fixture正常结束exit0，API/媒体/Next三端口已无监听。汇总见 `final-verification.json`，完整原始证据在 `output/checks/p3-06-storefront-acceptance/run-2026-09-17T12-38-57-411Z/`。

下一步应在受控异常导航中利用现有profile，关联pending/ACK、BeginFrame需求与提交条件；目前只定位了等待环节，没有定位触发原因或修复网站。不追加无限重跑，不通过修改浏览器特性/阈值制造通过。正式性能及人工/商户门继续开放。

显式暂存后秘密扫描exit0/40.430秒。S.U.P.E.R十项在本轮工具/局部验证范围通过；阶段性能门仍失败。最终复核与收尾状态见 `independent-review.md` 和 `final-verification.json`。
