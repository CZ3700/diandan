# Module Inventory

> 状态：Phase 0 可运行实现基线（更新于 2026-09-03）。
> 当前边界：四应用、配置、可观测、CI 与本地 OCI preview 已实现；业务领域、迁移和生产 adapter 仍待后续 Phase。Phase 0 退出仍受生产基础设施决策门约束。

## 1. 当前仓库资产

| 资产 | 当前状态 | 作用 | 是否权威 |
|:--|:--|:--|:--|
| `docs/FAN_SUPPORT_PLATFORM_SPEC.md` | 已建立 | 产品、设计、架构、支付、测试总约束 | 是 |
| `docs/plan/` | 已建立 | 任务依赖、里程碑和验收步骤 | 从属于总规范 |
| `docs/progress/` | 已建立 | Agent 续作与证据索引 | 状态权威 |
| `docs/双站调研与类似平台技术架构规划.md` | 已存在 | 参考站研究 | 否，仅背景 |
| `research/` | 已存在 | 截图、HTML 和技术证据 | 否，仅证据 |
| `docs/fan-support-platform-architecture.*` | 当前 | 全源码自研架构可视化；七语言细节见 ADR-006 | 否，发生冲突时以总规范为准 |
| `apps/` | 已建立 | 四个可独立运行、构建和封装的应用骨架 | 源码权威 |
| `packages/` | 已建立 30 个包 | `config`、`observability` 已有真实实现；其余主要为后续 Phase 的边界骨架 | 源码权威 |
| `.github/workflows/ci.yml`、`scripts/check-*.mjs` | 已建立 | 可重复的质量、安全、运行时和可观测门禁 | 源码权威 |
| `infra/`、`scripts/runtime-preview.mjs` | 已建立 | 本地七容器 OCI preview、临时 TLS 与故障注入 | 仅本地验证边界 |
| migrations / 业务模型 | 未实现 | Phase 1 起创建 | — |

## 2. 目标应用

| 模块 | 单一职责 | 允许依赖 | 禁止依赖/泄漏 |
|:--|:--|:--|:--|
| `apps/storefront` | 七语言 SSR 浏览、自研购物车/checkout、PSP 托管认证动作、查单体验 | contracts、i18n、application client、ui | Admin API secret、ORM、供应商原始对象、locale→market 推导 |
| `apps/admin` | 自研内容/七语言审核、商品、价格、库存、订单与支付配置 UI | contracts、i18n、ui、管理 API | 直接 SQL、明文 secret、业务规则旁路 |
| `apps/api` | HTTP 入口、认证、用例装配、webhook inbox | application、adapters | UI 逻辑、框架类型进入 domain |
| `apps/worker` | outbox、通知、对账、重试、清理 | application、adapters | 无幂等的外部副作用 |

### 2.1 Phase 0 真实应用基线

| 路径 | 当前已实现 | 当前依赖边界 | 验证入口 |
|:--|:--|:--|:--|
| `apps/storefront` | Next standalone、health、request ID proxy、Node instrumentation、安全错误边界、preview-only Storefront→API 诊断路由 | `@fan-support/config`、`@fan-support/observability`；无数据库或业务领域直连 | 包测试、`pnpm check`、`pnpm preview:verify`、Playwright 双尺寸 |
| `apps/admin` | Next standalone、health、request ID proxy、Node instrumentation、安全错误边界 | `@fan-support/config`、`@fan-support/observability`；无数据库或业务领域直连 | 包测试、`pnpm check`、`pnpm preview:verify`、Playwright 双尺寸 |
| `apps/api` | Nest/Fastify composition、health、请求/trace hook、统一安全异常边界、受控启动/致命错误/关闭 | 仅在 composition root 使用 config/observability；尚无业务 API 或 repository | socket/E2E、fatal child-process、`pnpm preview:verify` |
| `apps/worker` | Nest/Fastify runtime health、请求/trace hook、受控启动/致命错误/关闭 | 仅在 composition root 使用 config/observability；尚无 queue/outbox 处理 | socket/E2E、signal/recovery preview probe |

这些是内部英文运行时探针，不是公共七语言业务页面。目标职责仍以本节上表和总规范为准。

## 3. 目标共享包

