# final-7 order-payment 原 Docker 数值诊断

2026-09-23，owner `/root/regression_coverage_audit`，root明确授权一次诊断。只临时修改 final-7 owned snapshot 的 `apps/api/scripts/order-payment-http.mjs` observer；root源码、fixture、迁移、支付合同、时间逻辑与阈值均未修改。

执行一次 `mise exec node@24.20.0 -- node ./apps/api/scripts/order-payment-http.mjs`，使用原 Docker PostgreSQL + 原独立 TEST PSP/S3/真实HTTP/worker路径。此次 PASS 6847，exit0；未自动重复这条命令。原full final-7仍FAIL，其报告和归档未改。

观测严格匹配 AUTHENTICATED_RECONCILE/PAYMENT_STATUS 的原 public.provider_events INSERT：列shape一致、参数13/14项、原第12/13参数（zero-based11/12）分别为 occurred_at/normalized_at。原样INSERT前，用同连接、同事务、MATERIALIZED单次clock读取计算两者差与各自减数据库clock的差。原两个INSERT参数已经固定，观测未改动其数值。输出仅固定stage、闭集status、ordinal、分数字符位数及有限数值差；无ID、原时间戳、原参数或SQL正文。既有失败诊断与原全部断言保留。

共捕获16次INSERT，无 occurredMinusNormalizedMs>0，也无provider_events_time_check失败。原失败的“actual expiry and late authenticated capture”场景为第15个样本：

| 数值 | 毫秒 |
| --- | ---: |
| occurred - normalized | -37.130 |
| occurred - current PG clock | -42.188 |
| normalized - current PG clock | -5.058 |
| current PG clock - transaction start | 9.203 |

实际16次参数均为 occurred 3位小数、normalized 6位小数。PSP事件由pg timestamptz→Date→ISO截到毫秒；normalized由原to_char(US)精确字符串传入，未经过Date转换。另一个纯Node/parser检查使用静态合成值证明pg Date/JS Date会向下丢弃微秒，而contentTimestampSchema保留原字符串。该纯检查初次将ISO直接喂给要求PG文本格式的parser返回null，记录于precision-proof.json；更正为原PG文本格式后才形成有效精度证据。它没有启动数据库或修改原运行。

第15样本中若另行对normalized做Date/ISO转换会丢0.130ms，但这只用于观测对照，原INSERT始终使用6位原值。故本次实际链路不支持“normalized被JS向下截断、occurred保留微秒”的假设。由于原失败值缺失，本次未复现也不能证明旧Docker失败根因已修；cause保持NOT_REPRODUCED_UNKNOWN。统一native TEST selector的后续PASS应独立记范围。

原harness自行结束并退出0；run-result报告ownedFixtureCleanupAttempted=true。没有对其他任务的资源执行任何清理。外层finally恢复owned诊断源码并核验原SHA，root同路径SHA亦保持。完整样本见diagnostic-result.json，执行边界见execution.json，恢复见restore.json，原件和temporary.diff保留。原full最终验收仍未通过。

原件/恢复 SHA-256：`acf0db0213fe37f4217b7cdf4a064d1f971e5d3a4283adc3f549d0f25784a593`。

临时 observer SHA-256：`0976e42024121d89204a77b020c02bea2048fb06e7088fb70580f53e5401b4bf`。
