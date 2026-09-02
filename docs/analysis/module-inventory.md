# Module Inventory

> 状态：规划基线，当前尚无实现代码。  
> 更新规则：每完成一个 Phase，在本文件补充真实路径、所有者和验证命令。

## 1. 当前仓库资产

| 资产 | 当前状态 | 作用 | 是否权威 |
|:--|:--|:--|:--|
| `docs/FAN_SUPPORT_PLATFORM_SPEC.md` | 已建立 | 产品、设计、架构、支付、测试总约束 | 是 |
| `docs/plan/` | 已建立 | 任务依赖、里程碑和验收步骤 | 从属于总规范 |
| `docs/progress/` | 已建立 | Agent 续作与证据索引 | 状态权威 |
| `docs/双站调研与类似平台技术架构规划.md` | 已存在 | 参考站研究 | 否，仅背景 |
| `research/` | 已存在 | 截图、HTML 和技术证据 | 否，仅证据 |
| `docs/fan-support-platform-architecture.*` | 当前 | 全源码自研架构可视化；七语言细节见 ADR-006 | 否，发生冲突时以总规范为准 |
| 应用、包、迁移、测试、CI | 不存在 | Phase 0 创建 | — |

## 2. 目标应用

| 模块 | 单一职责 | 允许依赖 | 禁止依赖/泄漏 |
|:--|:--|:--|:--|
| `apps/storefront` | 七语言 SSR 浏览、自研购物车/checkout、PSP 托管认证动作、查单体验 | contracts、i18n、application client、ui | Admin API secret、ORM、供应商原始对象、locale→market 推导 |
| `apps/admin` | 自研内容/七语言审核、商品、价格、库存、订单与支付配置 UI | contracts、i18n、ui、管理 API | 直接 SQL、明文 secret、业务规则旁路 |
| `apps/api` | HTTP 入口、认证、用例装配、webhook inbox | application、adapters | UI 逻辑、框架类型进入 domain |
| `apps/worker` | outbox、通知、对账、重试、清理 | application、adapters | 无幂等的外部副作用 |

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

### 3.1 计划公开面与规模护栏

当前没有实现行数可统计。下表是拆分触发器，不是鼓励把文件写到上限；超过时必须在评审中说明为何不拆分。

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

因为尚无应用代码，五项不能用“通过”代替实际审计：

| 原则 | 当前 | 目标基线 |
|:--|:--|:--|
| Single Purpose | N/A | 每个应用、包和 adapter 单责 |
| Unidirectional Flow | N/A | Browser → Route → Application → Domain → Port → Adapter |
| Ports over Implementation | N/A | 所有外部服务先有可序列化 port |
| Environment-Agnostic | N/A | 运行环境与业务 ID 配置注入 |
| Replaceable Parts | N/A | payment/media/identity/notification/observability adapter 可替换 |

Phase 0 后第一次更新必须把 N/A 改为真实路径与证据，不能凭目录名称判定合规。
