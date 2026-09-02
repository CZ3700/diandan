# Risk Assessment

> 基线日期：2026-09-02  
> 评分：概率 P 与影响 I 各 1–5，风险分 = P×I。12 以上必须在对应 Phase 退出前关闭或被明确接受。

## 1. 风险登记

| ID | 风险 | P | I | 分 | 预防/缓解 | 门禁/责任域 |
|:--|:--|--:|--:|--:|:--|:--|
| R-01 | 浏览器提供的 idol/gift/price 被信任，导致错送或低价购买 | 4 | 5 | 20 | 同一 canonical PostgreSQL 事务重验；订单保存快照 | Phase 1/4，Domain/API |
| R-02 | 粉丝留言、邮箱或偶像地址进入公共 DTO、管理导出、日志、分析、对象元数据或截图 | 4 | 5 | 20 | 加密 support_intent；字段 allowlist；敏感访问审计；PII 测试 | Phase 1/4/6，Security |
| R-03 | 回跳、重复/乱序 webhook 或支付创建超时导致重复扣款、发货、退款、通知 | 4 | 5 | 20 | 两事务幂等 attempt Saga；原始 body 验签；inbox/outbox；reconcile；状态机；重放测试 | Phase 1/4/6，Payments |
| R-04 | 将“支付适配器”误实现为可上传任意代码的运行时插件 | 3 | 5 | 15 | 代码部署接新 PSP；后台只能发布版本化规则；RBAC/审计 | Phase 5，Architecture |
| R-05 | 对外承诺全球支付，但商户主体、地区、币种或资格不支持 | 4 | 5 | 20 | capability API 只返回真实能力；决策门；真实小额验收 | Phase 4/7，Business/Finance |
| R-06 | 并发结账、调价或预占泄漏导致超卖、错价或库存漂移 | 4 | 5 | 20 | 价格 revision；inventory balance/ledger/reservation 同事务；行锁/约束；订单金额快照 | Phase 1/4，Commerce |
| R-07 | 高级动效导致移动卡顿、晕动或结账干扰 | 4 | 3 | 12 | 合成属性、reduced motion、真实设备帧率、性能预算 | Phase 2/6，Frontend |
| R-08 | 运营自由布局、错误媒体或未本地化素材破坏品牌与转化 | 4 | 3 | 12 | 结构化字段、比例/尺寸/对比/本地化 alt 校验、preview/publish/rollback | Phase 1/2/3/7，Content/Frontend |
| R-09 | 公开 token、URL 日志或连续订单号泄露订单和 PII | 3 | 5 | 15 | fragment→POST exchange→HttpOnly 会话；摘要、过期/限流、noindex、最小响应 | Phase 4/6，API |
| R-10 | 自研后台会话或支付/履约权限过宽，无审计可追溯 | 3 | 5 | 15 | OIDC、服务端 session、RBAC、MFA、二次确认、append-only audit | Phase 5/6，Admin |
| R-11 | PSP、邮件、对象存储故障或队列积压造成已付款订单未推进/未通知 | 3 | 5 | 15 | 持久 inbox/outbox、重试/DLQ、对账、backlog 告警 | Phase 4/6，Worker |
| R-12 | 正式照片、字体、Logo 或参考站素材无授权 | 3 | 5 | 15 | 资产清单与授权记录；参考站只作研究 | Phase 2/7，Product/Legal |
| R-13 | 礼物税务、退款、送达承诺或消费者权益表述错误/不同语言不一致 | 3 | 5 | 15 | 经营主体/法律审查；七语言批准门；政策、结账与邮件 revision 一致 | Phase 3/4/5/7，Legal/Operations |
| R-14 | 数据库 migration、API schema、框架或供应商 SDK 升级不兼容 | 3 | 4 | 12 | 精确锁版、expand/contract、契约测试、staging restore/rolling upgrade | 全阶段，Platform |
| R-15 | 过度工程导致 MVP 延期 | 4 | 4 | 16 | 严守非目标；模块化单体；MVP 无 Redis、无多 PSP 表演性接入 | 全阶段，Lead |
| R-16 | 无恢复证据却认为备份和回滚可用 | 3 | 5 | 15 | PITR、不可变部署、配置回退与实操演练 | Phase 6/7，SRE |
| R-17 | locale 串线、缺译/过期翻译、错误 fallback 或 locale 与市场/币种耦合，导致错语言、错价、重复 SEO 页面或错误法律文案 | 4 | 5 | 20 | 严格 SupportedLocale；locale-aware revision/cache；locale/market/currency 分离；七语言发布门；fallback noindex；SEO/E2E | Phase 1/2/3/4/5/6/7，i18n/Content/Commerce |

