# P5-02 管理中心订单运营 — 本地验收

状态：本地范围 PASS / P5-02 DONE。全部功能、质量、回归与最终秘密扫描 exit 0，非作者复核 ACCEPT。本文件不代表生产发布。

## 交付范围

在同一管理中心增加订单列表、搜索/筛选/分页、历史订单详情、按需私密留言与署名读取、七语及未知/低置信度人工审核、逐件准备和送达、加密内部备注、最新状态通知重发。内容管理原入口保持；Manager 的暂停/恢复要求专门权限、原因和确认，不能绕过付款、库存或审核。

所有写入按版本、幂等键和不可变审计约束；备注使用独立 KMS 目的域。私密内容先提交读取审计，事务外解密，返回前再确认当前权限与版本。退出登录的锁序与订单授权一致。人工重发使用独立记录与持久 outbox，原 SENT 和通知历史保持。

## 已完成验证

命令以 `mise exec node@24.20.0 --` 开始；pnpm 为 11.25.0。检查数含各自合成数据准备，不可把不同套件相加称为独立单元测试数。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 受影响合同/Application/API/BFF/UI/KMS/仓储/Worker | 先 RED 后 GREEN，随后全仓测试任务通过 | 定向日志、`failure-history.md`、`reviews.md` |
| 订单 SQL 参数 | 8 条实际 PostgreSQL PREPARE 通过 | `admin-orders-parameters.mjs` |
| 当前/全部退出与订单授权并发 | 6 项通过，无 40P01，等待授权失败关闭 | `persistence/auth-locks-2026-09-21T11-05-56.881Z.json` |
| 真实 PostgreSQL 订单 | 5960 检查，sourceUnchanged=true | `persistence/run-2026-09-21T11-06-00.978Z/` |
| 真实 PostgreSQL/TLS/Worker 人工通知重发 | 6085 检查，sourceUnchanged=true | `notification-resends/run-2026-09-21T11-08-01.216Z/` |
| 原自动通知完整回归 | 6814 检查，sourceUnchanged=true | `regressions/automatic-notifications-run.json`、`automatic-notifications-protocol.json` |
| 真实 HTTP + 七语管理订单浏览器 | 7113 检查；419 浏览器 assertions、8 场景、32 PNG/axe；零违规、incomplete、页面/观察错误；浏览器关闭 | `integration-2026-09-21T11-17-52.495Z/` |
| 原管理中心内容回归 | 7377 检查；1513 浏览器 assertions、98 PNG/axe；7 上传、10 操作、70 公开页面；零违规/页面错误/观察失败 | `regressions/management-validation.json`、`management-browser.json` |
| 迁移往返和当前 catalog | 32 migrations / 186 tables，exit 0 | `migrations-catalog-final.log` |
| 浏览器工具保护 | 4/4 持久 Node 测试通过，已串入浏览器命令 | `browser-tools-final.log` |
| 空迁移前缀兼容保护 | 28/28 含真实 PG 通过，独立复验通过，已串入 test:postgres | `rollback-prefix-green.log`、`notification-rollback-prefix-review.log` |
| 合同生成、adapter boundary、build artifacts | exit 0；生成物新鲜，32 公开出口验证通过 | `contracts-final.log`、`adapter-boundaries-final.log`、`artifacts-final.log` |
| frozen install / high dependency audit | exit 0；官方 npm registry 无已知漏洞 | `frozen-install.log`、`dependency-audit-official.log` |

浏览器使用真实 Chrome、390×844 和 1440×900、全部七语言，覆盖键盘、reduced motion、图片加载、错误重试、迟到私密响应、私密面板焦点、重复操作、加密备注、通知重发与 Manager 确认。固定合成留言的自动运营路径小于 120 秒；不是实际工作人员阅读/译审计时。截图只记录关闭私密面板后的页面。原内容回归保留既有照片叠字的 1 项 color-contrast incomplete，仍归 P3 人工验收。

最终 `check-dev-final-4.log` exit 0：format/lint，typecheck 63/63 tasks（59 cached）、test 63/63 tasks（60 cached）、build 36/36 tasks（34 cached）。这些是任务图节点数，含缓存，不是单测数量。最终质量门前后 2346 源输入 SHA `9e5a27e3a618bce062e10b645aecd822d855e5f461781422048ca3f5c9b057c1` 与集合保持。第六轮浏览器以后只修验证夹具，产品源码未变。

