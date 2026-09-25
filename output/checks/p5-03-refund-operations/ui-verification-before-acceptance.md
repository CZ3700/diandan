# P5-03 Admin UI 验证记录

作者：`/root/refund_admin_audit`，2026-09-22。范围为管理中心资金面板、统一对账列表、七语文案、BFF 映射和真实浏览器脚本；不提交、不推送、不执行真实资金。最终浏览器证据尚待闭合，不能据本文件标记完整 PASS。

## 实现

- 保持一个管理中心，在现有订单详情提供余额、全额剩余退款、逐项金额、原因/确认、未付取消及原请求核对；对账入口复用同一订单详情。只使用服务端 canManage/canCancel，拒付 OPEN/LOST 不提供新退款。
- 严格分配原币种 minor units，显示已成功退款和仅处理中的占用金额；UNKNOWN/待核对保留占用并暂停礼物准备与送达。
- 金融变更先把严格序列化命令保存到按真实 actorId/orderId 隔离的 tab sessionStorage，保留原 idempotencyKey 和 expectedVersion。断网/响应丢失、刷新和语言重载恢复同一命令；存储不可用封闭写操作，不存会话/CSRF/私密粉丝文本。
- 核对/取消/退款触发后将键盘焦点移至确认表单，使用 instant 滚动尊重 reduced motion。七语固定版本/hash manifest 为 DRAFT，reviewer 和 approvedCommit 均 null。
- 复用现有 BFF 的固定 URL、session/CSRF/no-store 行为，不新增自定义身份接口。

## 实际验证

命令均以前缀 `mise exec node@24.20.0 --` 运行。

| 命令/证据 | 结果 |
| --- | --- |
| `corepack pnpm --filter @fan-support/admin test` | 50 文件 / 191 测试 PASS，`ui-tests.log` |
| `corepack pnpm --filter @fan-support/admin typecheck` | PASS，`ui-typecheck.log` |
| owned modules/BFF/browser `corepack pnpm exec eslint ...` | PASS，`ui-lint.log`；browser 诊断增量后再次 PASS |
| owned files `corepack pnpm exec prettier --check ...` | PASS，`ui-format.log` |
| `node scripts/check-contracts.mjs` | PASS，`ui-contracts-gate.log` |
| 真实 PG/TLS OIDC/TEST PSP + 七语 Chrome | 由 runtime owner 统一调度，当前首次登录失败保留，尚不计 PASS |

失败测试及门禁记录保留：`ui-red.log`（初始模块/route 缺失）、`ui-view-red.log`、`ui-reload-red.log`、`ui-canonical-retry-red.log`（首发与恢复 canonical 字节）、`ui-dispute-red.log`、`ui-balance-red.log`。相应模型/BFF/渲染/存储测试随后通过。root 的 `contracts-gate.log` 曾因非权威完整 locale map 拒绝；改为现有 exhaustive switch 与 manifest 数组条目，未削弱 checker。

## 流程与复核范围

应用项目开发、TDD、系统调试、Playwright、code-simplifier、完成前验证 skill；浏览器复用仓库现有 runner，未引入新测试平台。代码收敛将只读退款/付款/拒付记录拆成 records.tsx，风险确认与命令执行各保留单一职责。

`apps/admin/AGENTS.md` 和安装版本 Next 的 use-client、server/client-components、route-handlers 文档是在 root 提醒后补读，并非写代码前已读。补读后逐项复核：window/sessionStorage 仅在 effect 中访问；函数 props 仅沿 client graph；没有新增 Next routing API；使用现有 POST BFF。此过程偏差保留，不将其改写为事先符合。

独立合同/领域/port 复核见 `ui-independent-contract-review.md`。其中 focused finance domain 13 测试通过但未满足整个包 coverage 门；随后完整 domain 26 文件/196 测试通过，分支 94.88%，`ui-independent-domain-review.log`。没有降低 coverage 阈值。

P5-05 仅只读核对，见 `ui-next-stage-readiness.md` 和 104 个选择文件 SHA 比较，不实施下一 Task。

## 剩余范围

需真实浏览器完成七语 390×844/1440×900、键盘、错误、reduced motion、角色只读、断响应刷新恢复原命令、原 UNKNOWN 核对、两种取消、拒付提示；需 root 独立截图复核及统一门禁。所有当前 API/PSP 结果仅本地真实 PG/TLS TEST，上线仍保留商户 sandbox/真实小额、正式身份配置、关键译文人工批准、真机/读屏与 staging/发布门。

## 后续协调的持久层职责收敛

root 另委派 `admin-finance-apply.ts` 拆分：保留 coordinator，payment/refund/dispute 各自应用及订单投影抽到四个内部 helper。没有改变公开API、SQL、锁顺序或业务条件；所有显式 FOR UPDATE、order/attempt 锁仍由 coordinator 获取，payment.apply 后取消用 coordinator callback 在原时点重锁。`ui-apply-preservation.json` 记录 16 个 SQL 模板逐字 multiset 相同，所有显式锁仅在 coordinator。`ui-apply-before.ts.txt` 保留拆分前源。PG package typecheck 与五个文件 eslint PASS，后续完整 PG/build/catalog 由 persistence owner 统一执行；未把静态保留检查视为并发运行证明。

## 实际浏览器发现的修复

