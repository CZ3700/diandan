# P5-03 Admin UI 本地验收

作者：`/root/refund_admin_audit`，2026-09-22。负责管理中心资金面板、统一对账、七语文案、BFF 映射和浏览器 runner。最终本地范围 **ACCEPTED**；未提交、推送或执行真实资金。

## 最终证据与范围

接受的整轮目录为 `output/checks/p5-03-finance/integration-2026-09-21T21-48-01.614Z/`，结束于 2026-09-21T21:49:52.331Z。本人读取原始 run-result/protocol/browser-finance/results/final-verification JSON 并独立聚合：

| 检查                        | 实际结果                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| 完整真实本地 HTTP + UI      | PASS；6742 = 5763 setup + 979 scenario assertions                                         |
| 金融 HTTP 协议              | PASS；399 assertions                                                                      |
| 浏览器                      | PASS；9 cases、330/330 assertions、58 PNG                                                 |
| axe                         | 58 次；violations 0、incomplete 0                                                         |
| 页面错误、失败登录 callback | 均 0                                                                                      |
| 七语双端基本矩阵            | en/zh-CN/th/vi/ja/es/pt ×390×844与1440×900 ×对账/全额/逐项，42 张齐全                     |
| 冻结源核对                  | 对 2462 文件候选清单的 UI/BFF/runner 31/31 SHA 相同；`ui-frozen-source-verification.json` |
| 运行后隔离资源              | runtime 最终清理检查：owned native PG processes/temp directories 均 0                     |

环境是 **本机隔离原生 PostgreSQL 18.6 + LOCAL_OIDC/TLS + 独立持久 TEST PSP + Chrome**。Admin 由 `startAdminAccessNext` 以 `NODE_ENV=development`、`next dev` 运行。生产构建属于 root 独立通过的 `check:dev` 门，不称本轮为 production browser。真实 PSP sandbox、真实资金、staging、真机/读屏及人工译审不在本地 PASS 范围。

9 个浏览器场景包括七语双端矩阵；键盘/reduced motion/读取失败恢复；七语 Order Operator 服务端权限只读；连续两项金额输入、PSP已接受但响应丢失、刷新恢复同一原 key/body且退款条数只增加一次；部分后剩余全额；UNKNOWN 占用及显式核对；有 attempt 未付取消；无 attempt 取消；拒付退款禁用说明。完整明细及聚合为 `ui-browser-summary-final.json`。

## 实现与视觉

保持一个管理中心：订单详情内完成退款、取消及核对；对账列表复用订单详情。只按服务端 canManage/canCancel 展示写操作，OPEN/LOST 拒付无新退款按钮。部分退款按原币种 minor units 分配，输入标签包含本地化行序号、礼物及收礼艺人；不含粉丝姓名。处理金额显示 occupied 减 successful，UNKNOWN 不释放占用，并解释准备/送达暂停。

不确定变更保存原严格命令、expectedVersion 和 idempotencyKey，以真实 actorId/orderId 隔离 sessionStorage；刷新或语言重载恢复原请求，禁止另建请求，存储不可用封闭提交。恢复包不保存凭据、支付工具或私密粉丝文本。失响应时画面保留最后已知余额，明确提示先恢复请求；所有履约操作仍由服务端事务重新判断待退款状态。

点击核对、取消、退款后焦点移至对应确认表单；instant 滚动尊重 reduced motion。桌面表单 space-6、手机 space-4，11 个 CSS token 引用均已定义；订单/对账具名切换使用 role=group。本人检查最终西语1440、中文390逐项退款，以及手机失响应、剩余全额、拒付截图：无横向溢出或裁切，金额/艺人/原因/确认与风险提示清晰。

可复核最终截图：

- `../p5-03-finance/integration-2026-09-21T21-48-01.614Z/browser-finance/es-1440-refund-partial.png`
- `../p5-03-finance/integration-2026-09-21T21-48-01.614Z/browser-finance/zh-CN-390-refund-partial.png`
- `../p5-03-finance/integration-2026-09-21T21-48-01.614Z/browser-finance/en-390-refund-unconfirmed-response.png`
- `../p5-03-finance/integration-2026-09-21T21-48-01.614Z/browser-finance/en-390-full-remaining-refund.png`
- `../p5-03-finance/integration-2026-09-21T21-48-01.614Z/browser-finance/en-390-dispute-refund-hold.png`

