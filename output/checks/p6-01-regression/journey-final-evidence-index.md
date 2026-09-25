# Journey 最终实证索引

本索引仅汇总本子任务实证，不替代 P6-01 的五组统一验收。产品、回归脚本及独立测试副本 instrumentation 的最终 SHA-256 见 [机器可读索引](journey-final-evidence-index.json)；本轮受测产品与 harness 文件均与根工作区逐字节相同。诊断改动只在独立副本，未加入产品日志或改变业务约束。

| 实证 | 结果与边界 | 报告 |
| --- | --- | --- |
| 全新内容与完整旅程 | PASS：七语言 × 两尺寸共 14 场、140 步；28 次真实 Header 切换；2 次 FAILED/CANCELED 返程恢复；非法 locale 404；页面错误 0。单礼物、价格、回执、head、各语言 outbox/purge 唯一门均通过。本轮受观测 worker 自然 40001 为 **0**，不能据此声称实际触发了重试。 | [外层](journey-coldstart-fixed-2/report.json) · [逐场矩阵](journey-coldstart-fixed-2/browser/report.json) |
| 受控 PostgreSQL 中止 | PASS：真实礼物发布完成全部事务写入后，在 COMMIT 前由 PostgreSQL 抛出一次 40001；正常 runner 回滚并自动恢复，无手动重试、无最终 DTO 替换。到达完整提交边界 2 次，成功提交 1 次，最终同一操作仍仅一套权威结果。该轮还额外观察到一次自然价格 SELECT 40001；整体仍明确是**合成中止验证**，不包装为纯自然并发验收。 | [报告](journey-publication-abort-proof/report.json) · [仅副本注入哈希](journey-publication-abort-proof/instrumentation.json) |
| 下游预检 | commerce 3 项及 operations 前 2 项在 diagnostic-2 通过；native finance、支付配置、异常重放在 diagnostic-3 通过。后者为 OPERATIONS_TAIL_DIAGNOSTIC，不能合并冒称一次完整 operations 验收。 | [诊断 2](downstream-diagnostic-2/steps.json) · [诊断 3](downstream-diagnostic-3/diagnostic.json) |

完整旅程使用生产编译的 storefront + TEST 运行时、独立原生 PostgreSQL 18.6、实际本地 TLS/OIDC 与持久 TEST PSP。付款确认来自真实签名 TEST webhook；未通过 SQL 伪造 PAID。私密署名、留言、邮箱和令牌只在内存参与验证，不进入此索引；截图按回归脚本遮罩。

原冷启动 FAIL、两个自然 40001 复现、仅发布修复后媒体 SELECT 40001 的 FAIL，以及所有旧诊断失败均保留。最初 precheck 因缺少下层诊断，原因仍记 UNKNOWN，不倒推为后续已捕获的相同原因。Docker finance 的 23514/receipt guard 失败也保留；既有 Colima 时钟问题不构成本次同因证明，具体原因仍 [UNKNOWN](downstream-diagnostic-2/finance-readonly-followup.json)。

两个成功的新实例均已通过 stop + reset 清理；失败实例仅停止并保留数据。用户 acceptance 实例未触碰。当前本子任务无运行服务或浏览器，后续由 root 独占运行无 instrumentation 的统一回归。真实商户、真实资金、云环境和性能结论不在此索引验收范围。
