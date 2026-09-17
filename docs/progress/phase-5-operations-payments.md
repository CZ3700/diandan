# Phase 5 — 运营、退款与支付扩展边界

> 状态：ACTIVE（ADR-015，仅P5-01→P5-02本地开发）
> 任务：8
> 正常解锁条件：Phase 3与Phase 4退出门禁通过；当前有限例外见ADR-015

## 目标

让内容、订单和财务人员按最小权限处理日常工作；用安全的 adapter + versioned config 支持未来支付扩展，并建立 Phase 6 可实际验证的 production-like 云基础设施。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P5-01 | DONE | Codex `/root`（Lane C 已释放） | P0-04、P1-04 | 本地 OIDC/七语 UI/真实 PG/原管理回归与最终复核通过；见下方验收 |
| P5-02 | READY | — | P5-01、P4-05/06 | Orders/七语言及低置信度 message moderation/fulfillment/notifications |
| P5-03 | PENDING | — | P5-01、P4-04/05 | Refund/cancel/dispute/reconcile |
| P5-04 | PENDING | — | P1-03、P4-04 | Capability/routing/conformance |
| P5-05 | PENDING | — | P5-01、P5-04 | 七语言 payment label/config publish/rollback |
| P5-06 | PENDING | — | P5-01、P1-06、P5-03 | Replay/DLQ/UNKNOWN queue |
| P5-07 | PENDING | — | P5-04/05/06 | New PSP runbook/fake adapter drill |
| P5-08 | PENDING | — | P0-05、P1-05、P3-06、P4-06、P5-05/06/07 | ADR-007 OpenTofu + production-like staging + immutable deployment |

## 必须证明

- 角色越权失败；高风险操作二次确认且 append-only 审计。
- 重复退款/重放不产生第二次副作用。
- 配置 60 秒内传播且一分钟内回退；已创建支付不改 provider。
- 新 PSP 需要代码部署和认证测试，运营不能上传代码。
- 不支持/低置信度语言的留言进入人工队列而不自动批准；用户可见支付名称/提示七语言完整。
- OpenTofu 可从干净环境重复建立 production-like staging；四镜像固定 digest，RDS/S3/CloudFront/WAF/KMS/IAM、预算与配额通过 smoke，production apply 仍受 Phase 7 灰度门控制。

## Phase 退出证据

仅ADR-015本地白名单已激活；尚无Phase退出证据。其余六项P5任务、Phase6/7仍不可按本例外领取。

## P5-01 历史执行登记（2026-09-18）

- Owner：Codex `/root`，Lane C唯一executor；开始2026-09-17T17:11:33Z（Asia/Bangkok为2026-09-18），基线270253c。用户确认ADR-015后，直接依赖P0-04/P1-04均DONE，唯一可READY任务已领取；root释放P3-06 Lane D。
- 范围：复用现有数据库身份/角色/权限/session与审计，接通配置化OIDC授权码+S256 PKCE、真实ID Token验签、一次性浏览器绑定登录、仅预授权平台身份准入、会话签发/失效/撤销与管理中心登录/退出。角色不从IdP声明生成；保持单一简单管理中心。
- 顺序：先冻结合同与失败测试，分文件实现adapter、持久化与application/transport；接口稳定后接现有UI，并跑真实PG/HTTP/本地TLS IdP及七语言双端。正式IdP/MFA/恢复与紧急访问仍是生产UAT决策门，内部TEST不冒充生产身份接入。
- 验证：单次state/code、错nonce/issuer/audience/签名、过期/并发/响应丢失、会话固定攻击/跨浏览器回调、CSRF、角色动态撤回、退出失效与审计不可变；受影响tests→check:dev→真实集成/浏览器→非作者复核与S.U.P.E.R。整合候选统一全仓门，不让多个agent重复重跑。
- 保护：旧合同/schema根和0001–0029迁移不改；新字段/schemaVersion兼容新增。原证据与用户未跟踪文件保留，只本地提交、不push/merge/部署。当时27DONE/3IN_PROGRESS/19PENDING=49；部分检查点通过不标P5-01 DONE，不提前领取P5-02。


### P5-01 历史合同与分工检查点（当时验收进行中）

