# Phase 5 — 运营、退款与支付扩展边界

> 状态：ACTIVE（ADR-016，逐项本地研发；P5-01→P5-02 已按 ADR-015 完成）
> 任务：8
> 正常解锁条件：Phase 3与Phase 4退出门禁通过；当前本地依赖验收与领取顺序见ADR-016

## 目标

让内容、订单和财务人员按最小权限处理日常工作；用安全的 adapter + versioned config 支持未来支付扩展，并建立 Phase 6 可实际验证的 production-like 云基础设施。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P5-01 | DONE | Codex `/root`（Lane C 已释放） | P0-04、P1-04 | 本地 OIDC/七语 UI/真实 PG/原管理回归与最终复核通过；见下方验收 |
| P5-02 | DONE | Codex `/root`（Lane C 已释放） | P5-01、P4-05/06 | 本地订单/七语人工审核/准备送达/加密备注/可靠通知重发完整验收；见下方 |
| P5-03 | IN_PROGRESS | —（本地完整验收，Lane A 已释放） | P5-01、P4-04 已验收本地接口、P4-05 | 取消/全额部分退款/拒付/对账已本地验收；真实商户sandbox refund等外部门保留 |
| P5-04 | IN_PROGRESS | —（本地完整验收，Lane A 已释放） | P1-03 DONE；P4-04 本地输入按 ADR-016 独立核对 | 本地 capability/稳定灰度/健康/conformance 全验收；真实 PSP 条件保留 |
| P5-05 | READY | —（Lane C 空闲，尚未领取） | P5-01、P5-04 本地完整验收 | 原依赖已独立复核，共享合同/入口归属冻结；配置草稿/校验/发布/回退 |
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

尚无完整 Phase 退出证据。ADR-016 已获用户确认，P5-04/P5-03 已完整本地验收，保留真实 PSP 条件并释放 executor；P5-05原直接依赖和共享合同/文件归属已核对冻结，现按Lane C登记READY，尚未领取。其余任务继续按原直接依赖/非作者复核/Lane顺序就绪。Phase 6/7 当前仍 LOCKED，后续按 ADR-016 登记有限本地激活范围；原真实 PSP、资金、云、人工与发布门不变。

## ADR-016 当前排期登记（2026-09-22）

- 用户接受剩余20项本地研发顺序。P1-03 已 DONE；独立审计已核对 P4-04 `payment-runtime` 与 `payment-connectors` 两个本地验收及复核记录，适用于 P5-04 的能力/PG 路由/两事务/原账户恢复/通用七操作输入；不代表真实商户、USDT 专属接入或配置管理已完成。
- 当前计数：29 DONE / 2 IN_PROGRESS / 1 READY / 17 PENDING = 49。P5-04 尚无 owner，root 必须先记录开始时间、范围及失败测试/真实本地验证计划，再改代码。依赖依据和后续顺序见 ADR-016、`docs/plan/remaining-delivery.md`；历史验收不改写。
- 后继只消费已独立验收的本地完整成果；本地完成但外部待验收仍 IN_PROGRESS、无 executor。保留简单管理中心与日常原文模式；不 push、不部署、不触发真实资金或正式内容发布。

## P5-04 执行登记（2026-09-22）

- Owner：Codex `/root`，Lane A 唯一 executor；开始 `2026-09-21T17:52:46.168707+00:00`，基线 `40a57b47fee8de1e9babc7d0a66637b3251cb227`。用户已接受 ADR-016，直接依赖的本地适用范围已独立核对；不领取其他任务。
- 范围：复用已验收能力/确定性选路/规则版本，补 PG 权威健康政策、幂等观测、技术故障熔断、跨实例有界只读恢复探测，以及通用 gateway 共用认证测试。旧支付与 UNKNOWN 坚持原账户恢复；不实现 P5-05 管理发布 UI，不触发真实资金。
- 验证：独立兼容合同和 RED→GREEN；真实 PostgreSQL 并发/去重/冲突/窗口/过期 lease/迟到结果/路由资格与既有支付恢复，实际 HTTP/TLS payment 回归；受影响测试→format/lint/typecheck/build→非作者复核/S.U.P.E.R，统一最后质量门。
- 同任务分工：root 合同/整合/回归；health_storage 0033 与持久层；health_runtime 应用健康观察与 API 生命周期；remaining_task_audit 通用 adapter 认证测试。均不独立领取其他 Task。
- 保护：已保存 5717 个原未跟踪文件及 2347 个源文件 SHA 清单到 `output/checks/p5-04-payment-health/`；旧迁移/合同根不可修改，不 push/merge/部署。当前 29 DONE / 3 IN_PROGRESS / 17 PENDING = 49，部分通过不标 DONE。

