# Phase 1 — 合同、领域与数据真相源

> 状态：ACTIVE
> 任务：6  
> 解锁条件：Phase 0 退出门禁通过；与 Phase 2 同时激活

## 目标

冻结可序列化合同、纯领域规则、自研内容/商品/价格/库存模型、数据库与可靠事件骨架，使 UI 和运营工作可以在稳定边界上并行。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P1-01 | DONE | Codex `/root` | P0-01、P0-03 | Git `4695a41`、PR #4/run `33693878714`；本地、clean clone、Quality/Security 与三路独立复核全绿 |
| P1-02 | DONE | Codex `/root` | P1-01、P0-04 | Git `6daea69`、PR #5/run `33707017702`；本地、clean clone、Quality/Security 与两路独立验收全绿 |
| P1-03 | DONE | Codex `/root` | P1-01 | Git `49a8756`、PR #6/run `33720394020`；本地/clean clone、Quality/Security 与三路独立复核全绿 |
| P1-04 | IN_PROGRESS | Codex `/root` | P1-01、P1-02、P0-03 | 2026-09-03T14:38:05+08:00 领取；完整 migrations、七语言 translation/review、inventory balance、订单金额/退款约束与加密边界 |
| P1-05 | PENDING | — | P1-01/02/03/04 | Repositories 与 payment/media/identity/notification/cache/KMS ports/adapters |
| P1-06 | PENDING | — | P1-04、P1-05 | Inbox/outbox/worker/webhook |

## P1-01 执行卡

- **Owner / 开始时间**：Codex `/root`，2026-09-03T06:02:09+08:00。
- **范围**：在 `@fan-support/contracts` 唯一定义带 `schemaVersion` 的跨模块 Zod 合同、七语言常量与 locale provenance；生成并提交 JSON Schema/OpenAPI；让 `i18n` 只导入这些 locale 定义。
- **非目标**：不实现领域规则、数据库 migration、repository、供应商 adapter、业务 API 或 UI；不从 locale 推导 market、country、currency 或 payment capability。
- **测试先行计划**：先写失败测试覆盖七语言精确集合、规范化、strict/version 拒绝、金额不变量、隐私公共视图、序列化与 OpenAPI/JSON Schema 一致性，再实现最小合同与生成器。
- **验证计划**：受影响包测试、契约生成 freshness/仓库重复 locale 检查、format、lint、typecheck、完整 `pnpm check`、secret scan、clean-clone frozen install/check，以及独立契约/安全评审。
- **风险护栏**：私密留言和完整显示名不得进入公共 DTO、日志、事件元数据或浏览器持久化；金额使用整数 minor unit；未知 `schemaVersion` 必须 fail closed；供应商 SDK 类型不得进入合同。

### DONE 证据（2026-09-03）