## 2. 必须防止的架构热点

### 2.0 S.U.P.E.R Architecture Health Summary

当前没有应用代码，不能伪造绿色健康分；基线统一为 `N/A`，Phase 0 后按真实依赖图和代码重新评级。

| 原则 | 当前 | 首个检查点 | 最高风险热点 | 目标控制 |
|:--|:--|:--|:--|:--|
| S — Single Purpose | N/A | P0-01/P1-03 | 巨型 Order/Payment service；UI、验签、邮件混合 | apps 只做入口，domain/application/adapter 拆分 |
| U — Unidirectional Flow | N/A | P0-01/P1-05 | Domain 反向依赖 Next/Nest/Drizzle/PSP；循环 import | 依赖图 CI + 无外部服务 domain tests |
| P — Ports over Implementation | N/A | P1-01/P1-05 | provider DTO、queue payload、cart token 成隐式合同 | Zod/schemaVersion + ports + conformance |
| E — Environment-Agnostic | N/A | P0-03 | 硬编码主域名/market/idol/provider；secret 泄露 | 启动 config schema、Secret Manager、日志 allowlist |
| R — Replaceable Parts | N/A | P1-05/P5-04 | PSP/对象存储/OIDC/邮件细节渗透 domain/UI | adapter 目录内替换 + fake adapter 契约测试 |

健康目标不是“所有模块抽象化”，而是在真实外部边界可替换、核心规则可独立测试，同时保持 MVP 为模块化单体。

### 2.1 巨型服务

不得建立同时处理目录查询、库存锁定、支付验签、状态迁移、邮件和 UI DTO 的 `OrderService`/`PaymentService`。用例在 application 编排，规则在 domain，供应商细节在 adapter。

### 2.2 隐式合同

不得让队列 payload、webhook 映射、cart token 或媒体处理命令只存在于调用方约定中。所有跨边界对象必须有 `schemaVersion`、schema 和 fixture。

### 2.3 敏感数据扩散

默认采用字段 allowlist 进入日志、分析、队列和 API；不能依赖“开发者记得脱敏”。错误对象、Sentry breadcrumb 和测试录像也属于泄露面。

### 2.4 环境特判

禁止在业务代码出现真实站点/主域名、偶像 ID、币种、国家或 provider 名称的生产特判。规则必须配置化并版本化。

### 2.5 不可控热更新

支付热更新只影响已部署 adapter 的规则和开关，不执行动态下载代码、不替换密钥、不修改已存在支付尝试的 provider。

### 2.6 语言与商业上下文串线

不得从 locale 推导 market、country、currency、tax 或 payment provider，也不得只按无 locale 的 path 缓存本地化内容。发布、订单快照、通知、SEO 和缓存必须携带经过 allowlist 校验的 locale；英文事故 fallback 不能伪装成已完成翻译。

## 3. 风险验收方式

- 每个任务引用相关 Risk ID，并在完成记录中给出测试或控制证据。
- 风险分下降需要证据，不因“已实现”自动归零。
- 生产前仍为 12 以上的风险必须由产品/技术/运营或法务责任人书面接受，写入 `docs/decisions/`。
- 事故或拒付暴露的新风险在 24 小时内补录，并关联修复任务与回归测试。