| 包 | 单一职责 | 关键验收 |
|:--|:--|:--|
| `domain` | 纯实体、规则、状态机、值对象 | 无网络/DB/framework 单元测试 |
| `application` | 用例编排、事务/Saga 边界 | 只依赖 ports 与 domain |
| `contracts` | Zod、JSON Schema、OpenAPI、事件 envelope；唯一拥有 SupportedLocale schema/type/constants | schemaVersion、七值/default/native names、无重复 locale 常量与兼容性测试 |
| `i18n` | 导入 contracts；七语言 ICU 消息目录、加载、格式化与 fallback 展示 | key/参数/plural 编译一致；不重定义 locale/market/currency |
| `catalog` | 偶像、礼物、适用关系与发布规则 | 纯领域测试与 revision 约束 |
| `pricing` | 市场、币种、价格簿与金额规则 | 整数金额、唯一有效价格测试 |
| `inventory` | 流水、余额、预占、提交与释放 | 并发防超卖与幂等测试 |
| `cart` | 匿名 cart、cart item、support intent | token 摘要、事务与隐私测试 |
| `orders` | checkout、订单快照、履约与退款规则 | 正交状态机测试 |
| `content` | 七语言 revision/translation、preview、审核、publish、locale cache tags | 不可变整包发布、stale/完整度和回退测试 |
| `payment-port` | 支付能力、创建、取消、退款、对账合同 | 无 PSP 类型泄漏 |
| `payment-fake` | 确定性测试 adapter | 共用 provider conformance |
| `payment-routing` | capability、规则、版本和熔断 | 相同输入确定性相同 |
| `persistence-port` | repository、transaction、inbox/outbox 合同 | application 不见 ORM |
| `persistence-postgres` | SQL、迁移、repository、pg-boss | 空库迁移与恢复测试 |
| `notification-port` / `notification-provider` | 携带订单 locale/template version 的七语言事务通知命令、结果与具体邮件 adapter | 不含供应商 SDK 类型；Outbox 只传业务 ID；fallback 告警 |
| `media-port` / `media-s3` | 签名上传、对象引用与媒体处理 adapter | 二进制与业务元数据分离 |
| `identity-port` / `identity-oidc` | 管理身份验证与 claims 映射 | 平台数据库拥有 RBAC |
| `cache-purge-port` / `cache-purge-cdn` | 精确失效已发布内容与媒体缓存 | 失败可重试；不影响数据库发布证据 |
| `key-management-port` / `key-management-kms` | envelope encryption、密钥版本引用与具体 KMS adapter | Domain 不见 KMS SDK/主密钥；fake 与生产 adapter 共用契约测试 |
| `observability` | composition root 的 logs/metrics/traces instrumentation | 横切使用 allowlist；不被 Domain 调用 |
| `design-tokens` | 品牌与语义令牌 | 无散落品牌常量 |
| `ui` | 可访问原语与组合组件 | 视觉/键盘/axe 通过 |
| `config` | env schema 与运行配置 | 启动时 fail closed |
| `testing` | fixture、factory、adapter conformance | 不含生产 secret/PII |

### 3.1 Phase 0 真实共享包边界

| 包 | 当前公开出口 | 已实现边界 | 状态 |
|:--|:--|:--|:--|
| `@fan-support/config` | `.`, `./public`, `./server` | 分层配置、按 fragment 最小读取、公开 allowlist、Zod 校验与脱敏失败 | 已实现 Phase 0 基线 |
| `@fan-support/observability` | `.`, `./node`, `./fastify` | versioned request/error/queue carrier、结构化日志 allowlist、W3C request context、Fastify hook、Node OTel lifecycle | 已实现 Phase 0 基线；无 cloud exporter |
| 其余 28 个包 | 根出口 | 可构建、可导入、无循环的边界骨架 | 业务实现待所属 Phase，不能按目录名视为完成 |

所有公开出口由 package `exports` 限制；Node-only OTel 和 Fastify adapter 不进入通用根出口。

### 3.2 计划公开面与规模护栏

下表仍是产品模块的拆分触发器，不是鼓励把文件写到上限。Phase 0 的 `runtime-preview.mjs` 与静态 checker 是集成编排/验收工具，已按 TLS、Docker、探针和清理函数分解；继续增长时应拆为独立 harness 模块。超过业务模块护栏时必须在评审中说明为何不拆分。

