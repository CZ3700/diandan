# P5-07 独立代码质量复核

Reviewer：Codex `/root/psp_runbook`。本 reviewer 是两份 PSP runbook 的作者，不把自写文档计入本报告的独立代码审查；根工具由 `/root` 编写，新增 HTTP/协议脚本由 `/root/exception_ui` 编写。本报告结论为**所列代码质量 PASS**，不代表 P5-07 全部运行门、任何真实 PSP/资金/上线通过。

## 已审范围与源 SHA-256

| 文件                                     | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `scripts/verify-psp-onboarding.mjs`      | `0ee9f80c36b21a95904e905a8d16c0bf43a4276728e3a3a58bee4b460582a74d` |
| `scripts/verify-psp-onboarding.test.mjs` | `51cfd996d97a60fdd0e5c1523acca0490e46b91505e535766c4324cf57a0e416` |
| `scripts/psp-onboarding-conformance.mjs` | `5b23c152a2187ae1a0be99fe32fc08fda83b524e550c491d94a5bb2396ed3ac2` |
| `package.json`（仅新 script 行的 diff）  | `e1c51631ce54e0e76fa438a1d1e28cfe6eb15f9d33a4c6949b7699dcbf9cde3c` |

根工具范围先经 `/root/exception_storage` 规格复核，再做本次质量复核。使用 `code-simplifier` 检查单一职责、命名/控制流、失败/目录保护与可重复性，只审新改动，没有修改作者源码或为减少行数做重构。

## 结论

未发现当前范围内的阻断问题，也没有值得为此新增变更的简化建议。

- `planPspOnboarding` 只产生固定四步、本地 TEST 范围，未知/重复参数和数据库/LIVE 选择器拒绝。`--plan/--help` 不创建目录或启动进程；执行使用参数数组、`shell: false` 和固定工作目录，没有 shell 拼接。
- 每次输出目录必须新建，已有目录不覆盖；计划和各步骤日志使用 exclusive create。目录权限 0700、日志 0600；没有删除用户既有文件或操作既有数据库的根入口。
- 开始即写 FAIL receipt；每步骤记录真实退出码/起止时刻/日志，spawn 错误、signal、抛出异常及非零退出均停止后续步骤。只有四步全成功才写 PASS，未执行步骤显式保留。launcher 异常内容不会直接进入报告。
- 子进程 stdout/stderr 直接写所属日志文件，避免大输出截断；真实 child 测试已证明 exit 23 和输出原样保留。日志仅来自固定 TEST 工具；root wrapper 不把自身 PASS 冒充 sandbox、浏览器或资金验收。
- fake conformance 调用正式共享 suite，校验 passed 和完整 15-case 数，不调用 legacy webhook parser。正式 verifier 由 adapter-tests 执行，界限在注释和计划中明确。
- 计划、执行、conformance 各自职责清楚；异常退出保守留 FAIL，重新运行需要新目录，可以保留首次失败。没有引入依赖、生产配置/API/合同或资金行为变更。

## 实际验证

2026-09-22 UTC，本次 reviewer 自行运行：

```text
mise exec node@24.20.0 -- node --test scripts/verify-psp-onboarding.test.mjs
exit 0; 8 tests, 8 pass, 0 fail; duration 84.790666 ms

mise exec node@24.20.0 -- corepack pnpm exec eslint scripts/verify-psp-onboarding.mjs scripts/verify-psp-onboarding.test.mjs scripts/psp-onboarding-conformance.mjs --max-warnings=0
exit 0; no diagnostics

mise exec node@24.20.0 -- node scripts/verify-psp-onboarding.mjs --plan
exit 0; four fixed stages; LOCAL_TEST; commercialSandbox/realMoney/productionRelease/browser=false
```

最后一条只验证计划，不算真实演练。root 的整合构建、adapter 实跑、真实 PG/TLS 分级 HTTP 及最终源锁定仍由总验收记录负责。

## 新 HTTP/协议脚本追加复核

`/root/exception_storage` 先给出整体规格代码 PASS，之后本 reviewer 阅读两份新增脚本及其消费的既有配置/订单/PG/S3/进程 fixture 边界。作者本轮修正的 cohort attempt 查询已在当前磁盘版本改为通过 `payment_attempts.order_id = orders.id` 与 `orders.checkout_session_id` 关联；原 create receipt 的摘要前后均要求恰一行，避免空集合相等的假证明。

| 文件                                           | SHA-256                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `apps/api/scripts/psp-onboarding-http.mjs`     | `54af3ccbd750f64633d42d70cce2cbea5442535f79a222ed2ae214f31a82ed0b` |
| `apps/api/scripts/psp-onboarding-protocol.mjs` | `c9d3d7e5d645b04fffb51cbd531b7b942ecbe4fac5ad839ecf2a1a745b3e9248` |

未发现需要阻断整合运行的新问题，不建议为简化而改写当前顺序性协议场景：

- HTTP 入口负责隔离资源、安全诊断、scope 与分层 cleanup 结果；协议脚本负责真实管理命令、checkout、灰度和原账户恢复，职责有清楚边界。它们复用已经验收的 fixture，不另造支付业务逻辑。
- 全部新配置变更走认证管理命令与真实 validate/approve/publish/rollback；协议内 SQL 用于只读核实。实际 TEST 账户状态 ACTIVE 与 API loopback 明确断言，独立进程 PID 在复用 fixture 中断言，scope 不冒称 LIVE 员工白名单。
- 24 个 checkout 来自正常服务端创建；实际两个 API/七语言能力响应与 PG/domain 同一账户/规则 UUID 的桶对照。中间比例只报告观测计数，不用随机“必须命中”断言；0/100% 断言全拒/全纳。合成双 500 四象限向量另列，不伪装成实际 HTTP 抽样。
- 每轮 publication 的固定历史行和审核/审计摘要保留；返回旧版本时验证原 route UUID 和 cohort 桶恢复一致。UNKNOWN 在关闭后使用原键/正文跨两 API 回放，核对原账户、恰一条永久 receipt、订单快照和 PSP 创建计数；新创建经当前零比例和旧配置两种路径被拒。
- 故障报告只保留 allowlist 名称/代码和受限栈位置；日志 canary 在 protocol PASS 前验证。stage 证据只含合成安全标识、比例、计数、hash 和审计字段，不保存 Cookie、授权头、原始 PSP body 或私密内容。
- 内层 fixture 成功不直接宣称外层 PG/S3 已清理；外层 harness 全部正常返回才输出整体 PASS/cleanupVerified，普通异常保留 FAIL、失败阶段及清理状态。外部强杀/主机崩溃不在本脚本的成功保证或本次审查运行证据范围。

本 reviewer 追加运行：

```text
mise exec node@24.20.0 -- corepack pnpm exec eslint apps/api/scripts/psp-onboarding-http.mjs apps/api/scripts/psp-onboarding-protocol.mjs --max-warnings=0
exit 0; no diagnostics

mise exec node@24.20.0 -- node --check apps/api/scripts/psp-onboarding-http.mjs
exit 0

mise exec node@24.20.0 -- node --check apps/api/scripts/psp-onboarding-protocol.mjs
exit 0
```

实际 PG/TLS 完整执行不由本 reviewer 重复启动，避免与 root 的源锁定和统一验证争用。最终验收必须同时引用完整总入口退出结果、所有子报告、原失败保留、清理结果及对应源 SHA。若所列文件发生进一步实质变更，应重新复核差异；格式规范化应记录新的摘要及等价 diff。