### P5-04 最终本地验收（2026-09-22）

- 本地完整范围通过独立复核与 S.U.P.E.R 10 项；正式 PSP 能力/认证条件保留，Task 仍 IN_PROGRESS、无 executor，Lane A 释放。下一项 P5-03 READY；P5-05 本地依赖已齐，但共享合同/文件归属冻结后才按 Lane C 登记就绪。29 DONE / 3 IN_PROGRESS / 1 READY / 16 PENDING =49。
- 交付：不可变 PG 健康策略、幂等观测与固定窗口、技术故障隔离、跨实例安全 GET_CAPABILITIES 探测；账户/政策/代际/上下文栅栏；默认3秒总健康I/O预算与每轮单账户初始化。稳定双桶部分比例在应用/PG准入/deferred guard分别重算，关闭新渠道不影响已有 UNKNOWN 原账户/原键恢复。
- 复用既有能力、规则版本和永久回执；通用 gateway 经真实 CA 校验 TLS TEST 上游通过共用15场景及五种不合规注入。没有操作真实资金、商户配置或新增支付代码上传；P5-05 管理发布、政策热激活与目录传播尚未实现。
- Node 24.20.0/pnpm11.25.0：最终 check:dev format/lint、types63/63、tests63/63、build36/36（缓存62/62/35）；这是任务图数量。contracts85files/497tests、domain25/183、gateway9/106；实际健康PG85、灰度8224断言/4099组TS↔PG、34迁移/189表往返、rollback-prefix33tests通过。
- 最后健康 HTTP 5869=5761准备+108专项；灰度 HTTP 6071=5761+310专项，含合法新0比例publication与旧UNKNOWN恢复、双PG防绕过和单安全probe；只有1次PSPcreate，未重复创建。两API在同Node、独立pool/lifecycle，PSP独立进程，不冒充部署级多进程或真实商户。
- 原支付生产构建与七语390×844/1440×900回归7077=5761准备+1316协议/浏览器；31cases、71PNG、57axe，0违规/incomplete/页面错误，键盘/减弱动态/空状态/错误与语言冻结通过。root实际查阅中文手机和英文桌面截图；没有实体手机或人工读屏结论。
- 原12个fixture tests、39条SQL PREPARE/46断言、10 action guard、真实PG正常trigger七语配置发布、合同/adapter/artifact32exports/CI/runtime/observability/manifest、frozen install/high audit/秘密扫描通过。未声称整条pnpm check或所有仓库PG/S3脚本通过。
- 兼容：新增14根，总659；645旧根/OpenAPI/64旧SQL/32旧manifest条目不变；2380源输入最终SHA `e866fd6218c2f6b655e5fca37201f12e7a96dadcd60e1fb0af27e63b5b3b34a5`；原5717未跟踪逐SHA不变且未暂存。保留真实RED、旧导出断言、PG锁超时、部分比例上下文、发布fixture23505/23514与adapter边界原失败；最终均复验闭合，没有放宽保护。
- 证据与命令：`output/checks/p5-04-payment-health/final-verification.md`、`final-gates.json`、`final-independent-review.md`；原.log本地保持，Git文本副本仅规范化行尾/尾随空白，双SHA见`log-transcripts.json`。复验入口`docs/runbooks/payment-health-local.md`。
- 后继依赖：独立审查选取P5-01当前23文件与原验收相同；P4-05相关39文件与P5-02最新验收相同；P4-04通用接口变化由本轮完整回归承接。详见`next-stage-readiness.md`，其历史待验收条件已由最终复核闭合。先领取P5-03，不同时领取P5-05。
- 剩余门：批准PSP/商户、真实sandbox/小额、USDT专属映射、正式Secret/政策/七语关键译审、多进程/staging、P3人工/真机/素材及云/发布门。P5-04外部解除条件由经营主体提供商户与批准接口后在P4-04/本任务补验；不把本地结果标正式DONE。仅本地提交，不push/merge/部署。

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