- **实现**：`packages/contracts/src/` 唯一定义 34 个注册合同，覆盖 locale、catalog、cart/support intent、quote/amount、payment/provider evidence、order/policy/notification snapshot、refund/dispute、fulfillment、事件与公开错误；`packages/i18n` 与 `packages/observability` 复用 canonical owner。
- **产物**：`packages/contracts/generated/contracts.schema.json`（JSON Schema 2020-12）与 `openapi.json`（OpenAPI 3.1）由同一 registry 确定性生成；20 个 HTTP 合同进入 OpenAPI，14 个 internal 合同被排除。
- **TDD/回归**：支付公开 URL userinfo、cart item 版本/归属、早到 webhook `UNMATCHED`、成功退款闭合与 `MAX_SAFE_INTEGER` 抵消溢出均先失败再修复；6 份代表性 v1 golden 锁定 Cart/Order/PaymentAttempt/ProviderEvent/EventEnvelope/PublicError；合同测试为 13 files / 32 tests 全绿。
- **本地门禁**：Node `24.20.0`、pnpm `11.25.0` 下 `TURBO_FORCE=true pnpm check` 为 0 cached、typecheck 37/37、test 37/37、build 34/34；`pnpm security:secrets` 与 `pnpm audit --registry=https://registry.npmjs.org --audit-level=high` 退出 0。
- **独立复核**：artifact/locale ownership 的时区确定性、篡改 freshness、重复 locale、internal OpenAPI 排除与敏感字段 denylist 对抗检查通过；Blocker 0、Major 0。
- **clean clone**：Git `4695a41` 在全新 clone 中完成 `pnpm install --frozen-lockfile --offline`、0 cached 完整 `pnpm check` 与 secret scan；工作树保持干净。
- **真实 CI**：[PR #4](https://github.com/CZ3700/diandan/pull/4) 的 [run 33693878714](https://github.com/CZ3700/diandan/actions/runs/33693878714) 中 Quality 与 Security 均成功，merge 状态 `CLEAN`。
- **剩余边界**：当前 OpenAPI 明示为 schema-components bundle，业务 path/operation 的 RBAC、幂等与 expectedVersion 由对应 API 任务补齐；嵌套的 TranslationSnapshotRef/MediaSnapshot 不得单独作为 API/event/queue 根；catalog base status、revision 发布生命周期与 public published view 由 P1-02 拆分；供应商 host allowlist、webhook 验签与 reconcile 认证属于 P1-05/P1-06；本任务没有 AWS apply、staging、生产发布或真实支付证据。

## P1-02 执行卡

- **Owner / 开始时间**：Codex `/root`，2026-09-03T07:19:20+08:00。
- **范围**：定义仓库自有的 content、catalog、pricing、inventory、media、policy schema 与全虚构 fixtures；显式建模七语言 translation/review、source hash、stale、完整度和发布校验；拆分 base operational status、不可变 revision lifecycle 与只含已发布内容的 public view。
- **非目标**：不建立数据库 migration/repository，不实现业务 API、Admin/Storefront UI、对象上传处理、库存状态机或生产内容；不引入真实偶像资料、地址、授权不明媒体或云资源。
- **测试先行计划**：先写失败测试覆盖精确七语言包、source hash 不匹配派生 stale、自审拒绝、机器导入只能进入 `DRAFT`、缺价格/适用偶像/合格媒体/任一 locale 必填或关键 `APPROVED` 译文时发布失败，以及 public view 拒绝 draft/archived/internal-only 字段，再实现最小 schema、validator 与 fixtures。
- **验证计划**：运行受影响包测试与 artifact freshness，随后执行 format、lint、typecheck、完整 `pnpm check`、secret scan、clean-clone frozen install/check，并做独立内容合同、隐私和发布门复核。
- **风险护栏**：对应 R-06/R-08/R-17；不得用通用 `entity_type + entity_id + JSON` 翻译袋，不得从 locale 推导 market/currency；已发布 revision/internal ID/source hash 保持不可变，公开 DTO 不泄露审核身份、内部对象 key、偶像隐私或未发布内容。

### DONE 证据（2026-09-03）

- **实现**：`packages/contracts/src/content*.ts`、`catalog-content.ts`、`media-content.ts`、`pricing-inventory-content.ts`、`publication.ts` 与 `packages/content/src/` 定义 base/revision/translation/review/publication/public projection；四类内容对象、价格/适用关系/库存与全虚构 fixtures 均由仓库源码拥有，不引入 CMS、商城 SaaS、Redis 或供应商 SDK。
- **发布门**：Idol/Gift/Homepage/Policy 均验证 immutable lifecycle、current pointer、PUBLISH/ROLLBACK、精确七语言、英文 source lineage、独立审核与 content hash；Gift 还验证有效 price book revision、适用偶像、可售 variant、库存关联；Homepage 必须绑定不同的桌面 16:9 与移动 4:5 hero。
- **媒体与公开边界**：发布与公开投影两侧均复验 READY/rights、source/derivative 尺寸与比例、AVIF/WebP/JPEG、presentation kind、alt 可见性、重复引用和排序；公开 DTO 只返回 CDN URL、尺寸、焦点及已批准本地化字段，不返回 object key、审核身份、source hash、草稿或归档内容。
- **TDD/回归**：`@fan-support/contracts` 14 files / 43 tests、`@fan-support/content` 7 files / 62 tests 全绿；覆盖 stale/tamper、错误 parent、重发 current revision、无可售 variant、缺价格/适用关系/库存/媒体/locale、Unicode/HTML 实体空白、双 hero、公开 DTO 完整性等对抗场景。
- **本地门禁**：Node `24.20.0`、pnpm `11.25.0` 下 `TURBO_FORCE=true pnpm check` 为 0 cached：typecheck 37/37、test 37/37、build 34/34；artifact freshness、Prettier、ESLint、30 个 package export 均通过；`pnpm security:secrets`、high-level audit 与 `git diff --check` 退出 0。
- **clean clone**：Git `6daea6928a69d59e999f3916c02b5e27583e2e17` 在全新 clone 完成 `pnpm install --frozen-lockfile --offline`、0-cache 完整 `pnpm check` 与 secret scan。
- **独立复核**：领域/对抗复核与隔离验收均为 ACCEPT；Blocker 0、Should 0，复跑 contracts 43/43、content 62/62、两包 typecheck/build、artifact freshness 与 `git diff --check` 全绿。
- **真实 CI**：[PR #5](https://github.com/CZ3700/diandan/pull/5) 的 [run 33707017702](https://github.com/CZ3700/diandan/actions/runs/33707017702) 中 Quality 与 Security 均成功，merge 状态 `CLEAN`。
- **证据范围**：本任务仅为纯合同、validator、projection 与 fixtures，不包含数据库 migration/repository、真实对象存储、业务 API/UI、PostgreSQL、PSP、AWS apply、staging 或 production 证据；媒体 objectKey 与真实存储绑定留给 P1-05，库存复合唯一/rollback 事务链留给 P1-04，关键政策 fallback 留给 P3-05。

## P1-03 执行卡

- **Owner / 开始时间**：Codex `/root`，2026-09-03T10:24:33+08:00。
- **范围**：在 `@fan-support/domain` 以纯 TypeScript 实现金额安全算术与快照校验、价格 revision/有效区间选择、礼物变体适用关系、库存预占/提交/释放/过期规则、支付/订单/退款/争议/履约正交状态机、确定性支付路由与幂等决策；跨模块输入输出复用 `@fan-support/contracts` 的可序列化 schema/type。
- **非目标**：不建立 PostgreSQL migration、行锁或 repository，不调用 PSP/网络/文件系统，不实现 webhook inbox/outbox、业务 API、应用层 Saga 或 UI；不根据 locale 推导 market/currency/provider，不宣称已证明数据库并发或真实支付。
- **测试先行计划**：先写失败的 example + property tests；金额覆盖 `MAX_SAFE_INTEGER` 边界和守恒，价格选择覆盖时间边界/重叠拒绝，库存覆盖守恒与非法重复迁移，状态机覆盖非法跳转/可信证据/迟到成功，路由覆盖相同输入+规则版本确定性和 attempt 已固化后不可改路，幂等覆盖同 key 同 hash 重放与不同 hash 冲突；固定 seed 并输出可复现失败信息。
- **验证计划**：受影响 domain 单元/属性测试、branch coverage ≥90%、禁止框架/ORM/PSP/网络依赖扫描、format/lint/typecheck/build、完整 0-cache `pnpm check`、secret/audit、clean-clone frozen install/check，以及独立领域/状态机/属性测试复核。
- **风险护栏**：对应 R-01/R-03/R-05/R-06；所有金额只用安全整数 minor unit；浏览器/adapter 输入视为未验证；`UNKNOWN` 不自动重扣/改路；状态跃迁显式 fail closed；库存函数只返回事务计划/结果，不伪造数据库行锁与并发保证。

### DONE 证据（2026-09-03）

- **实现**：Git `49a8756852f3083a04184a1334743622ff423636` 在 `@fan-support/contracts` 注册 32 个 internal/versioned domain-rule roots，在 `@fan-support/domain` 仅公开 17 个纯决策入口；覆盖安全整数金额/快照、价格选择、礼物适用、库存 reservation plan、幂等、版本化支付路由、支付/订单/退款/争议/履约状态机及聚合迟到支付成功计划。
- **安全边界**：所有公开 wrapper 先解析 `unknown` 并绑定持久化 subject ID/version；PSP 成功统一进入 aggregate late-success planner；退款容量绑定当前 `SUCCEEDED` capture 与完整版本集合，跨币种、跨订单/attempt、超额、`UNPAID/PENDING` 和 `REFUNDED` 非终态 mutation 均 fail closed；高权限 authority 与 provider evidence 的认证前提已进入发布后的 `.d.ts`。
- **TDD/属性测试**：金额溢出、半开价格区间、库存守恒/重放、路由确定性、幂等冲突、非法/终态跃迁、证据篡改、迟到成功、退款/争议/履约三实体绑定等均先有失败用例；固定 seed `0x5eed0103`。最终 contracts 16 files / 82 tests，domain 22 files / 160 tests；coverage statements 96.11%、branches 96.16%、functions 97.19%、lines 96.23%。
- **本地门禁**：Node `24.20.0`、pnpm `11.25.0` 下 `TURBO_FORCE=true pnpm check` 为 0 cached：typecheck 37/37、test 37/37、build 34/34；domain boundary scanner 自测 8/8 且真实扫描通过，artifact freshness、Prettier、ESLint、30 个 package export、`git diff --check`、secret scan 与官方 registry high-level audit 全绿。
- **S.U.P.E.R 10/10**：模块职责单一、纯输入→决策输出、无反向依赖/循环、跨模块 I/O 由 Zod/schemaVersion 定义并可序列化、无硬编码生产配置、新依赖已显式声明、领域实现可替换且全测通过；`domain-rules.ts`/`state-machine-commands.ts` 后续按子域拆分是非阻断维护项，本任务避免高风险重构。
- **独立复核**：领域正确性、安全与最终验收均 `ACCEPT`；最终 Blocker 0。安全复核 Should 0；验收唯一 Should 为后续大文件拆分。独立对抗覆盖退款跨币种、所有 authority、全额退款终态重放/冲突、迟到成功五类 subject、库存 identity、包子路径封锁及 malformed totality。
- **clean clone**：提交 `49a8756852f3083a04184a1334743622ff423636` 在全新 clone 完成 `pnpm install --frozen-lockfile --offline`、0-cache 完整 `pnpm check` 与 `pnpm security:secrets`；工作树干净。
- **真实 CI**：[PR #6](https://github.com/CZ3700/diandan/pull/6) 的 [run 33720394020](https://github.com/CZ3700/diandan/actions/runs/33720394020) 中 Quality 与 Security 均成功，叠加基线为 `codex/p1-02-content-contracts`，merge 状态 `CLEAN`。
- **剩余边界**：PostgreSQL migration/约束/行锁/CAS、完整退款集合的同事务读取与原子落库属于 P1-04/P1-05；webhook 验签、inbox/outbox 与 reconcile 认证属于 P1-06；本任务没有 PostgreSQL 并发、对象存储、PSP sandbox/真实小额支付、AWS apply、staging 或 production 证据。

## P1-04 执行卡

- **Owner / 开始时间**：Codex `/root`，2026-09-03T14:38:05+08:00。
- **范围**：建立版本化显式 PostgreSQL migrations 与 schema 检查，覆盖内容/首页/政策/媒体显式七语言 translation/review/locale config、商品/价格、inventory balance/ledger/reservation、cart/support intent、contact/order/refund/payment、通知 locale、inbox/outbox、履约、RBAC 和 append-only 审计；数据库 catalog 与已评审 SQL migration 为权威。
- **非目标**：不实现 Drizzle repository、业务 API/Application Saga、PSP adapter/webhook 验签、pg-boss worker、Admin/Storefront UI、真实 KMS 加解密或生产云 apply；不把 migration 测试冒充生产恢复、并发压测或真实支付证据。
- **测试先行计划**：先写可重复失败的 migration harness 与约束集成测试，证明空库迁移、最近一版回退/重前进、精确七 locale、translation `(revision, locale)` 唯一与 published 不可变、价格区间、库存余额/活动预占、单一非终态 attempt、订单金额/退款上限、关键幂等唯一键及 ledger/inbox/outbox/audit append-only；观察预期失败后再补最小 SQL。
- **验证计划**：在真实 PostgreSQL 容器执行空库 up/down/up、catalog/schema drift、事务/并发和对抗约束测试；再运行受影响包测试、format、lint、typecheck、build、完整 0-cache `pnpm check`、secret/audit、clean-clone frozen install/check，并安排迁移、交易一致性与隐私边界独立复核。
- **风险护栏**：对应 R-02/R-03/R-06/R-11/R-16/R-17；敏感留言、显示名、邮箱和履约资料只允许密文/摘要/密钥版本进入数据库，主密钥与明文禁止进入 migration、fixture、日志、队列或测试输出；金额仅安全整数 minor unit；locale 不推导 market/currency；外部副作用只留下 inbox/outbox 持久边界。

## 必须证明

- Domain 无 Next.js、NestJS、Drizzle 或供应商 SDK。
- 公共 API、对象元数据和浏览器持久化中没有留言明文或偶像地址。
- 空库迁移、库存并发、订单金额/退款上限、重复/乱序 webhook 和唯一副作用有自动测试。
- 事件、API、queue 全部有 schemaVersion。
- `SupportedLocale` 精确为 `en/zh-CN/th/vi/ja/es/pt`，locale 与 market/currency 分离；翻译唯一、不可变、source hash/stale/审核/发布门有自动测试。

## Phase 退出证据

Phase 0 已于 2026-09-03 通过退出门禁，Phase 1 已激活；P1-01、P1-02、P1-03 已完成，P1-04 为 `READY`，其余 Phase 1 退出证据尚未取得。
