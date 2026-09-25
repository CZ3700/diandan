# 同源码跨运行回归：独立方法审查

- Reviewer：`seven_locale_journey`，非 root 执行器作者。
- 日期：2026-09-23。
- 结论：**方法接受，最终执行证据待核对**。本记录不是五组实际通过、CI 全绿、缺陷已修复或 P6-01 DONE 的声明。
- 范围：只读规范、任务、执行定义与已有 final8 汇总后的方法审查；本次仅写审查记录，不修改执行源码，不启动服务、不补跑测试。
- 候选执行源码：`642a55a818680d763f41ce5d87b5386092591ea5341c92ce4e88c8248bcb8b72`。这只是后续须独立验证的一致性目标，不表示后续报告已核对。

## 规范判断

`docs/FAN_SUPPORT_PLATFORM_SPEC.md:1260–1292` 要求各测试层与十四条必测 E2E 通过；`docs/plan/task-breakdown.md:154` 要求 CI 全绿、十四条 E2E、消息目录/locale cache/hreflang snapshot 和可复现的失败 seed。未找到要求本地十七条固定命令必须在同一次 invocation 完成的硬性条文。

`docs/progress/phase-6-hardening.md:39` 的自拟验证计划要求“单条完整质量门”；final8 的 `quality-repository-check` 已有完整 PASS，而该条没有规定五组必须共用一个 invocation。CI 本身按五组独立 job 执行。这支持按同源码的完整 suite 汇总本地证据，但不支持拼接一个 suite 内的局部通过来替代其完整运行。

最终可表述为“同执行源码、跨运行的五组完整本地覆盖”。不能表述为“默认单条全套命令 PASS”，也不能修改任何原部分报告的 `coverage.complete`。

## 最终聚合必须逐项核对

1. **执行输入一致。** 重算每份完整 `source.json` 的可执行清单摘要，逐路径比较文件集合、SHA-256 和 mode；同时检查实际执行工作区与最终 root 的新增、删除、字节和 mode 差异。仅相等的 `report.sourceHash` 字符串不够。`sourceHash` 排除 docs、`.agents`、AGENTS.md 与 README.md 的既有规则须明确，文档差异仍保留在完整清单中。原仓库 `sourceHead` 须记录并核对；隔离副本自身生成的 Git 提交并非原仓库 `sourceHead`。
2. **执行定义一致。** 从同源码的 canonical plan 校验唯一五组、十七条命令的精确 executable/argv、顺序、退出码、signal 与启动结果。固定阈值、seed、合同、断言和数据隔离规则不变；标准验收快照不得包含 owned 诊断 instrumentation。
3. **完整 suite 证据。** final8 仅复用已完整 PASS 的 quality、catalog、commerce。新 operations 必须从登录起完整执行五条：login-permissions、order-operations、refunds-disputes、payment-configuration、exception-replay。新 journey 必须以标准 fresh 入口执行唯一完整命令，包含七语言×双视口十四场景、二十八次语言切换、两类失败/取消恢复及其原始证据门。旁路 finance 6742 PASS、受控 route 重复试验、局部截图或局部断言均不顶替标准 suite。
4. **真实环境绑定。** 冻结依赖与工具选择，核对 Node、pnpm、实际浏览器版本、PostgreSQL 工具/服务器版本及平台。`postgresSelection` 只是选择记录，不能替代实际服务版本证据。任何真实版本或环境差异必须逐项披露并评估兼容性，不得默认为一致；存在影响验收的未解释差异时不得接受聚合。
5. **唯一组输入。** `regressionCoverage` 内部使用 `new Map(results.map(...))`，重复 suite 会以后项覆盖前项。聚合器必须先拒绝重复、未知或缺失 suite，再给它五条明确选定、各自绑定完整 PASS 执行的结果；不能把各轮原始 suites 数组直接拼接后靠 Map 丢弃 FAIL。验收输出须确认十四条路径均 PASS、缺失组为空，并标注这是 aggregate coverage。
6. **不可变溯源。** 每个选定 suite 指向原 report、steps、plan、source manifest、逐命令日志与相关输出证据，记录文件哈希和 run 身份。三份原始报告、失败证据和局部 coverage 原样保留；新增独立 aggregate descriptor、manifest 与 evidence index，显式标识跨运行范围及原失败风险。

## 必须保留的失败与外部门

- final8 整轮仍为 **FAIL**；operations 财务 capture 的原 5 秒读请求归零门失败。退款同 key/payload、数据库唯一退款及此前矩阵通过不能抵消这次失败。
- 原源码旁路完整 finance 和受控 route 观察未复现，根因仍 **UNKNOWN**。不得将新运行通过描述为修复了该故障，也不能声称不存在间歇性问题。聚合须显式包含 `priorFailureRisk` 和原失败证据链接。
- 后续 operations 与 journey 尚需真实完成并由非作者核对；此方法接受不预先判定其结果。
- P6-01 的实际远端 CI 仍未通过。依据 `docs/progress/phase-6-hardening.md:40`，即使本地聚合最终接受，任务仍保持 **IN_PROGRESS**；真实商户/资金、人工、云/staging 与 Release Gate 证据均不能由此替代。

最终独立核对待 root 提供标准 journey 与 aggregate 证据路径后执行。本记录不删除或覆盖任何既有 FAIL。