## P5-02 执行登记（2026-09-19）

- Owner：Codex `/root`，Lane C 唯一 executor；开始 `2026-09-18T18:20:38.678610+00:00`；基线 `aa922bc`，分支 `codex/p5-02-order-operations`。P5-01/P4-05/P4-06 全 DONE；按用户确认的 ADR-015 领取本地 P5-02，其他任务不领取。
- 范围：同一简单管理中心的订单列表/详情、按需私密留言读取与七语/未知/低置信度人工审核、准备与送达、追加内部备注和受审计的最新状态通知重发；权限来自平台数据库，所有写入有幂等、版本与审计。
- 实施顺序：复核已有订单/履约/通知约束 → 先冻结独立兼容合同和失败测试 → 并行持久化、应用/接口与管理 UI → 真实 PostgreSQL/HTTP/worker/浏览器闭环 → 非作者复核与本地提交。root 统一共享合同、迁移序号与最后整合门。
- 边界：历史订单快照保持；四类礼物仍由工作室转交艺人，礼物类型与库存策略独立；解密前审计、事务外 KMS、返回前重验权限。Manager 异常操作仅明确白名单，不跳过付款/审核/终态；人工重发不重置历史 SENT 或绕过原通知唯一性。
- 验证：RED→GREEN 合同/应用/仓储测试、真实 PG 并发/双击/失权/过期/事务回滚、未知或低置信度语言不可自动批准、未审核不可履约、通知失败不回滚状态与重发幂等；format/lint/typecheck/build、七语 390×844/1440×900、键盘/错误/reduced-motion、2 分钟操作演练、隐私 canary 与 S.U.P.E.R 10 项。
- 保护：初始 tracked tree clean；原 4824 个未跟踪文件 SHA 清单在 `output/checks/p5-02-order-operations/preexisting-untracked.json`。不改历史迁移/已冻结 schema roots，不 push/merge/部署/真实收款/真实邮件。P3 性能与人工、P4 商户、生产身份/邮件与正式 UAT 门保持。
- 当前计数：28 DONE / 3 IN_PROGRESS / 18 PENDING = 49；局部检查点不得标 P5-02 DONE。

### P5-02 本地候选进入复核（2026-09-21）

- 12 个订单操作、同一管理中心七语 UI、独立权限、私密审核、逐件准备/送达、加密内部备注和独立通知重发已实现。root 继续占用 Lane C 至最后验收结束。
- 非作者复核已修复授权与退出登录的反向锁，真实退出并发 6 项、订单 PostgreSQL 5960、重发 PostgreSQL/TLS/worker 6085、原自动通知 6814 检查通过。原管理中心回归 7377 检查通过（1513 浏览器 assertions、98 PNG/axe、0 违规，既有照片文字 1 项 incomplete 留给 P3 人工门）。
- 保留并修复浏览器脚本 DNS/响应生命周期/搜索重试等待问题；最终浏览器与全仓质量门继续验证。额外原 PostgreSQL 全回归遇旧 0029 head 夹具断言，正在在保留空数据/审计拒退保护前提下补齐 0030–0032。所有原失败保留，不把局部通过视为 DONE。
- 28 DONE / 2 IN_PROGRESS / 1 REVIEW / 18 PENDING = 49；未解锁其余 P5 或后继 Phase，仅本地开发。

### P5-02 最终本地验收（2026-09-21）

