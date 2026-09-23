# P6-02 有限本地就绪复核

复核者：`/root/regression_readiness`；日期：2026-09-23。只读核对原直接依赖及当前源，不领取任务、不改进度、不运行服务或 P6-02 实现。

**结论：ACCEPT_CONDITIONAL_LOCAL_READINESS。** 原 P3-06、P4-06、P5-02 的适用本地完整成果及非作者验收已具备。待当前 P6-01 完整本地回归、质量门、非作者复核通过并释放 Lane D 后，协调者可按 ADR-016 在 MASTER / Phase 6 登记 P6-02 有限本地 ACTIVE 范围并置 READY。当前 P6-01 最终五组仍在执行，本报告不提前宣布它已通过，也不自动激活 P6-02。

## 可消费证据

| 原直接依赖 | 完整适用本地验收与非作者复核                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-06      | `output/checks/p3-06-h2-matrix/final-verification.json`、`matrix-tools-review.md`、`progress-final-review.md`：84 资源导航、63 次 Lighthouse、21 组三次原预算通过；30 项原 axe incomplete 逐类技术复核，原记录保留。最新 `output/checks/p3-06-ui-alignment/final-verification.json`、`final-review.md`：七語 581 检查 / 61 场景 / 61 PNG / 56 axe，真实 PG/S3 礼物回归 21898；非作者两次 ACCEPT，Lane B/D 已释放。任务仍 IN_PROGRESS，人工门未代签。 |
| P4-06      | `output/checks/p4-06-notifications/final-verification.md`、`final-independent-review.md`：真实 PG/TLS/Worker/邮件 CTA 6814，过期 6105 / action 5843；七语三事件双端 44 场景 / 842 断言 / 44 axe 零违规与 incomplete。原整条 check 的超时及同源质量后缀通过均保留，不冒称远端 CI。任务 DONE。                                                                                                                                                         |
| P5-02      | `output/checks/p5-02-order-operations/final-verification.md`、`reviews.md`：订单 PG 5960、通知重发 6085、退出并发 6、HTTP/UI 7113（419 浏览器断言 / 32 PNG / 32 axe，七语双端 / 键盘 / reduce / 错误 / 私密清理 / 审核准备送达），原管理中心 7377 与自动通知 6814；合同、存储、应用、UI 分文件非作者 ACCEPT。任务 DONE。                                                                                                                             |

## 当前源适用性

逐文件 SHA 结果保存在同目录 `p6-02-readiness-source.json`；这是一组选定的直接输入及共享 UI 指纹核对，不称全仓零变化。

- 最新 P3-06 UI 的 18/18 输入仍等于独立验收版本；P4-06 后继就绪记录中的 62/62 通知输入仍相同。
- P5-02 选定订单 / 重发 / management-orders 输入 67 个：61 个仍等于原 P5-02；六个后续合法变化为订单详情、workspace、TEST runtime、存储 data/rules 及其 test。其后退款 / 配置扩展已随 P5-03/P5-05 接受，原订单 5960 回归及后续完整体验承接；67/67 均等于最终 P5-08 已验收源码。
- 49 个共享 management-center / BFF 输入均等于最终 P5-08 已验收源码。`output/checks/p5-08-local-deployment/reviews/quality-review-resumed.md` 的最终非作者 ACCEPT_LOCAL_SCOPE 由实际 FULL799 + 同实例 RESTART109 支持。
- 当前 P6-01 新增了已审的真实发布内容事故英文恢复及 API / 商品消费者修复，未改布局、消息目录、订单 / 通知产品代码；其全量集成仍须以 root 正在运行的 `final-1` 完整验收为准。P6-02 应消费该最终版本，覆盖英文内容的 lang、可见 fallback 通知及严格政策不可用状态；不能沿用旧页面截图当这些状态的新验收。

## 有限范围与保留门

P6-02 可实施全部可本地复现的七语 WCAG 2.2 AA 检查与必要修复：真实生产编译页面的键盘 / 焦点 / 错误 / live region、axe、200% 实际浏览器缩放、320 CSS px、CJK / Thai / Vietnamese / 西葡长文断行及 reduced motion。覆盖浏览至购买查单、邮件入口、管理中心审核与履约；按原失败测试、质量门、真实双端 / 七语、独立复核要求执行。保持简单管理中心和已批准视觉，不扩大业务。

以下仍是原门，不能用自动工具或本报告替代：

- 实际 VoiceOver / NVDA 冒烟、人工语言断行记录和真人核心路径操作；P3-06 最新七个移动焦点守卫 axe incomplete 原样保留并在 P6-02 逐项审视。历史技术复核不等于读屏完成。
- 实体手机、正式图片 / 肖像授权、关键 UI / 政策 / 支付 / 订单 / 邮件人工语言批准；P3-06 真人 3/5/8 分钟操作不由工具代签。现存 Next 流式页面无 JS 限制保留，不把原生 GET 表单描述成整站无 JS 可用。
- 真实 PSP 商户 / sandbox / 小额支付退款、正式身份 MFA / 恢复、正式邮件 / DNS / 收件箱、KMS；本地 TEST 不替代这些门。
- P6-01 实际远端 CI、P6-03 真实 RUM、P5-08 云 staging、恢复 / 灰度 / 生产发布和上线观察。ADR-016 不授权 push、云 apply、真实资金或正式内容发布。

完成本地部分但人工门未取得时，P6-02 应保持 IN_PROGRESS、明确未覆盖项与责任人并释放 executor；不得标完整 DONE。P6-03 等后继继续逐项核对原直接依赖，不能据此一次性 READY。
