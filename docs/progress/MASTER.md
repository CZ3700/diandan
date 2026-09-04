# Progress Master

> 最后更新：2026-09-04
> 当前里程碑：M2 品牌样板（M1 可信内核已完成）
> 当前 ACTIVE Phase：Phase 2
> 当前任务：无（P2-03 已完成并释放 Lane B）
> 下一可领取任务：`P2-04`（READY，Lane B）

## 1. 开工入口

执行代理按顺序读取：

1. `docs/FAN_SUPPORT_PLATFORM_SPEC.md`
2. 本文件
3. 候选任务所在的 `ACTIVE` phase 文件（当前为 `docs/progress/phase-2-design-system.md`）
4. `docs/plan/task-breakdown.md` 中准备领取的 Task ID
5. `.agents/skills/fan-support-platform-dev/SKILL.md`

只领取位于 `ACTIVE` Phase、依赖已完成、状态为 `READY` 且对应 Lane 无 executor 的一个任务；P2-03 已通过真实 PR 根因修复 head `f6e19c9` 的 Quality/Security 并释放 Lane B，当前唯一可领取任务为 `P2-04`。

## 2. 总体状态

| 状态 | 数量 |
|:--|--:|
| PENDING | 34 |
| READY | 1 |
| IN_PROGRESS | 0 |
| BLOCKED | 0 |
| REVIEW | 0 |
| DONE | 14 |
| DEFERRED | 0 |
| **总计** | **49** |

## 3. Phase 索引

| Phase | 任务 | 状态 | 进度文件 | 退出门禁 |
|:--|--:|:--|:--|:--|
| 0 基线与骨架 | 5 | CLOSED | `phase-0-baseline.md` | CI、四应用骨架、preview、trace、生产基础设施选型 |
| 1 合同与领域 | 6 | CLOSED | `phase-1-contracts.md` | domain/catalog/pricing/inventory/migration/webhook |
| 2 设计系统 | 6 | ACTIVE | `phase-2-design-system.md` | 品牌样板、视觉、axe、设备性能 |
| 3 自研 Admin、内容与浏览前台 | 6 | LOCKED | `phase-3-storefront.md` | 七语言自研后台、真实内容、发布、SEO/cache、性能 |
| 4 购买闭环 | 6 | LOCKED | `phase-4-commerce.md` | 七语言测试支付、订单 locale、查单、通知 |
| 5 运营与支付 | 8 | LOCKED | `phase-5-operations-payments.md` | RBAC、退款、配置回退、重放、production-like staging |
| 6 加固与恢复 | 6 | LOCKED | `phase-6-hardening.md` | Release Gate 技术证据 |
| 7 上线与灰度 | 6 | LOCKED | `phase-7-launch.md` | 正式签署、灰度、复盘 |

`LOCKED` 表示尚未满足 Phase 依赖，不代表需求未定义。Phase 状态是硬门禁：即使任务级依赖已完成，`LOCKED` phase 中的任务也不得领取。

### Phase 解锁矩阵

| 已通过的退出门禁 | 改为 ACTIVE | 同时必须关闭 |
|:--|:--|:--|
| 初始状态 | Phase 0 | — |
| Phase 0 | Phase 1、Phase 2 | Phase 0 |
| Phase 1 与 Phase 2 | Phase 3 | Phase 1、Phase 2 |
| Phase 3 | Phase 4 | Phase 3 |
| Phase 4 | Phase 5 | Phase 4 |
| Phase 5 | Phase 6 | Phase 5 |
| Phase 6 | Phase 7 | Phase 6 |

除 Phase 1 与 Phase 2 外，不允许两个 Phase 同时为 `ACTIVE`。协调者还必须执行“每个 Lane 同时最多一个 executor”的并行门禁。

## 4. 决策状态