- 结论：本地范围 DONE；非作者复核 ACCEPT，S.U.P.E.R 1–10 PASS。Lane C 释放，29 DONE / 2 IN_PROGRESS / 18 PENDING = 49。ADR-015 白名单 P5-01→P5-02 已闭合，其余 P5、Phase 6/7 未解锁；不领取其他任务。
- 交付：同一管理中心的 12 个订单操作、列表/搜索/筛选/分页、历史详情、按需私密读取与七语/未知语言人工审核、逐件准备/送达、加密内部备注、独立 outbox 通知重发。Manager 暂停/恢复需权限、原因、确认，不能绕过付款/库存/审核；按单准备与有限库存均验证。
- 命令统一前缀 `mise exec node@24.20.0 --`，pnpm 11.25.0。受影响测试先 RED 后 GREEN；`node packages/persistence-postgres/scripts/admin-orders-integration.mjs` 5960 checks、`admin-notification-resend-integration.mjs` 6085 checks，均 sourceUnchanged=true；实际退出/订单并发 6 checks、8 条 SQL PREPARE 通过。
- `node apps/api/scripts/admin-orders-http.mjs --ui` 第六轮 exit 0：7113 checks、419 浏览器 assertions/8 场景/32 PNG/32 axe，全部七语 390×844/1440×900、键盘/reduced-motion/错误重试/私密内容清理/审核/准备/送达/备注/重发/Manager 操作通过，零违规/incomplete/页面错误/观察失败。合成数据自动操作路径小于 120 秒，不冒充真人阅读或实体手机验收。
- 原 `pnpm verify:management-center` exit 0：7377 checks、1513 browser assertions/98 PNG/axe、7 上传/10 操作/70 公开页面，零违规/页面或观察错误；原照片叠字 1 项 incomplete 保留 P3 人工门。原自动通知 6814、旧购物车 6030、编辑 5924、结账 7414、支付 runtime 6562、付款入账 6827 完整实际回归全部 exit 0。
- 新 0031/0032 与 catalog：32 migrations / 186 tables 往返通过；原持久层整条回归在旧 0029 版本夹具失败，补丁只在严格无新数据/审计的已知前缀下使用原 down 保护。其余 20 条原脚本后缀全 exit 0，28 项新增保护 tests/独立复验通过；五个 commerce proof 实际 PG RED 后，五条完整 HTTP GREEN。保留旧失败与复跑记录，不宣称原单条整仓 `pnpm check` 全绿。
- 最终 `pnpm check:dev` exit 0：format/lint、typecheck 63/63（59 cached）、test 63/63（60 cached）、build 36/36（34 cached）；这是任务图数量。合同新鲜度、adapter/artifact、frozen install、官方 registry high audit、最终秘密扫描和暂存差异检查通过。
- 兼容/保护：旧 624 合同根、96 paths、180 OpenAPI schemas 结构一致；60 旧 SQL 字节与 30 旧 manifest entries 保持。2346 最终源输入 SHA `9e5a27e3a618bce062e10b645aecd822d855e5f461781422048ca3f5c9b057c1` 与文件集合保持；原 4824 未跟踪逐 SHA 不变且未暂存。
- 修复及限制如实记录：SQL 参数域类型、浏览器 DNS/异步清理/分页与搜索等待、授权/退出反向锁、人工 UNKNOWN 与自动通知排序、旧测试版本假设。历史 UNKNOWN 持续禁止新的人工重发；截止后继续的是后续自动通知，人工调查/解除不在本阶段。Worker 每队列 limit、两队列共 2×limit。
- 证据：`output/checks/p5-02-order-operations/final-verification.md`、`final-gates.json`、`reviews.md`、`failure-history.md`；可重复运维入口 `docs/runbooks/admin-order-operations.md`。原 `.log` 本地保留，Git 文本副本及 SHA 见 `logs/` / `log-transcripts.json`。
- 剩余正式门：P3 性能/人工可访问性、真实商户/小额支付、正式 IdP/MFA/恢复、正式邮件/人工译审、实体手机、云/staging/灰度。不推送、不 merge、不部署、不真实收款或发信，仅本地提交。下一入口回到 P3-06 未完验收，P4-04 商户资料门继续保留。

## P5-03 执行登记（2026-09-22）

- Owner：Codex `/root`，Lane A 唯一 executor；开始 `2026-09-21T19:46:44Z`，基线 `17b7230195879bbb480fa343975574759b84d789`，分支 `codex/p5-03-refund-operations`。直接依赖 P5-01/P4-05 与 P4-04 本地七操作/可信证据已在 P5-04 最终非作者报告接受，当前源与该提交一致。用户继续授权 ADR-016，本轮只领取 P5-03。
- 范围：现有简单管理中心内 Manager 取消、全额/逐项部分退款、拒付与统一对账；PG 权威金额占用、永久幂等命令、固定原账户的退款/取消 Saga、可信事件关联及 UNKNOWN 恢复；七语言易用界面。P5-05 配置发布与 P5-06 通用异常中心另排。
- 验证计划：合同与失败测试先行；纯 Domain/应用单测、实际 PG 并发/金额边界/重复键/乱序事件、HTTP/TLS TEST PSP 完整往返、七语言 390×844/1440×900 的浏览器键盘/错误/reduced motion；受影响回归、format/lint/typecheck/build、秘密扫描、旧根合同/迁移/未跟踪文件保护、非作者复核及 S.U.P.E.R 十项。
- 已验收本地不代表真实 PSP sandbox refund、实际商户事件/退款政策、真实资金、staging 或生产发布；本轮只本地提交，不 push。

