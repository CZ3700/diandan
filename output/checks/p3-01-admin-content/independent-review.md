# P3-01 checkpoint 3A 独立复核

结论：**ACCEPT**。复核者 `/root/content_review_audit`；日期 2026-09-06。未修改被审查源文件。

范围：`packages/contracts/src/admin-content*.ts`、`database/migrations/0014_admin-content.*.sql`、PostgreSQL authorization/review/preview repositories、admin transaction composition，以及 `apps/api/src/admin-content-composition.ts`。Application 为本复核者实现，未将其计作独立审查；该层原实现由 DB 代理交叉复核，其时钟修改由 root 另行复核，不计入本报告的独立结论。

- 同一 SERIALIZABLE 事务中校验当前会话、MFA、角色权限和实际语言范围；锁定授权记录及规范内容目标。审核按父修订优先加锁，同时校验序号、内容及源语言哈希、状态。独立审核同时排除结构编辑者和译文编辑者，数据库新增触发器再约束结构编辑者。
- 核对调用链：完整 `READ_DRAFT` 保留实际全部语言授权门禁；`READ_REVIEW` 仅投影目标译文与实际 English source，源哈希与返回内容匹配。别名集合按其实际适用语言授权。
- 预览仅持久化目的隔离的令牌摘要；严格绑定修订、类型和语言。读取重新校验发行者当前会话、MFA、权限、语言和 grant 状态。有效期受签发时刻、TTL 及发行会话到期时间约束；返回内容无编辑者、审核或时间元数据。本人撤销预览只需当前基础预览权限，语言权限撤销后仍可减少自己的授权。
- callback、仓库操作及提交失败均进入现有事务回滚/安全错误路径；审核、审计及幂等记录共用事务。TEST composition 未接入生产登录，未声称完成 OIDC。

发现并修复后复查：

1. locale 撤权原先错误要求原 grantor 仍活跃，导致其停用后其他管理员无法撤权。修复后只有 INSERT 绑定 `granted_by`，UPDATE 校验实际撤销审计 actor 为 ACTIVE，原始授予历史保持不可变。真实 PostgreSQL 回归覆盖独立撤销、原历史保留、停用的实际撤销者被拒绝及审计回滚。
2. OpenAPI 曾将 `READ_REVIEW` 标成需并发版本，并将读取操作描述成发行新凭据；已改为显式 SUBMIT/APPROVE 判断及读取 `not-applicable`。
3. 真实 PostgreSQL 墙上时钟发生回拨，原审核代码将批准时间写得早于已持久化提交时间，触发 `23514` 并映射为 HTTP 503。诊断显示日语提交 `.716`，随后两种语言批准 `.818/.831`，当前授权却为 `.656/.660`，拟写批准时间为 `.665`；因此属于实际时钟非单调，不能用重试成功证明消失。最终审核时间取已锁定目标的编辑时间、上次事件时间及当前墙上时钟的 `GREATEST`，向上取整到毫秒后以 UTC 文本返回，避免 Node Date 截断 PostgreSQL 微秒而再次早于历史证据。序号、状态、哈希、独立审核约束均保留。
4. 预览签发与撤销也需要维持因果时间：签发使用稳定事务时刻与会话创建时间的较大值；撤销使用稳定事务时刻与该 grant 创建时间的较大值。UTC 文本保留微秒，使 grant 与 audit 时间精确一致。签发期限取 `min(transaction time + TTL, actual wall time + TTL, session expiry)`，回拨只收紧签发时计算的期限。0014 的事件时间上限同步取当前时刻、稳定事务时刻和相应已存历史下限的较大值；不可变内容、单向撤销、精确审计和会话期限约束未放宽。没有加入固定容差、等待或失败重试。

验证依据：

- 本次独立运行 Node `assert.deepStrictEqual` 逐项比较保存的旧生成 schema 与当前生成文件：旧 **206** 个定义全部保持不变，当前共 **225** 个定义。
- 已读取真实 PostgreSQL `independent-revoker-red.log`，修复前在原 grantor 停用后的撤销阶段报 `23514`；已读取 `postgres-integration-final.log`：**97 assertions PASS**。
- 已读取 `contracts-boundary.log`：contracts build 与生成产物 freshness 检查通过。
- 已读取 `review-timing-detail2.log` 的真实回拨及 `23514` 证据；`causal-review-time-red.log` → `causal-review-time-green.log` 显示新增因果时间回归先失败、修复后 **108 assertions PASS**，覆盖历史微秒及精确审计；`review-timing-after-causal.log` 显示 **100 轮、七语言、1800 个操作 PASS**。
- 已读取 HTTP `preview-clock-rollback-red.log` 与 `preview-issue-clock-rollback-red.log`：定点事件时钟回拨使原撤销、签发分别返回 503。最终 `preview-clock-rollback-green.log` 为 **434 assertions / 68 real requests PASS**，覆盖两处回拨、因果顺序、审计微秒一致、收紧 TTL 和 session 上限。

最终时钟修复独立结论：**ACCEPT**，针对上述由其他作者完成的 PostgreSQL 事件时间、预览期限和数据库约束修改。此结论基于源代码复核及已读取的真实数据库/HTTP 证据，不把本复核者自己的 Application 测试当作独立审查证据。

范围说明：以上为此检查点的代码审查及本地证据，不代表 P3-01 整体完成或生产发布；基础内容 authoring、copy/publish、预览界面与生产身份接入仍按后续检查点推进。