| 决策 | 状态 | 最晚门禁 | 记录 |
|:--|:--|:--|:--|
| 品牌名/Logo/正式字体/摄影授权 | OPEN | Phase 2 人工批准 | 待建 ADR |
| 生产区域/容器平台/PostgreSQL/对象存储/CDN/WAF | ACCEPTED | Phase 0 已关闭 | ADR-007：`us-east-1` AWS 单云 origin；Akamai 为未来 edge 候选 |
| 经营主体/KYC/收款账户 | OPEN | Phase 4 真实支付 | 待建运营决策 |
| 管理员 OIDC/MFA/账号恢复 | OPEN | Phase 5 UAT | 待建 ADR |
| 英文主语言与首发 locale：`en/zh-CN/th/vi/ja/es/pt` | ACCEPTED | 已冻结，Phase 0/1 起执行 | ADR-006 |
| 首发国家/币种/支付方式 | OPEN | Phase 3 路由冻结 | 待建 ADR |
| 礼物法律属性/税务/退款政策 | OPEN | Phase 4 UAT | 待建法律/运营决策 |
| 履约 SLA/客服承诺 | OPEN | Phase 3 内容冻结 | 待建运营决策 |
| 邮件、观测、备份供应商 | OPEN | Phase 4/6 | 待建 ADR |

这些 OPEN 项不阻塞下一任务 P2-04，但执行者不得自行把 sandbox 假设写成生产结论。

## 5. 最新证据

