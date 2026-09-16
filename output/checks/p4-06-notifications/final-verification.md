# P4-06 本地验收

结论：**DONE（本地开发范围）**。七语言订单事务通知、可靠重试、安全查单链接和资源到期清理完成。独立评审 ACCEPT，无未闭环 P1/P2。正式邮件服务与人工译审尚未启用；此结论不替代 P3/P4 的其他验收或生产发布。

基线 `7c63148b8b2f5cf89da051c8aebc37d294171db0`，分支 `codex/p4-06-notifications`。仅本地提交，不推送或部署。Task P4-06 完成后释放 Lane D，项目为 **27 DONE /2 IN_PROGRESS /20 PENDING=49**，Phase 5 保持 LOCKED。

## 交付与关键约束

- 根据真实付款/履约事件生成付款确认、开始准备、确认送达通知；固定订单语言、历史原文、金额、不可变模板和收件身份。七语言各包含 subject/preheader/HTML/text；最多显示十个订单项并保留完整总额。21 条人工译审均为 DRAFT，生产装配拒绝未批准模板。
- PostgreSQL 保存通知状态、租约、尝试和审计；Worker 通过既有 Outbox/pg-boss 消费。重复事件不重复建通知，UNKNOWN 只重放固定网关、同 key、同正文。绝对发送截止与接收端原子去重协议均明确，不把网关 ACCEPTED 当作收件箱送达。
- 邮件 CTA 使用现有 `/:locale/order-access#token=…&order=…`，fragment 在交换前清除。只保存 keyed digest，收件邮箱经审计后瞬时解密。渲染先于链接轮换；checkout bootstrap 独立于邮件 LINK，不让付款浏览器使邮件链接失效。
- 到期清理按既有锁序重验真实数据库事实，逐车事务隔离。修复 UNKNOWN 的过期资源被认证查询重新开放支付入口的问题；提交时再次检查截止，可信迟到成功仍入账 PAID，库存不足为 ON_HOLD。
- 新迁移 0029 保护通知、访问和清理历史；旧 0001–0028 SQL 不改。旧回退测试增加严格空历史前置并正常回退 0029，保留原拒退门。CI Quality 预算从 30 调为 45 分钟，原检查项不删，Security 仍为 20 分钟。

## 实际证据

命令均使用锁定环境 `mise exec node@24.20.0 -- corepack pnpm …`；完整 argv、UTC 时间和退出码保存在各 `*-result.json`。单测 RED 与修复轨迹见各子目录说明及原始本地 `.log`，没有覆盖失败日志。

| 范围 | 实际结果 | 证据 |
|:--|:--|:--|
| 新通知 PG/TLS/真实 Worker/实际生成 CTA | 6814 断言 PASS（5763 准备 +1050 协议 +1 输入一致性）；独立接收器进程重启、丢 HTTP 回应、并发与去重截止通过 | `persistence/run-2026-09-16T03-30-06.970Z/run-result.json`、`protocol-results.json` |
| 实际邮件 CTA → 生产构建 Next 查单页 | 390×844、1440×900，4 PNG；键盘、reduced motion、可见精确金额、安全会话通过；2 axe 均零 violations/incomplete | 同 run 的 `notification-link-browser/report.json`；root 与非作者复核截图 |
| 七语言三事件模板 | 44 浏览器场景/842 断言，44 axe 零 violations/incomplete；包括两个 500 项订单摘要场景 | `templates/browser-2026-09-16T02-27-19-394Z/report.json`；i18n 44 单测 |
| UNKNOWN 恢复与 SQL 提交时截止 | 实际 PG 5843 断言 PASS，过期后不再开放 action，后来可信成功仍入账 | `../p4-06-commerce-expiry/action-2026-09-16T03-26-33.604Z/run-result.json` |
| 资源清理与 webhook/CREATE 竞争 | 实际 PG 6105 断言 PASS，11 cases；原两种 webhook 锁顺序、序列化重试和支付在途保护通过 | `../p4-06-commerce-expiry/run-2026-09-16T03-27-47.921Z/run-result.json` |
| 原迁移/PG/API/TLS S3 | 29 迁移/174 表；原整合链、cart 5924、checkout 7405、payment runtime 6562、入账 6827、查单 6860、媒体恢复 423 均通过 | `check-full-3.log` 及对应运行产物 |
| 原共享浏览器证据 | 原 P2-04/P2-05 collector 各 30.864/41.460 秒 exit0，18/22 PNG；最终输入指纹复核通过 | `ui-composites-final-result.json`、`ui-motion-final-result.json`、`manifest-followup-2-result.json` |
| 原质量后缀 | 46.254 秒 exit0；format/lint、types 62/62、tests 62/62、build 36/36、边界与 32 实际 Node 导出通过 | `quality-tail-2-result.json`、`quality-tail-2.log` |
| secret scan / high dependency audit | 26.561 /0.693 秒 exit0 | `secrets-after-regression-result.json`、`dependency-audit-result.json` |

共享浏览器报告中既存 moderate、incomplete 和人工/真机门仍保留；不能将新通知模板的 axe 零问题扩展为全站人工可访问性已通过。准备/送达事件由测试在真实已付款订单上按数据库约束写入，未实施 P5 运营流程或真实物品送达。TEST 接收器仅持久化接收回执，不执行 SMTP。