额外 `pnpm --filter @fan-support/persistence-postgres test:postgres` 的前缀通过迁移、约束、事务、webhook 时间和真实可靠事件（含 114622ms 并发/重试）。原命令在旧目录回退夹具 hardcoded 0029 处 exit 1；补丁保留空表、所有新审计、版本白名单及原 down 约束，剩余 20 条原命令按显式后缀全部通过（20/20 exit 0，276778ms）；中间旧 content-draft/event-time helper 的版本断言也已按精确 head 修复，失败快照保留。保留原失败，不宣称单条完整 `pnpm check` 或原整条 PG 命令全绿。

此外真实 PostgreSQL 对五个原 commerce proof 逐一复现 0032≠0029 RED；仅把已知空前缀保护后的恢复版本改为精确进入版本。原数据存在、55000 拒退、历史 SHA 和金额/支付不可变断言保持。完整实际 HTTP GREEN：购物车 6030、编辑 5924、结账 7414、支付 runtime 6562、付款入账 6827 检查，均 exit 0，无新增浏览器。详见 `regressions/` 与对应日志。

日志的 Git 保留副本位于 `logs/<日志名>.txt`；原 `.log` 本地保留并受统一生成物忽略规则管理；文本副本仅去掉行尾空白，原/副本 SHA 见 `log-transcripts.json`。

## 兼容、保护与复核

- 相对 `aa922bc`：旧 624 合同根结构一致，新增 21 根；旧 96 paths、180 schemas、8 security schemes、2 headers 结构一致；旧 30 manifest entries 和 60 SQL 字节不变。详见 `compatibility-final.json`。
- 原 4824 个未跟踪文件逐 SHA 核对保持，见 `preexisting-final-check.json`。没有回滚或加入这些用户已有文件。
- 非作者分别复核 Application/API/合同/KMS、持久化、通知、BFF/UI、回退夹具；发现的问题均有修复和回归。见 `reviews.md`、`notification-resend-handoff.md`。
- 小范围代码简化已完成：保持边界校验，复用私密面板焦点 hook，不引入新业务依赖。

## S.U.P.E.R

| # | 检查 | 结果 |
| --- | --- | --- |
| 1 | 文件职责单一，列表/私读/授权/规则/写入/通知分离 | PASS |
| 2 | 函数按读取、判断、事务与外部调用分工 | PASS |
| 3 | Browser→BFF/API→Application→Port→Adapter | PASS |
| 4 | 无反向依赖或新增循环，边界检查通过 | PASS |
| 5 | 跨模块对象有 Zod/schemaVersion 合同 | PASS |
| 6 | I/O 可序列化，普通与私密 DTO 明确分离 | PASS |
| 7 | 生产地址/密钥/身份/权限由配置或数据库注入 | PASS |
| 8 | 无新增外部依赖，锁文件不变 | PASS |
| 9 | PG/KMS/通知/身份实现通过 ports 和 composition 注入 | PASS |
| 10 | 最终相关测试与质量、集成门 | PASS |

## 剩余正式门禁与运营限制

- 本地 TLS OIDC/TEST PSP/合成数据只证明实现；正式 IdP/MFA/账号恢复、真实商户和小额支付、正式邮件与人工译审、P3 性能/人工可访问性、实体手机、云/staging/灰度仍按原计划验收。
- 历史未确认 UNKNOWN 会持续阻止新人工重发；接受截止后可继续的是较新自动状态。没有人工清空 UNKNOWN 或财务操作入口，后续调查/对账不在 P5-02 内。
- Worker 每次对自动和人工两个队列分别扫描 limit，总上限为 2×limit；平台提交顺序不等于邮箱最终收件顺序。
- ADR-015 只授权本地 P5-01→P5-02；其余 P5 与 Phase 6/7 未解锁。只本地提交，不 push、merge、部署、真实收款或发信。

操作与重跑入口：`docs/runbooks/admin-order-operations.md`。下一工作应回到 P3-06 未完性能/人工验收，并保留 P4-04 真实商户资料与验收门。

## 后续维护提示

新增 migration 后，同时检查 TEST 回退前缀的已知版本/所有新表和审计空数据保护，恢复断言绑定本次进入或正常迁移返回的精确版本；不要把历史版本常量当作永久 head。Node ESM 诊断工具也需显式导入 `node:url` / `node:perf_hooks` 并经过全仓 lint。异步浏览器事件必须捕获、脱敏和 drain，不能依靠旧 DOM 存在判断网络恢复已完成。

最终 `pnpm security:secrets` exit 0，暂存内容排除全部原 4824 未跟踪文件；`git diff --cached --check` 通过。完成前未推送或部署。整体任务计数更新为 29 DONE / 2 IN_PROGRESS / 18 PENDING = 49，Lane C 释放。
