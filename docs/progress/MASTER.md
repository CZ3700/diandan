# Progress Master

> 最后更新：2026-09-03
> 当前里程碑：M0 可运行基线
> 当前 ACTIVE Phase：Phase 0
> 当前任务：无 IN_PROGRESS；`P0-02`、`P0-03` 已 DONE
> 下一可领取任务：`P0-04` READY

## 1. 开工入口

执行代理按顺序读取：

1. `docs/FAN_SUPPORT_PLATFORM_SPEC.md`
2. 本文件
3. 候选任务所在的 `ACTIVE` phase 文件（当前为 `docs/progress/phase-0-baseline.md`）
4. `docs/plan/task-breakdown.md` 中准备领取的 Task ID
5. `.agents/skills/fan-support-platform-dev/SKILL.md`

只领取位于 `ACTIVE` Phase、依赖已完成、状态为 `READY` 且对应 Lane 无 executor 的任务；当前没有 executor，P0-04 的 P0-02/P0-03 依赖均已 DONE，现为 READY。

## 2. 总体状态

| 状态 | 数量 |
|:--|--:|
| PENDING | 44 |
| READY | 1 |
| IN_PROGRESS | 0 |
| BLOCKED | 0 |
| REVIEW | 0 |
| DONE | 3 |
| DEFERRED | 0 |
| **总计** | **48** |

## 3. Phase 索引

| Phase | 任务 | 状态 | 进度文件 | 退出门禁 |
|:--|--:|:--|:--|:--|
| 0 基线与骨架 | 5 | ACTIVE | `phase-0-baseline.md` | CI、四应用骨架、preview、trace |
| 1 合同与领域 | 6 | LOCKED | `phase-1-contracts.md` | domain/catalog/pricing/inventory/migration/webhook |
| 2 设计系统 | 6 | LOCKED | `phase-2-design-system.md` | 品牌样板、视觉、axe、设备性能 |
| 3 自研 Admin、内容与浏览前台 | 6 | LOCKED | `phase-3-storefront.md` | 七语言自研后台、真实内容、发布、SEO/cache、性能 |
| 4 购买闭环 | 6 | LOCKED | `phase-4-commerce.md` | 七语言测试支付、订单 locale、查单、通知 |
| 5 运营与支付 | 7 | LOCKED | `phase-5-operations-payments.md` | RBAC、退款、配置回退、重放 |
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
| 容器平台/PostgreSQL/对象存储/CDN/WAF | OPEN | Phase 0 退出 | ADR-004 已定边界，供应商待选 |
| 经营主体/KYC/收款账户 | OPEN | Phase 4 真实支付 | 待建运营决策 |
| 管理员 OIDC/MFA/账号恢复 | OPEN | Phase 5 UAT | 待建 ADR |
| 英文主语言与首发 locale：`en/zh-CN/th/vi/ja/es/pt` | ACCEPTED | 已冻结，Phase 0/1 起执行 | ADR-006 |
| 首发国家/币种/支付方式 | OPEN | Phase 3 路由冻结 | 待建 ADR |
| 礼物法律属性/税务/退款政策 | OPEN | Phase 4 UAT | 待建法律/运营决策 |
| 履约 SLA/客服承诺 | OPEN | Phase 3 内容冻结 | 待建运营决策 |
| 邮件、观测、备份供应商 | OPEN | Phase 4/6 | 待建 ADR |

这些 OPEN 项不阻塞当前 Phase 0 基线任务，但执行者不得自行把 sandbox 假设写成生产结论。

## 5. 最新证据

已有 P0-01 工具链/边界骨架与 P0-03 配置边界的真实 clean-clone、独立验收证据；P0-02 的本地门禁、真实 GitHub PR CI、必需检查与平台 secret protection 均已取得可回读证据。当前仍无 UI 或部署证据。

| 日期 | Task | 类型 | 证据 | 结论 |
|:--|:--|:--|:--|:--|
| 2026-09-02 | SPEC | 规划 | `docs/FAN_SUPPORT_PLATFORM_SPEC.md`、ADR-004、ADR-005、ADR-006 | 2.1.0 已锁定全源码自研、七语言 URL/内容/订单/SEO、原子购物车/intent、支付与门禁 |
| 2026-09-02 | ARCH | 可视化 | `docs/fan-support-platform-architecture.drawio` | 已同步 Storefront/Admin/API/Worker、PostgreSQL 真相源与可替换外部 Port |
| 2026-09-02 | RESEARCH | 浏览器研究 | `research/` | 只作为参考站背景，不等于本项目实现 |
| 2026-09-02 | P0-01 | 实现/测试/验收 | Git `9234e368e193e967e9e2abd39858f4f3eaf01da9`、`package.json`、`pnpm-lock.yaml`、`apps/`、`packages/`、`scripts/check-*.mjs`、`phase-0-baseline.md` | 两次真实 clean clone、frozen install、完整 check、Git 对象与凭据复扫全绿；独立评审 ACCEPT，任务 DONE |
| 2026-09-03 | P0-02 | CI/安全门禁 | Git `88efe390c86c8b8e58b371fa196a9ae62c65de99`、[PR #1](https://github.com/CZ3700/diandan/pull/1)、[run 33661119143](https://github.com/CZ3700/diandan/actions/runs/33661119143)、`.github/workflows/ci.yml`、`scripts/check-ci.mjs`、`scripts/scan-secrets.mjs` | 本地/clean clone 与 11 组对抗 fixture 通过；真实 PR 的 Quality/Security 成功；`main` 严格必需两检查、管理员受约束、禁止强推/删除；GitHub secret scanning/push protection 已开启，任务 DONE |
| 2026-09-03 | P0-03 | 配置/安全边界 | Git `ba8b8864605e7181a85f2ffc13ca52087e0726e4`、`.env.example`、`packages/config/` | 四层优先级、按 fragment 最小读取、fail-closed、公开 allowlist 与脱敏错误完成；77 tests、42 条独立攻击、0-cached clean clone 全绿，三路复核 ACCEPT，任务 DONE |

## 6. 更新规则

- 开始任务：在 phase 文件填写 owner、开始时间和计划验证，把状态改为 `IN_PROGRESS`。
- 请求评审：列出所有变更、命令与证据路径，状态改为 `REVIEW`。
- 完成任务：验收通过后改为 `DONE`；只把位于 `ACTIVE` phase、全部依赖已完成且 Lane 空闲的直接依赖改为 `READY`，并同步本文件计数。
- 阻塞任务：写明阻断事实、已尝试内容、唯一解除条件和责任人；不得只写“等待”。
- Phase 完成：附退出门禁证据，按上面的解锁矩阵关闭已完成 Phase 并激活唯一允许的后继 Phase 集合；不得仅凭任务级依赖提前激活。
- 任何计数更新都必须保证状态合计仍为 48。