### P5-03 最终本地验收（2026-09-22）

- 结论：本地完整实现、非作者交叉复核与S.U.P.E.R十项通过；真实商户sandbox refund/正式政策与资金条件未闭合，Task仍IN_PROGRESS、无executor，Lane A释放。P5-05原直接依赖P5-01/P5-04本地验收及当前源已独立核对，共享contracts、API/BFF、管理中心入口归属冻结，Lane C空闲，登记READY但不在本轮领取。29 DONE / 4 IN_PROGRESS / 1 READY / 15 PENDING =49；Phase6/7仍LOCKED。
- 交付：同一管理中心全额/逐项部分退款、未付款取消、拒付与分页对账。永久命令回执、版本/权限/MFA/原因/确认、原账户Saga、并发金额占用、可信金融证据及原生交易去重；UNKNOWN不重派退款。原付款成功保持，退款/拒付独立投影；未结退款与OPEN/LOST拒付阻止准备、送达和恢复。刷新/断线只恢复原幂等请求，浏览器不保存凭据或私密粉丝内容。
- 验证：实际金融PG6023（5763准备+259专项+1源一致性）、35迁移/193表往返、rollback-prefix40tests、原订单管理5960/付款入账6827；TEST PSP20tests、OIDC75tests、最终fixture16tests通过。原未分类过期断言首失败和专项复验如实保留。
- 最终真实HTTP/UI：`integration-2026-09-21T21-48-01.614Z` exit0，6742=5763准备+979场景，HTTP399、浏览器9cases/330assertions/58PNG/58axe；七语390×844/1440×900、键盘/reduced-motion/错误/只读/连续部分金额/恢复/取消/拒付完整原矩阵通过，0违规/0incomplete/0页面错误。root查阅中文手机与英文桌面最终截图；使用原生临时PG18.6、本地TLS IdP/S3/独立持久TEST PSP、Next dev/LOCAL_OIDC；生产build另验，不冒充实体手机或人工译审。
- 环境失败保留：Docker/Colima guest墙钟同SQL回退约0.2秒；CPU0长测仍回退，未以增加等待或401重试掩盖。独立原生PG3860万样本0回退，三种真实cluster正常/失败清理通过，再跑完整原UI；生产认证、TTL、历史0030约束不改。guest具体校时进程仍未归因，staging时钟门保留。本轮TEST teardown与本机工具准备失败/修复均有记录。
- 统一门：Node24.20.0/pnpm11.25.0，最终`check:dev` format/lint、types63/tests63/build36（缓存60/61/35）通过；contracts504tests、domain196/branch94.88%、Admin191tests；合同新鲜度/locale归属、33adapter checker tests、层边界、32exports、秘密扫描与暂存差异通过。未声称整条`pnpm check`、全部历史PG/S3脚本或远端CI通过。
- 保护：659旧合同根/108旧路径与旧OpenAPI组件、68旧SQL/34旧manifest条目不变；2462最终源清单SHA `502f627cc26f86474afed91d04ed14cfb2faf0f549c73cba292e46db5c5d1420`，浏览器退出后文件集合/字节保持；5719原未跟踪逐SHA不变且未暂存。最终临时PG/Next已清理，Next声明恢复。
- 证据：`output/checks/p5-03-refund-operations/final-verification.md`、`final-gates.json`、三份交叉review、`storage-auth-clock-review.md`、`accepted-browser-artifacts.json`和`failure-history.md`；命令日志原件本地保留，Git文本副本仅规范化行尾/尾随空白，双方SHA见`transcript-manifest.json`。日常操作/复验入口`docs/runbooks/admin-finance-local.md`。
- 后续：P5-05配置草稿/校验/差异/二次确认/发布/一分钟回退与多实例传播，继续简单管理中心；不把TEST SQL发布夹具当已实现管理功能。真实PSP事件映射/sandbox refund、小额资金、正式政策/关键七语译审、正式身份/密钥、实体手机、staging/灰度/上线门保留。本轮只本地提交，不push/merge/部署。
