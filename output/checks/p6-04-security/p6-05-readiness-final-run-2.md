# P6-05 候选就绪 — run-2 冻结输入刷新

状态：**CONDITIONAL_CANDIDATE_NOT_ACTIVATED**。P6-05 保持 PENDING，无 owner；Lane D 尚未释放，Phase 7 保持 LOCKED。原 `p6-05-readiness.md/json` 保留不动，本增量只刷新其精确选择集，不重新定义原依赖或降低验收条件。

绑定 `run-2/source.json`：`0d523ce1fd33903d1ca1a01c6cc47f8b91099229ab92d8cbd081798faa15313b`，2,921 个清单条目。复核同时读取根工作区、清单与实际冻结副本 `/Users/mario/Desktop/.fan-support-regression/90be5724-4da1-4f8f-baed-316a23351950/workspace`，逐文件比较 SHA 与 mode。

| 原依赖精确选择集 | 结果 |
| --- | --- |
| P1-06 | 67/67 等于原候选检查值，且根目录、run-2清单、实际副本相同 |
| P4-06 | 62/62 同上 |
| P5-06 | 69/69 同上 |

合计198次比对、193个不同路径，零缺失/差异；选择集及其排序摘要详见 `p6-05-readiness-final-run-2.json`。完整历史本地 ACCEPT、非作者审阅、原任务范围和剩余供应商/云边界继续由原报告引用的证据支持，不把选择集不变说成当前全仓未变。

run-1→run-2 全清单只有 `apps/api/scripts/rum-browser.mjs` 一处变化，且不属于上述选择集。该变化收窄 `.notice` 定位并增加完整性提示断言；原14采集/42行/23筛选×双端/空窗/零网络与页面错误要求保留。旧整轮 FAIL 必须保留。由于性能工具第10命令会 import 该 harness，它不能仅引用 run-1通过：需当前冻结源的实际补跑证据。复核时 run-2 状态仍 RUNNING，不能预判真实RUM或完整七语journey通过。

之前唯一未由P6-03旧输入覆盖的 `artifact-registry.ts` 注册增量现已包含在本轮冻结候选中。`contracts-preservation.json` 已提供707旧JSON Schema定义、207旧OpenAPI schema、129旧路径逐值不变，只增内部 `RumReportV2`；其文件SHA绑定在机器证据中。最终整体接受仍归root。

**P6-04残余不豁免**：普通前台、后台及支付页统一 CSP / Permissions-Policy、nonce/hash脚本策略仍OPEN，归P6-04续验，公开staging / Phase7放行前需连同真实Next/PSP回归关闭。实际WAF/IAM/origin不可绕过性、正式IdP/KMS/邮件/PSP与云环境证据仍保留；P6-05本地故障任务不能代签这些门，也不能替代P6-06恢复演练、RPO/RTO/15分钟回退或Phase7灰度。

激活条件：root接受当前P6-04冻结候选与明确残余范围；run-2及必要补跑、非作者最终核对、原文件/用户实例保护完成；随后释放Lane D、登记ADR-016有限本地故障范围，再单独将P6-05置READY。若之后有源码变化，须重核本选择集。此增量未修改product/progress、未操作用户实例、未执行测试或故障注入。