## 完整门的准确范围

`gate-coverage.json` 从当前 root check 逐项派生：22 个顶层步骤，只展开 root PostgreSQL 的 21 项及 S3 的 2 项，共 **43 项**。全部有分段通过证据，**没有一条完整 `pnpm check` exit0**。

1. `check-full`：25.097 秒 exit1，旧 SQL AST 提取器缺少 `restoresNonterminal`。修正为实际 PREPARE 两个分支，45 断言/38 SQL 通过；见 `payment-parameters-branches-fix.md`。
2. `check-full-2`：174.870 秒 exit1，旧回退夹具仍断言0028。仅更新当前头与空0029前缀，原历史保护不变；见 `migration-compatibility/evidence.md`。
3. `check-full-3`：2220.017 秒 exit1，实际集成和前三项质量门通过后，未改动的 `translation-transfer-repository.test.ts` 首次动态 import 测试超过原 5000ms，所属包 639/640 通过。原文件独立重跑两项测试，0.899 秒 exit0；未改源或放宽超时。确切根因仍未确定。
4. 首次 `quality-tail` 是输出目录包装脚本缺少执行 PATH，0.011 秒 exit127，保留原报告。改用 `pnpm exec sh` 后逐字执行原七项后缀，`quality-tail-2` 46.254 秒 exit0。类型 62/62 cache，测试 59/62 cache，构建 32/36 cache；不称冷缓存或实际远程 CI 通过。

检查三运行期间，通知测试构建前置由 API/Worker 扩为包括完整 Storefront 依赖闭包；最终 28 项构建的实际执行在通知夹具之前，dry-run 清单见 `notification-build-prerequisites-2.json`。Next admin dev 生成的两条 next-env import 已归档且仅精确恢复原字节，见 `admin-next-env-restoration.json`。这两个中途变化明确保留，不能将最终冻结相同称为全程零漂移。

最终 **2190 个实现输入**（含 CI）的集合及字节一致：`source-final-frozen-2.json`、`source-after-full.json`、`source-final.json`，SHA256 **`fdfeb7436391fd492f5484f0cd1b769755ee8f6f27a4b5b1e372f061de26db91`**。文档与 output 不属于该实现摘要。兼容检查：573 个旧合同根、96 个 API 路径/180 组件、56 个旧 SQL 与 **2413 个初始未跟踪文件**保持不变；当前合同606。没有升级第三方依赖版本，锁文件只含任务所需 workspace 链接和已固定版本声明。

## S.U.P.E.R 与独立复核

| # | 检查 | 结果与依据 |
|:--|:--|:--|
| 1 | 每模块单一责任 | PASS：合同、编排、模板、网关、持久状态/访问/到期分离。 |
| 2 | 函数职责单一 | PASS：source/claim/render/recipient/link/confirm/send/finish 各有边界。 |
| 3 | 单向依赖 | PASS：Worker → Application → Port → Adapter；Application 不访问 SQL/provider DTO。 |
| 4 | 无新循环依赖 | PASS：原工作区、领域/适配器门、构建和独立源码核对。 |
| 5 | 显式 schema 合同 | PASS：33 个兼容新增合同、Zod/schemaVersion；旧公开契约保持。 |
| 6 | I/O 可序列化 | PASS：持久命令/事件使用 JSON，日期/金额有明确形式；运行凭据只在装配边界。 |
| 7 | 环境配置外置 | PASS：站点、origin、profile、密钥版本通过配置；全部活动/保留凭据启动验证并冻结。 |
| 8 | 依赖显式声明 | PASS：workspace 依赖、完整测试构建前置、frozen install 与类型/运行导出通过。 |
| 9 | 可替换适配器 | PASS：通知/持久化/密钥/模板端口隔离；网关协议要求与供应商验收单独记录。 |
| 10 | 改动后测试通过 | PASS（分段证据）：实际整合与原完整质量后缀通过；原旧测试偶发5秒超时未隐藏。 |

非作者报告：`root-independent-review.md`（启动凭据 P2 已修复并独立闭环）、`notification-independent-review.md`、`template-provider-independent-review.md` 与最终 `final-independent-review.md`。模板作者的最终截图/证据复核不冒充模板源码非作者批准；模板与网关有另一评审者的独立报告。复杂实现做了范围内职责收敛，未借机重构旧模块。

## 剩余风险与续作

正式发信供应商/域名、SPF/DKIM/DMARC、真实收件箱/退信投诉、人工译审、云 KMS、商户 PSP/sandbox、小额支付退款、staging/生产、物理手机与读屏仍未验收；当前模板不能生产启用。一般 SMTP 不保证此网关所要求的原子去重与绝对截止，需要具体接收端合同及实测。

原动态 import 并发时延的偶发超时仍待后续定位。既有 P3 性能/人工验收与 P4-04 商户门保留，Phase 5 不自动解锁。下一入口是这些未完验收；本任务只释放 Lane D。

运行/故障处理入口为 `docs/operations/order-notifications.md`：旧 profile/template/KMS 版本保留、UNKNOWN 同命令恢复、失败告警、链接轮换、清理锁序、历史拒退及真实供应商接入边界。重复测试应先用受影响包与实际集成，完整门失败后精确保留原失败和同源补验，不能改超时或删除历史掩盖失败。