## 测试、失败与修复记录

命令前缀为 `mise exec node@24.20.0 --`。Admin test 50 文件/191 测试、typecheck、owned prettier/eslint、`node scripts/check-contracts.mjs` 均通过。root 最终统一 check:dev 的63/63/36任务门通过，包含独立生产构建；最终源码快照时间为21:47:43.194410 UTC。重放和测试报告保留在同目录 transcripts 与原 logs。

保留初始模块/BFF RED、view/reload/canonical retry/dispute/balance RED；完整 locale map 曾被唯一locale-owner门拒绝，改为 exhaustive switch 与 manifest 数组，未弱化门禁。真实浏览器20:43轮发现第二金额事件 currentTarget 延迟读取导致 PAGE_ERROR；真实 handler 延迟 updater 单测 RED，同步捕获字符串修复后 GREEN，最终连续两项填写实际通过。不同艺人同礼物的输入标签已明确区分。

20:56轮330断言通过但有14条 axe incomplete；保留 `ui-browser-summary-pre-padding.json`。其后修复未定义space-5及具名div缺group语义，最终58次axe两类均0。后续认证失败原始证据和 `ui-browser-summary-21-28-fail.json` 保留，未覆盖为成功。诊断证明Docker guest墙钟回退触发原session/claimed时间保护；生产OIDC/MFA/CSRF/cookie/created_at规则未放宽。TEST精确因果门、42次真实登录压力检查及原生PG隔离夹具分别验证后，以上最终原矩阵整轮通过。失败历史细节保存在 `ui-verification-before-acceptance.md`。

## 七语关键文案

七语 copy 同一key集合，固定版本 admin-finance-v1/sourceHash/translationHash由测试逐字校验，manifest 全部 **DRAFT**、reviewer=null、approvedCommit=null。核对 refundHint/full/逐项总额与invalid/confirm及reason/cancelHint/uncertain与retrySame/pendingHint/disputeHold/storageUnavailable；涉及原支付账户、仅剩余额、原请求恢复、占款/暂停履约、拒付及存储失败。作者核对和七语浏览器不替代人工译审。

## S.U.P.E.R 作者范围检查

| #                  | 结果与依据                                                              |
| ------------------ | ----------------------------------------------------------------------- |
| 1 单一职责         | PASS：client/model/view/pending store/records/list 分离                 |
| 2 单一概念         | PASS：金额分配、确认、网络执行、恢复各自负责                            |
| 3 单向依赖         | PASS：Browser→固定BFF→Application→Domain/Port→PG                        |
| 4 无循环依赖       | PASS：无反向调用；统一adapter门通过                                     |
| 5 合同明确         | PASS：独立finance Zod/schemaVersion，旧Orders API不扩写                 |
| 6 可序列化         | PASS：恢复严格命令，不含会话凭据或私密粉丝字段                          |
| 7 无生产参数硬编码 | PASS：币种/余额/权限取可信响应，locale唯一owner，固定BFF路径为合同端点  |
| 8 依赖声明         | PASS：复用已有组件/session/Playwright/axe，无新增第三方依赖             |
| 9 可替换           | PASS：finance API和provider端口隔离，UI无特定PSP实现假设                |
| 10 验证            | PASS：受影响测试、统一静态/构建门、最终真实本地PG/HTTP/完整浏览器皆通过 |

## 流程与独立复核边界

应用项目/TDD/系统调试/Playwright/code-simplifier/完成前验证skill。`apps/admin/AGENTS.md` 及当前安装Next文档是在root提醒后补读，并非初写前已读；补读后确认storage只在effect、函数props只沿client graph、复用既有POST BFF。保留此过程偏差。

另获授权的PG apply拆分保持coordinator及所有锁时点，payment/refund/dispute/projection各成内部helper；16个SQL模板multiset逐字相同，typecheck/eslint及后续PG回归通过。`ui-apply-preservation.json` 保留静态证据；独立复核由root负责，作者不自称其非作者reviewer。

独立合同/domain/application审查见 `ui-independent-contract-review.md`。P5-05仅只读核对见 `ui-next-stage-readiness.md`；本报告不领取任务或修改进度计数。本地验收不等于真实商户接入或上线。
