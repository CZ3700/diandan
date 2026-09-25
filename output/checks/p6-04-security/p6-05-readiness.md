# P6-05 只读候选就绪核对

2026-09-24；reviewer：`security_content_review`。**结论：CONDITIONAL_CANDIDATE_NOT_ACTIVATED。** P6-05 保持 PENDING，无 owner；当前 Lane D 仍由 P6-04 root 占用。此处核对原直接依赖和可本地范围，未激活任务、未修改 progress/product、未启动 PG/Chrome 或执行故障注入。

原依赖仍为 **P1-06、P4-06、P5-06**。`docs/plan/task-breakdown.md` 定义超时、乱序、重复、队列积压及 PSP/邮件/对象存储/DB 短暂失败，最低要求无丢单/重复扣款、backlog 恢复、UNKNOWN 可对账；不添加新的业务依赖。ADR-016 允许消费已经完整本地验收并经过非作者复核的直接依赖，但 P6 六项必须在 Lane D 串行、逐项登记本地激活范围。

## 原完整本地验收与非作者证据

| 原依赖 | 完整本地成果与真实证据 | 非作者与边界 |
| --- | --- | --- |
| P1-06 | `docs/progress/phase-1-contracts.md` 的 P1-06 DONE 执行卡；Git `02ee10846a3b960e6f0d7bceb0b2d269f972a0aa`。原始字节先验签、持久 inbox/outbox、pg-boss 6 次预算/DLQ、10 路重复、事务 effect/outbox 原子回滚、commit-before-ACK 重投；记录了 PG18、fresh clean clone、完整本地及 PR #9 / run 33808236380 Quality/Security。 | 同执行卡记录独立审查发现 queue context 和原子性证据缺口，修复后 ACCEPT、Blocker/Major 0。本次核对本地历史记录与 Git，并未重新访问远端 CI 或重跑原 clone，不能称新的远端验证。真实 PSP/KMS 和后续订单业务不属于当时任务；后续已由 P4/P5 本地成果补足。 |
| P4-06 | `output/checks/p4-06-notifications/final-verification.md`；通知 PG/TLS/Worker/CTA 6814，清理 6105、UNKNOWN/action 5843，七语模板 44 场景/842 断言，旧版本重现、固定 locale/传输/正文、响应丢失和接收器重启。 | `final-independent-review.md` ACCEPT；本人作者范围明确排除，另有 `template-provider-independent-review.md`、`notification-independent-review.md` 交叉非作者批准。原完整 check 的一次 5 秒 import 超时如实保留，原后缀同源补验通过，不冒称单条全绿；人工译审 DRAFT、真实 SMTP/商户/云门仍在原任务。 |
| P5-06 | `output/checks/p5-06-exception-operations/final-verification.md`：实际 PG 专项53；完整组合7143、浏览器自身708/11cases/89axe，七语双端；10次原handler和同键重放没有新增经济动作，原账户 UNKNOWN 恢复，通知受控重发，业务提交后未settle租约恢复。 | `spec-review.md`（11源，非UI作者审合同/应用/存储）与 `storage-independent-runtime-review.md`（53源，存储作者审应用/API/Worker/UI）均 ACCEPT；`review-input-verification.json` 记录最终源码一致。后者准确区分 Worker 对象重建与真实 OS kill。本地完整 check:dev 通过，不声称全历史 PG/S3 重跑或商业环境验收。 |

P1-06 历史非作者结论来源是版本化执行卡；当前仍存在的运行核心再由 P6-01 的完整同源回归和其独立证据复核承接，不能只凭旧文档中的 DONE 推断今天源码未变。

## 当前源比较和后续覆盖

机器明细及逐文件 SHA 在 `p6-05-readiness.json`，本报告不是全仓零漂移声明。

- **P4-06：62/62**。复算既有独立 readiness 选择的通知/清理直接输入，全部等于 `p6-01-regression/p6-02-readiness-source-final8-preparation.json` 的已审版本。
- **P5-06：69/69**。全部等于 `p6-03-performance/p6-04-readiness-final-5.json` 的已审版本；其中67项承接原 P5-06，exceptions CSS 和 HTTP harness 两项承接 P6-01。完整证据不能缩减为只看这69项，也不能据此称共享依赖均未变。
- **P1-06：67 个历史任务修改的 TS/MJS 输入**（`7f09f82d..02ee1084`，不含生成物）。41项仍与 P1-06 原值一致；62/67等于 P6-01最终同源输入。后续 API/Worker composition、repository、transaction runner 等26个原任务差异有更新后的 P6-01 原 PG、commerce、运营异常及 journey 实际验证承接。
- 其余5项为 `production-application.test.ts`、`contracts/artifact-documents.ts/.test.ts`、`artifact-registry.ts`、`contracts/index.ts`；前4类中的当前旧版本适配已在 P6-02/03接续，**当前67项中66项等于 P6-03 candidate-5**。唯一新的不匹配是 `artifact-registry.ts` 的 RumReportV2 注册；它由本轮 root 的生成物/全定义兼容检查和最终质量门承接，尚不能用旧 ACCEPT 自动覆盖。

当前可消费的较新完整证据：