`integration-2026-09-21T20-43-04.674Z/browser-finance/results.json` 真实完成七语双端矩阵、七语 Order Operator 只读与错误态，共 50 PNG/axe，零违规；随后连续输入第二项部分退款金额超时，errors 明确 PAGE_ERROR，因此本轮整体 FAIL 保留。源码确认 onChange 在延迟 setInputs updater 内读 event.currentTarget；新 `input-events.test.tsx` 取得真实组件两个 input handler，模拟事件结束后 currentTarget=null，再执行延迟 updater，RED 报 Cannot read properties of null。修复只同步捕获输入字符串后进入 updater，GREEN；完整 Admin 50 文件/191 测试通过，typecheck通过。新增测试最初的 type-import lint 失败已按项目规则修复。

视觉复核泰语手机、葡语桌面发现同一礼物送不同艺人时退款输入原仅显示 gift.title。现使用不可变订单快照生成本地化行序号 · 礼物名 · 艺人名，不含粉丝姓名；browser 强化两个实际 aria-label 非空且不同，连续填写后各值保留。相关 handler/finance/orders 3 文件6测试、两文件 format/lint 通过；最终实浏览器复跑待 root 统一构建后进行。

已检查截图（此轮为失败轮，作为布局/修复依据不充当最终PASS）：
- `/Users/mario/Desktop/下单/output/checks/p5-03-finance/integration-2026-09-21T20-43-04.674Z/browser-finance/th-390-refund-partial.png`
- `/Users/mario/Desktop/下单/output/checks/p5-03-finance/integration-2026-09-21T20-43-04.674Z/browser-finance/pt-1440-reconciliation.png`

## 关键文案与 S.U.P.E.R 范围核对

七语 `copy-*.ts` 使用相同 key 集合；`review-manifest.ts` 固定 `admin-finance-v1`、sourceHash 和各 translationHash，tests 逐字校验，均 DRAFT/reviewer=null/approvedCommit=null。关键组包括：原账户退款 `refundHint`、仅退剩余金额 `full`、逐项余额/总额与 `invalid`、`confirm`/原因、仅未付取消 `cancelHint`、UNKNOWN 原请求恢复 `uncertain`/`retrySame`、占款及暂停准备/送达 `pendingHint`、OPEN/LOST 拒付 `disputeHold`、浏览器恢复存储不可用封闭提交 `storageUnavailable`。这份清单是作者核对，不是独立人工译审。

| S.U.P.E.R | 作者范围核对 |
| --- | --- |
| 1 职责 | UI client/model/view/pending store/record/list 分离；apply coordinator 与各证据分支拆分 |
| 2 复杂度 | 金额解析/分配、风险确认、网络执行及持久恢复分别管理，未以减少行数牺牲金融约束 |
| 3 分层 | Browser→固定BFF→Application→Domain/Port→PG；UI不直接访问DB/PSP |
| 4 依赖 | 无新增第三方依赖、无新增反向调用；root全仓adapter门已PASS |
| 5 合同 | finance 独立 Zod/schemaVersion，旧 Orders API不扩写；roots兼容由root统一验证 |
| 6 序列化 | pending command 严格schema、原key/版本；不储存凭据、支付工具或私密粉丝字段 |
| 7 配置 | 金额币种从订单快照，权限从canManage/canCancel，locale使用唯一owner导入；无生产参数硬编码 |
| 8 成本 | 复用现有UI/BFF/session/Playwright/axe与PG/TLS TEST夹具 |
| 9 替换边界 | finance API client 与已部署provider端口隔离；UI没有特定PSP假设 |
| 10 验证 | Admin191/类型/格式/lint通过；真实浏览器发现延迟事件bug已RED→GREEN单测，最终实浏览器重跑待闭合，当前此项不标完整PASS |

## 20:56 功能闭环与最后视觉/axe修复

本人实际解析 `integration-2026-09-21T20-56-52.540Z/browser-finance/results.json`：status PASS，9 cases、330 assertions 全部通过、58 screenshots / 58 axe、0页面错误、0 violations；全部真实连续输入/原key丢响应刷新恢复/部分后剩余全额/UNKNOWN占用与核对/取消有attempt及无attempt/拒付只读说明完成。`ui-browser-summary-pre-padding.json` 保留精确结果。仍有14条 incomplete，全部为新增订单/对账切换 div 的 `aria-prohibited-attr`（有aria-label而无role），不能写0 incomplete。

同轮前的 `integration-2026-09-21T20-51-43.199Z` 在七语只读第2语言 Orders搜索出现一次401并超时，errors为空。只读确认TTL3600秒、无fixture调时、普通BFF401不清cookie；runtime增加安全cookie存在性/DB期限/授权诊断后，20:56完整同产品功能候选通过。原失败保留，不宣称已证明任意未来环境无会话时序问题，也没有延长TTL、放宽RBAC或删除断言。

最后收口仅两处：`finance.css` 的 undefined `--space-5` 改已存在 `--space-6`（桌面内边距，手机保持 `--space-4`）；切换容器加 `role="group"` 正确支持其 accessible name。本次实际检查所有 CSS var，11个引用均有定义，`ui-token-audit-final.json`；修复前仅space-5缺失的报告 `ui-token-audit.json` 保留。两文件format、workspace/finance lint通过，等待root修后生产构建及最后实浏览器复验。这是样式/语义修正，未修改合同/支付行为/断言。