| 模块组 | 计划公开面 | 内部/外部依赖 | 单文件规模护栏 |
|:--|:--|:--|:--|
| `domain` | 实体、值对象、纯规则、状态迁移函数 | 内部：contracts type-only；外部：无 | 规则文件 SHOULD ≤250 LOC |
| `application` | use-case command/result、port 调用 | 内部：domain/ports；外部：无 SDK | use case SHOULD ≤200 LOC |
| `contracts` | Zod schema、生成 JSON Schema/OpenAPI | 内部：无业务实现；外部：Zod/生成器 | 每领域 schema SHOULD ≤250 LOC |
| `*-port` | interface、serializable DTO、错误 union | 内部：contracts；外部：无供应商 SDK | 每 port SHOULD ≤150 LOC |
| `payment-* / media-* / identity-*` | port implementation、provider mapper | 内部：port/contracts；外部：单一供应商 SDK/API | mapper/adapter SHOULD 分离且各 ≤300 LOC |
| `persistence-postgres` | repository/transaction/inbox/outbox implementation | 内部：port；外部：PostgreSQL client/pg-boss | repository SHOULD ≤300 LOC |
| `ui` | 稳定组件 props 与导出 | 内部：tokens；外部：React/a11y primitive/motion | 组件 SHOULD ≤250 LOC |
| apps | routes/controllers/composition roots | 内部：application/contracts/ui；外部：框架 runtime | controller/route SHOULD ≤200 LOC |

公开面必须通过包级 `exports` 限制，调用方不得 deep import adapter 内部 mapper、ORM model 或 provider DTO。

## 4. 计划中的领域模块

| 领域 | 输入 | 输出 | 所有权 |
|:--|:--|:--|:--|
| Catalog | `SupportedLocale`、独立 market、idol/gift handle | 带 requested/resolved/fallback provenance 的偶像与礼物 | PostgreSQL revisions/translations |
| Support Intent | idol、variant、留言、署名、幂等键 | 加密 intent + cart item | PostgreSQL |
| Checkout | 已校验购物车、价格 revision、库存预占、capability | 内部订单 + PSP next action | PostgreSQL + payment adapter |
| Payment Event | raw body、headers | 统一 ProviderEvent | adapter + inbox |
| Order | checkout + provider events | 订单与不可变行快照 | PostgreSQL |
| Fulfillment | 已付款订单、运营命令 | PREPARING/DELIVERED 事件 | PostgreSQL |
| Notification | 订单/履约事件 + 固化 locale/template revision | 可重试七语言发送结果/fallback 告警 | worker + provider |
| Payment Config | draft、规则、健康 | 已发布不可变版本 | PostgreSQL |

## 5. S.U.P.E.R 当前评估

以下只评估 Phase 0 已实现基线；尚未实现的业务包仍不按目录名判定通过：

| 原则 | 当前 | 目标基线 |
|:--|:--|:--|
| Single Purpose | PASS（Phase 0） | `config`、observability root/node/fastify、四应用 composition root 与 preview 探针分责；大型验收 harness 保留拆分观察项 |
| Unidirectional Flow | PASS（Phase 0） | 应用 → config/observability；核心合同不依赖应用，workspace 检查证明 34 units 无循环 |
| Ports over Implementation | PASS（Phase 0 范围） | 日志、安全错误、请求上下文和 queue carrier 有显式 version/schema/type 与序列化测试；业务 ports 尚未实现 |
| Environment-Agnostic | PASS（本地基线） | 运行配置经环境注入、日志 stdout、同一代码运行于宿主测试和 OCI；生产供应商仍 OPEN |
| Replaceable Parts | PASS（Phase 0 范围） | observability 通过 `.`, `./node`, `./fastify` 隔离；未来 exporter/provider 可在包内替换，应用不持有 SDK 对象 |

## 6. Phase 0 验证入口

- `mise exec node@24.20.0 -- corepack pnpm check`：workspace、CI/runtime/observability 合同、format、lint、typecheck、test、build 和 30 个 package exports。
- `mise exec node@24.20.0 -- corepack pnpm security:secrets` 与官方 registry high-level audit：secret/依赖门禁。
- `mise exec node@24.20.0 -- corepack pnpm preview:up` / `preview:verify`：四应用、PostgreSQL、对象存储、TLS、request/trace、故障和进程生命周期。
- `output/playwright/p0-04/` 与 `output/playwright/p0-05/`：本地浏览器、runtime 和 image 证据；这些不是 staging/生产或发布证明。