| 源范围 | 已有测试 / 证据 | 不能推断的内容 |
| --- | --- | --- |
| 核心可靠事件、通知、清理、异常恢复及后续装配 | `p6-01-regression/final-evidence-index.json` 为同源五组17命令14要求；quality/canonical PG/commerce 为 final-8，operations 为 final-operations-9，journey 为 final-journey-9；`final-aggregate-independent-review.json` ACCEPT 绑定2740执行输入 | 这是同源跨运行覆盖；final-8整轮曾失败，不能改成单次整轮PASS或当前全部共享代码未变 |
| 后续 public GET/目录、RUM及合同测试接线 | P6-02全新 run-4 与受影响6workspace完整测试；P6-03 `candidate-5-quality-exits.json` check:dev exit0（types64/tests64/build36，有缓存）、contracts/adapter/artifact通过；candidate-5真实Next RUM/PG/TLS S3与正式性能运行见其 final-verification | 不替代真实用户p75、生产网络容量或本轮新补丁验收 |
| 本轮 RUM v2 | `content-review.md`：真实RED、56 observability/3合同/17纯工具，窗口完整性、隔离、PII、旧v1源码不变；当前 root 负责生成合同及非作者复核 | 不能提前标P6-04 ACCEPT；CLI exit0也非fieldAcceptance |
| 本轮 TEST mail GCM / Next补丁 | `scans/gcm-final-checks.json` 单测与格式检查，root 的当前 Next依赖审查和订单/财务/异常真实PG、fresh七语journey（含S3上传）最终验证待汇总 | 这些变化发生在旧candidate之后；旧邮件/前端证据不能直接为新字节背书 |

P6-04最后验收应把上表待完成项绑定其冻结源码，并核对本 readiness 所列源是否再次变化。此时文档仅提供候选输入，不借当前阶段未完成的验证激活下一项。

## 建议有限本地故障范围

只在独占、可销毁的 `LOCAL_TEST` 新实例和合成业务数据中执行；保护用户持久实例 `acceptance-e143d720dd1a4357a3c3`。每场景限定目标 ID、期限、attempt预算和退出条件，保留非目标正常工作量，禁止删业务历史、清空去重表或放宽生产重试来制造“恢复”。

| 故障 | 需要观察的持久事实和恢复结果 |
| --- | --- |
| PSP 请求超时/提交后响应丢失 | UNKNOWN保留原provider/account/attempt/key；认证对账恢复，经济create/refund计数不增加；可信成功不能被清理吞掉，浏览器回跳不能写成功 |
| 已验签事件重复/乱序、commit-before-ACK | 原始签名/identity仍经过真实入口；并发重复只一份effect/入账/履约事实，拒绝冲突payload；ACK与DB提交顺序有观测，未ACK后重投可恢复 |
| 有限队列积压、handler短暂失败、重启 | 实际pg-boss积压计数/最老等待时间、有限retry→DLQ、恢复原handler后drain；非目标任务正常完成；旧generation不能settle新lease；不得把对象重建写成OS进程kill |
| 邮件超时/未知回执/短暂失败 | 同网关同key同正文、固定locale/templateVersion/recipient identity；确认失败可重试，UNKNOWN不换供应商/正文重发；接收器副作用计数与通知状态一致，不声称收件箱exactly-once |
| 对象存储短暂失败 | 上传/读取/派生/发布阶段明确注入点、限时失败和恢复；只有验证成功且完整派生物可发布，不把部分上传当成功；重试不创建多份权威发布/无主metadata |
| DB连接/事务短暂失败 | distinguish明确回滚与unknown COMMIT；事务内业务+outbox原子性、原幂等命令恢复、无丢单/负库存/重复退款；等待实际DB时钟/锁状态，不凭host sleep认定lease已到期 |

每项至少保存：固定seed/注入参数、原始失败、开始/解除故障/收敛时间戳、源码SHA、before/after安全计数、确切退出码、所有场景结果、资源归属和cleanup结论。还需正常对照和失败对照，证明注入真实触发、断言确实会失败，而不是仅有“预计会抛错”的mock。若范围包含OS kill，必须只杀自有PID并提供该窗口的持久恢复证据；P5-06模拟提交后未settle的证据不替代它。

优先复用入口：persistence `test:postgres:reliable-events`、`test:postgres:notifications`、`test:postgres:commerce-expiry`、`test:postgres:admin-exceptions`；API `test:postgres:admin-exceptions` 及现有 payment/order/finance HTTP harness；媒体按实际注入点选择S3/worker harness。先画覆盖矩阵再选择运行，不把既有每个历史测试全部重跑当作P6-05自身故障证明。新工具须测试错误退出、超时、ownership清理和隐私；产品如被修复再遵守RED→GREEN及相关回归、format/lint/typecheck/build、非作者检查和S.U.P.E.R。

## 不可替代的原门与正式交接条件

本地故障注入不代替真实PSP商户/sandbox和小额资金、正式邮件域名/供应商实际投递、云KMS/IAM/网络/RDS failover、真实生产容量/告警路由、staging、P6-06 PITR/对象恢复/四镜像与配置回退实操、RPO/RTO及15分钟代码回退证据，也不代替Phase7灰度与24/72小时观察。沿用原任务要求，不在P6-05凭空加一个商业供应商接入任务，也不将其本地完成自动视为云恢复成功。

正式交接顺序：root **完成并接受当前P6-04冻结候选** → 释放Lane D → 再核对以上源与证据 → 在MASTER/phase登记ADR-016有限本地ACTIVE范围、未覆盖项与验证计划 → 单独置P6-05 READY并领取。本报告不执行这些状态变更。