- 冻结独立v1 `AdminAccess*` roots及persistence port；旧合同、0001–0029与TEST预置session路径兼容。新的浏览器随机HttpOnly凭据通过独立HMAC目的域派生state/nonce/PKCE，数据库只存摘要；identity subject使用独立长期pepper及issuer+原subject版本化映射。用户角色只读平台数据库。
- 当时root为Lane C唯一executor；同任务助手分文件：auth_persistence_audit负责真实OIDC adapter/真实TLS IdP测试；gift_read_measure负责0030/session仓储与真实PG；gift_read_review负责Admin BFF/简易登录退出/七语浏览器测试；root负责合同/application/config/API composition/整合与Git。没有领取其他Task。
- 真实OIDC使用固定openid-client6.8.8，显式开启ID Token签名验证、S256、nonce、issuer/client绑定、auth_time及配置化MFA证据；首版RS256、无query回调URI。开关为仅development的LOCAL_OIDC，正式环境仍关闭，未选定生产IdP。
- 已观察合同/application/API/config失败测试后实现；真实PG额外发现等待锁后TTL失效场景并先RED后修复。raw日志与本轮证据集中 `output/checks/p5-01-admin-access/`。当时全部组合/浏览器/独立复核未完成，保持IN_PROGRESS、27/3/19；现已由下方最终验收闭合。

### P5-01 最终本地验收（2026-09-18）

- 结论：本地范围 DONE，非作者复核 ACCEPT。Lane C 已释放；P5-02 的 P5-01/P4-05/P4-06 直接依赖全 DONE，按 ADR-015 转 READY。28 DONE / 2 IN_PROGRESS / 1 READY / 18 PENDING = 49，未领取其余任务。
- 交付：七语简易登录/退出、真实 OIDC/S256/ID Token 验签与新鲜 MFA、预授权平台身份、只读 canonical 角色、浏览器绑定一次性挑战、服务端 session/CSRF、当前/全部会话撤销、不可变审计；旧艺人/礼物/海报操作保持。
- 命令统一前缀 `mise exec node@24.20.0 --`。受影响 tests 先 RED 后 GREEN；真实 `node packages/persistence-postgres/scripts/postgres-admin-access.mjs` 115 checks、受影响持久化 40 tests，`node packages/persistence-postgres/scripts/postgres-integration.mjs --write-catalog` 30 migrations/175 tables 往返通过。原 stdout 如实转录在 `persistence-verification-summary.json`。
- 最终 `corepack pnpm check:dev` exit 0：全仓 format/lint、typecheck 63/63 tasks（62 cached）、test 63/63 tasks（62 cached）、build 36/36 tasks（36 cached）。合同、adapter/artifact 门、frozen install、high audit 和最终 staged secret scan 均 exit 0；没有宣称完整 `pnpm check` 或把任务图数量当单测数量。
- `node apps/api/scripts/admin-access-http.mjs --ui` exit 0，859 checks；真实 Chrome 七语 390×844/1440×900、537 assertions/21 cases/34 PNG/34 axe，错误/MFA/签名/断线/撤销/503/退出重试与键盘/reduced-motion 通过；零违规/incomplete/页面错误/观察失败/意外请求，六项资源清理通过。API/Next raw log 仅内存 canary 校验，没有持久化凭据。
- `corepack pnpm verify:management-center` 最终 exit 0，7,345 checks；7 次真实上传/10 次操作、七语 1,481 浏览器 assertions/7 cases/98 PNG/98 axe、70 个公开页面，零违规/页面错误/观察失败。既有艺人照片叠字有 1 项 color-contrast incomplete（6 nodes），保留在 P3 人工验收；不冒充交易或本轮实体手机验收。
- 先前失败及修复完整保留：等待锁后超期、session/审计不可变、测试 HMR hostname、no-referrer 原生 form 的 null Origin、导航后读取已销毁 response、旧 config 依赖断言、P3 locale fixture、旧数量/加购验收假设。未削弱 Origin/隐私/生产门禁。
- S.U.P.E.R 1–10 全 PASS；非作者分别复核 application/合同/API、持久化/迁移、OIDC adapter、BFF/UI 及旧管理验证脚本。完整记录 `output/checks/p5-01-admin-access/final-verification.md`、`final-gates.json`、`management-regression-summary.json`。
- 兼容保护：18 新 roots、606 旧 roots 与 OpenAPI 字节不变、58 旧 SQL/29 旧 manifest entries 不变；2,268 源输入 SHA `ca3403c0e8056211bdb202b24b752f4a689a05e0c92b83e485bfdd9e34c8fc98` 复查保持。原 4,633 未跟踪文件逐一重查不变。
- 剩余门：生产 IdP/MFA/账号恢复/紧急访问与 UAT、真实商户、邮件供应商/人工译审、P3 性能和人工可访问性、云/staging/灰度仍待各自任务。LOCAL_OIDC 仅 development；首版 RS256 与无 query 回调。仅本地提交，不 push/merge/部署。
- 运维入口 `docs/runbooks/admin-access-local.md`；下一任务只读交接 `output/checks/p5-01-admin-access/p5-02-handoff.md`。保持一个简单管理中心、四类礼物均由工作室转交艺人，订单备注/重发/强制变更需独立合同与最小权限，不复用内容发布授权。