已有 P0-01 工具链/边界骨架与 P0-03 配置边界的真实 clean-clone、独立验收证据；P0-02 的本地门禁、真实 GitHub PR CI、必需检查与平台 secret protection 均已取得可回读证据。P0-04 已取得本地四应用 UI、四个 OCI 镜像、PostgreSQL/S3-compatible TLS preview、clean-clone、独立验收与真实 PR 必需检查证据。P0-05 已取得本地 request/trace、日志隐私、故障/关闭、浏览器、clean-clone 与真实 PR 必需检查证据并标记 DONE。P1-01 已取得 v1 合同、确定性 artifact、clean-clone、对抗复核与真实 PR 必需检查证据并标记 DONE。P1-02 已取得自研内容/商品/价格/库存/媒体/政策合同、七语言发布门、公开投影、clean-clone、对抗复核与真实 PR 必需检查证据并标记 DONE。P1-03 已取得纯 domain 合同/实现、本地与 clean-clone 0-cache 门禁、三路独立 ACCEPT 及真实 PR Quality/Security，已标记 DONE。P1-04 已取得 6 个 versioned migration/108 表 catalog、真实 PG18 空库与带数据升降级、并发/隐私/authority/append-only 对抗约束、clean clone、两路独立 ACCEPT 及真实 PR Quality/Security，已标记 DONE。P1-05 已取得七类 versioned ports/conformance、PostgreSQL repositories/transactions、S3-compatible media、CloudFront purge、KMS、TEST-only fake adapters、9 migrations/108 tables、真实 PG/S3 TLS、浏览器、fresh clean-clone、独立终审与 [PR #8](https://github.com/CZ3700/diandan/pull/8) 的真实 Quality/Security，任务已标记 `DONE`。P1-06 已取得 raw-body 验签、durable receipt、inbox/outbox、ID-only pg-boss retry/DLQ、Worker trace 恢复、真实事务并发/回滚、fresh clean-clone、独立终审与 [PR #9](https://github.com/CZ3700/diandan/pull/9) 的真实 Quality/Security，任务已标记 `DONE`，Phase 1 `CLOSED`。P2-01 已取得共享 design tokens、五类按 script/locale 分包的自托管字体、对比安全 accent、响应式主题/网格、六视口/320/真实 200% zoom/键盘/reduced-motion、fresh clean-clone、独立终验与 [PR #10](https://github.com/CZ3700/diandan/pull/10) 的真实 Quality/Security，任务已标记 `DONE`；P2-02 已取得八类原语、精确 server/client/CSS 出口、13 场景/6 axe/3 环境 gate/15 截图、真实 Media decode fallback、Chrome 原生 200% zoom、fresh clean-clone、独立终验与 [PR #11](https://github.com/CZ3700/diandan/pull/11) 的真实 Quality/Security，任务已标记 `DONE`。P2-03 已取得 source-owned overlay/menu/toast、独立 Language/Region、locale URL/cookie adapter、13 场景/8 axe/15 截图/原生 200% zoom、fresh clean-clone、官方 high audit、两路独立 ACCEPT 及 [PR #12](https://github.com/CZ3700/diandan/pull/12) [run 33874955057](https://github.com/CZ3700/diandan/actions/runs/33874955057) 的根因修复 head 真实 Quality/Security，任务已标记 `DONE` 并释放 Lane B；P2-04 现为唯一 `READY` 任务。Phase 2 仍为唯一 `ACTIVE` Phase，Phase 3 继续等待其退出门禁。ADR-007 已关闭生产基础设施**选型**门并补入 P5-08 IaC/staging 任务；这些仍都不是 AWS apply、staging、生产、恢复或发布证据。

| 日期 | Task | 类型 | 证据 | 结论 |
|:--|:--|:--|:--|:--|
| 2026-09-02 | SPEC | 规划 | `docs/FAN_SUPPORT_PLATFORM_SPEC.md`、ADR-004、ADR-005、ADR-006 | 2.1.0 已锁定全源码自研、七语言 URL/内容/订单/SEO、原子购物车/intent、支付与门禁 |
| 2026-09-02 | ARCH | 可视化 | `docs/fan-support-platform-architecture.drawio` | 已同步 Storefront/Admin/API/Worker、PostgreSQL 真相源与可替换外部 Port |
| 2026-09-02 | RESEARCH | 浏览器研究 | `research/` | 只作为参考站背景，不等于本项目实现 |
| 2026-09-02 | P0-01 | 实现/测试/验收 | Git `9234e368e193e967e9e2abd39858f4f3eaf01da9`、`package.json`、`pnpm-lock.yaml`、`apps/`、`packages/`、`scripts/check-*.mjs`、`phase-0-baseline.md` | 两次真实 clean clone、frozen install、完整 check、Git 对象与凭据复扫全绿；独立评审 ACCEPT，任务 DONE |
| 2026-09-03 | P0-02 | CI/安全门禁 | Git `88efe390c86c8b8e58b371fa196a9ae62c65de99`、[PR #1](https://github.com/CZ3700/diandan/pull/1)、[run 33661119143](https://github.com/CZ3700/diandan/actions/runs/33661119143)、`.github/workflows/ci.yml`、`scripts/check-ci.mjs`、`scripts/scan-secrets.mjs` | 本地/clean clone 与 11 组对抗 fixture 通过；真实 PR 的 Quality/Security 成功；`main` 严格必需两检查、管理员受约束、禁止强推/删除；GitHub secret scanning/push protection 已开启，任务 DONE |
| 2026-09-03 | P0-03 | 配置/安全边界 | Git `ba8b8864605e7181a85f2ffc13ca52087e0726e4`、`.env.example`、`packages/config/` | 四层优先级、按 fragment 最小读取、fail-closed、公开 allowlist 与脱敏错误完成；77 tests、42 条独立攻击、0-cached clean clone 全绿，三路复核 ACCEPT，任务 DONE |
| 2026-09-03 | P0-04 | 运行时/OCI/浏览器 | Git `d4008a9ce35432d609dbfa9639b16f68ef481ed4`、[PR #2](https://github.com/CZ3700/diandan/pull/2)、[run 33672018920](https://github.com/CZ3700/diandan/actions/runs/33672018920)、`infra/`、`output/playwright/p0-04/` | Next storefront/admin、Nest+Fastify API/worker、PostgreSQL、经临时 CA 的 S3-compatible TLS preview 与四独立 OCI image 完成；真实 build/7 healthy/SigV4/browser/clean clone/Quality/Security 全绿，三路复核 ACCEPT，任务 DONE |
| 2026-09-03 | P0-05 | 可观测/故障/运维 | Git `c337db999fc45f629b5bdfc7dbd9b766ff1c0c8d`、[PR #3](https://github.com/CZ3700/diandan/pull/3)、[run 33685203128](https://github.com/CZ3700/diandan/actions/runs/33685203128)、`packages/observability/`、`output/playwright/p0-05/` | canonical request ID、W3C trace、结构化 allowlist 日志、OTel lifecycle、安全错误边界与排障 README 完成；真实 preview、clean clone 0-cache、Quality/Security 与四路复核全绿，任务 DONE；无 cloud exporter/生产发布结论 |
| 2026-09-03 | INFRA | 决策/Phase 门禁 | ADR-007、AWS/Akamai 官方能力与价格资料、`P5-08` | 选择 `us-east-1` AWS 单云 origin（ECS Fargate/RDS PostgreSQL Multi-AZ/S3/CloudFront/WAF），保留 Akamai edge 退出路径；Phase 0 CLOSED，Phase 1/2 ACTIVE；尚无 cloud apply 或恢复证据 |
| 2026-09-03 | P1-01 | v1 跨模块合同 | Git `4695a4121131f664d5b70ce9b77f21dc50bf25cf`、[PR #4](https://github.com/CZ3700/diandan/pull/4)、[run 33693878714](https://github.com/CZ3700/diandan/actions/runs/33693878714)、`packages/contracts/` | 34 个 versioned/embedded-policy 合同、JSON Schema/OpenAPI components、七语言唯一 owner、隐私/金额/早到 webhook/兼容门禁完成；clean clone 0-cache、Quality/Security 与三路复核全绿，任务 DONE；API paths 与 provider authenticity 留给对应后续任务 |
| 2026-09-03 | P1-02 | 内容/发布合同 | Git `6daea6928a69d59e999f3916c02b5e27583e2e17`、[PR #5](https://github.com/CZ3700/diandan/pull/5)、[run 33707017702](https://github.com/CZ3700/diandan/actions/runs/33707017702)、`packages/content/`、`packages/contracts/src/content.ts` | 自研内容/商品/价格/库存/媒体/政策模型、精确七语言审核与发布门、双 hero、严格公开投影和虚构 fixtures 完成；clean clone 0-cache、Quality/Security 与两路复核全绿，任务 DONE；DB/repository/真实存储与云发布不在本任务证据范围 |
| 2026-09-03 | P1-03 | 纯领域规则 | Git `49a8756852f3083a04184a1334743622ff423636`、[PR #6](https://github.com/CZ3700/diandan/pull/6)、[run 33720394020](https://github.com/CZ3700/diandan/actions/runs/33720394020)、`packages/domain/`、`packages/contracts/src/domain-rules.ts` | 32 个 internal/versioned contract roots、17 个纯 domain 入口、160 项领域测试与 96.16% branch coverage；本地/clean clone 0-cache、secret/audit、Quality/Security 与三路复核全绿，任务 DONE；数据库并发与真实 PSP/云发布证据不在本任务范围 |
| 2026-09-03 | P1-04 | PostgreSQL schema/migrations | Git `827ada4d2e7f821307c761addec65864aedf1a74`、[PR #7](https://github.com/CZ3700/diandan/pull/7)、[run 33739482625](https://github.com/CZ3700/diandan/actions/runs/33739482625)、`database/`、`packages/persistence-postgres/` | 6 个迁移/108 表、空库与带数据 up/down/up、并发/authority/隐私/webhook/append-only 对抗约束完成；clean clone 0-cache、secret/audit、Quality/Security 与两路独立终验全绿，任务 DONE；repository、真实 KMS/PSP/AWS/staging/PITR/production 不在本任务证据范围 |
| 2026-09-04 | P1-05 | Ports/repositories/adapters | Git `233d11b922df485f4e448ad71cf11612a9a1f77d`、[PR #8](https://github.com/CZ3700/diandan/pull/8)、[run 33785418111](https://github.com/CZ3700/diandan/actions/runs/33785418111)、`packages/*-port/`、`packages/persistence-postgres/`、`packages/media-s3/` | 七类 versioned port/conformance、事务/repository、真实 PG18 与 TLS S3-compatible 集成、CloudFront/KMS/TEST-only fake 完成；fresh clean clone、secret/audit、Quality/Security 与独立终审全绿，任务 DONE；真实供应商/AWS apply/staging/production 与 webhook worker 不在本任务范围 |
| 2026-09-04 | P1-06 | Webhook/inbox/outbox/worker | Git `02ee10846a3b960e6f0d7bceb0b2d269f972a0aa`、[PR #9](https://github.com/CZ3700/diandan/pull/9)、[run 33808236380](https://github.com/CZ3700/diandan/actions/runs/33808236380)、`packages/contracts/`、`packages/application/`、`packages/persistence-postgres/`、`apps/api/`、`apps/worker/` | raw-body 先验签、加密 durable receipt、inbox/outbox、pg-boss 6-attempt/DLQ、queue trace 恢复及真实 PG 原子并发/回滚完成；fresh clean clone、secret/audit、Quality/Security 与独立终审全绿，任务 DONE、Phase 1 CLOSED；真实 PSP/KMS、业务状态推进、AWS/staging/production 不在本任务范围 |
| 2026-09-04 | P2-01 | Design tokens/fonts/theme/grid | Git `f578208fc05822426bc3d83e362f35ebe29460ee`、[PR #10](https://github.com/CZ3700/diandan/pull/10)、[run 33821542072](https://github.com/CZ3700/diandan/actions/runs/33821542072)、`packages/design-tokens/`、`output/playwright/p2-01/` | schemaVersion 1 tokens/CSS、五类 locale 字体分包/OFL、对比安全 accent、preview-only specimen 与 21 项静态门禁完成；六视口/320/真实 Chrome 200% zoom/键盘/reduce、fresh clean clone、secret/audit、Quality/Security 与独立终验全绿，任务 DONE；正式品牌、axe/读屏、全脚本全条件与真实设备性能仍属后续门禁 |
| 2026-09-04 | P2-02 | UI primitives/accessibility | Git `9f33dad482798a58e108d0c8c0495a878cf375c7` + evidence `d40a79bd3fb93a884ffd8613c58f84902ae6ca41`、[PR #11](https://github.com/CZ3700/diandan/pull/11)、[run 33835758064](https://github.com/CZ3700/diandan/actions/runs/33835758064)、`packages/ui/`、`output/playwright/p2-02/` | 八类原语、server/client/CSS 边界、BigInt 金额、真实 Media fallback、键盘/RTL/reduce/48px/对比门禁完成；13 场景、6 axe、3 环境 gate、15/15 图片、真实 Chrome 200% zoom、fresh clean clone、high audit/secret、Quality/Security 与独立终验全绿，任务 DONE；无公开业务路由、overlay/composite、支付、staging/production 或正式品牌批准结论 |
| 2026-09-04 | P2-03 | Overlay/locale controls | Git `0f86e6c16e9f44bd3c9096e2d8d02a9a3e7aa1b8` + evidence `ef6e16a0870b5e230b796f9905649398bfce0859` + CI stabilization `f6e19c948e124436ec423e3607c889f7254b1c24`、[PR #12](https://github.com/CZ3700/diandan/pull/12)、[run 33874955057](https://github.com/CZ3700/diandan/actions/runs/33874955057)、`packages/ui/`、`apps/storefront/`、`output/playwright/p2-03/` | Dialog/Drawer/Menu/Toast/live region、独立 Language/Region、locale URL/cookie adapter 与 fail-closed 生命周期门禁完成；冷 CI 动态导入 flake 已以静态导入根因修复，未放宽 timeout；13/13 场景、8 axe 原始结果、15/15 图片、原生 Chrome 200% zoom、本地/fresh clone/secret/high audit/两路独立终审及真实 Quality/Security 全绿，任务 DONE；未宣称真实 staging/production、AWS apply、正式品牌或真实设备性能 |

## 6. 更新规则

- 开始任务：在 phase 文件填写 owner、开始时间和计划验证，把状态改为 `IN_PROGRESS`。
- 请求评审：列出所有变更、命令与证据路径，状态改为 `REVIEW`。
- 完成任务：验收通过后改为 `DONE`；只把位于 `ACTIVE` phase、全部依赖已完成且 Lane 空闲的直接依赖改为 `READY`，并同步本文件计数。
- 阻塞任务：写明阻断事实、已尝试内容、唯一解除条件和责任人；不得只写“等待”。
- Phase 完成：附退出门禁证据，按上面的解锁矩阵关闭已完成 Phase 并激活唯一允许的后继 Phase 集合；不得仅凭任务级依赖提前激活。
- 任何计数更新都必须保证状态合计仍为 49。
