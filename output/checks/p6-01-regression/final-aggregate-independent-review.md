# 最终跨运行聚合：非作者独立核对

- Reviewer：`seven_locale_journey`，独立于 root 聚合生成器作者。
- 结论：**ACCEPT — 同执行源码跨运行本地覆盖的聚合与文件完整性**。
- 本人参与了 journey harness 实现，本记录不构成其实现或场景充分性的非作者审查；该部分由其他非作者单独核对。
- 本次只读原执行输入和证据，仅新增此审查记录及独立复算脚本。未运行原聚合生成器、未改执行源码、未启动服务或浏览器、未触碰用户实例。

## 独立复算结果

执行：`mise exec node@24.20.0 -- node output/checks/p6-01-regression/independent-final-aggregate-check.mjs`，exit 0。该脚本单独实现只读清单枚举、文件 hash/mode 比较、索引引用与归档校验；使用 canonical `planRegression` 和 `regressionCoverage` 核对执行定义及要求映射，没有重新运行测试或复制/生成测试结果。

- 原始执行源摘要均为 `642a55a818680d763f41ce5d87b5386092591ea5341c92ce4e88c8248bcb8b72`。
- 最终 root 与 final8、final-operations-9、final-journey-9 三个实际工作区：每份 **2740 个执行文件**，文件集合、SHA-256 和 mode 均一致。通过当前 Git tracked/untracked/deleted 清单检查新增/删除，没有只信任报告中的摘要字符串。
- 三份完整 source manifest 的可执行映射与 `final-source.json` 相同，并独立重新计算出相同 sourceHash；原仓库 sourceHead 一致。沿用 manifest 明示的文档/说明排除规则，不声称被排除文档字节完全相同。
- 聚合仅含唯一五组，canonical executable/argv 和原始 steps 顺序、标签、退出码逐项一致：**17 条全部 exit 0，signal 为 null、launchFailed 为 false**。
- quality/catalog/commerce 取自 final8 各自完整 PASS；operations 来自新完整五命令运行；journey 来自新完整单命令运行。未采用旁路 finance 或受控 route 诊断替代标准 suite。
- 拒绝重复 suite 后复算 `regressionCoverage`：**14 条要求全部 PASS、缺失组为空**。没有把多轮原始 suites 直接拼接后用 Map 覆盖 FAIL。
- 索引 **49 个引用、48 个唯一文件路径**全部重算 bytes/SHA；重复引用是同一原 final8 报告，内容 hash 相同。另独立重算全部 17 个选定命令的 log 引用。
- 归档完整文件集合及逐文件 SHA 与实际工作区 source output 对应：final8 **723**、operations **304**、journey **94**，共 **1121 份**。检查实际归档枚举、无额外/缺失文件、后缀范围、无符号链接以及来源字节。此为完整性证据，不替代内容正确性或截图隐私复核。
- 原 final1 至 final8 的 **8 份 FAIL**报告保持 FAIL，sourceHash/status 与索引记录相符。三轮原 `report.execution` 与 `steps.json` 相同，原有 `coverage.complete=false` 未被改成 true。

## 结论边界

这是 `SAME_SOURCE_CROSS_RUN_LOCAL_COVERAGE`，**不是默认单条全套 invocation 成功**。final8 原财务读请求等待失败仍在证据中；原因 **UNKNOWN**，没有证明已修复。后续完整组成功和诊断未复现不能抹去其间歇风险。

`final-evidence-index.versions` 只记录生成器当时的 Node/pnpm。可直接读取的 final8/operations 报告记录 Chrome `153.0.8010.53`、PostgreSQL `18.6`；journey 未独立持久化这两个具体补丁版本。`final-tool-version-scope.json` 已明确共同工具选择及 PG18 启动校验与实际补丁版本记录的区别。本审查接受该披露边界，不借相邻组的字段声称 journey 各服务补丁版本已被独立记录一致。

实际远端 CI、商用 PSP/真实资金、人工、真机、RUM、云与 Release Gate 证据仍未由本汇总完成。**本地聚合接受不等于 P6-01 DONE**，其远端 CI 门继续保留。

具体复算结果、审查边界和绑定的生成器/索引/清单/版本说明 SHA-256 见同目录 `final-aggregate-independent-review.json`。本结论仅针对该 JSON 中绑定的证据版本。

## 临时验证副本清理与只验证模式：增量 ACCEPT

原已执行生成器完整保留为 `assemble-final-evidence.executed.mjs.txt`，SHA-256 `85a9f7b83045233825d1827bb2846db8475372cde208ee13eef107cbdf3a5ed6`，与初次独立审阅绑定值完全相同。JSON 证据引用已指向此保留文件，并追加新生成器版本，不把旧 hash 错绑到已更新路径。

对照增量只涉及：参数白名单、系统临时目录下的自有 `mkdtemp`、`finally` 中只清除此目录，以及 `--verify-only` 时不写 final index/source。原组选择、阈值、逐文件检查与覆盖断言不变；不改变 2740 个执行输入。

独立执行 `mise exec node@24.20.0 -- node output/checks/p6-01-regression/assemble-final-evidence.mjs --verify-only`：exit 0，复算仍为五组、十七命令、十四要求、2740 文件、相同 sourceHash。执行前后 `final-evidence-index.json`、`final-source.json`、`final-artifact-integrity.json` 的 SHA 完全相同；本次没有遗留新临时目录。详见 `aggregate-verify-only-independent.json`。

四个旧验证复制目录确已不存在。删除前每个 2822 文件的逐字节/归属检查来自 root 的 `evidence-scratch-cleanup.json`；本人没有在删除后冒称重放其删除前检查。初次独立核对直接读取 root 与三个实际执行 workspace，未依赖这些复制目录，所以清理不撤销原聚合完整性结论。`owned-source-verification-final.json` 作为 root 的原文件保护复核记录另行绑定。

`--verify-only` 从原报告和当前执行输入重新计算结果，本身并不比较已有 final index 的内容；已有索引由本独立审查完整核对，并在本次验证中确认字节未变。其他 UNKNOWN、跨运行及外部门限制全部保持。
