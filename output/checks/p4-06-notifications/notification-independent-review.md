# P4-06 notification independent read-only review

Reviewer: order_browser（这些 notification 模块的非实现 owner）。范围：notification repository/data/request/lifecycle/access，0029 up/down 新增逻辑及其依赖的旧 token/notification guards，Application request/dispatch/retry，Worker 配置绑定，gateway/provider 截止。未运行共享 build，未修改实现。

结论：本次检查未发现新的可操作 P1/P2。order_view 独立提出的 P2 是 static sender credential 在启动时的校验与冻结；root 已报告修复完成、7 项定向测试通过，不重复登记成新问题。全仓库最终门禁完成前，不将整体 P4-06 声明完成。

## 已核对的边界

1. 来源权威绑定不可变 outbox 与 order/fulfillment 事件的 sequence、request/correlation/time；付款通知另外绑定 canonical provider evidence、APPLIED receipt 与等额 CAPTURE。调用方不能以当前 UI 状态、自由 locale 或浏览器回跳生成权威通知。
2. 通知 source 在取得 cart/order 锁后重读；变更路径统一 cart → order → delivery/runtime → token/contact，与查单和清理聚合边界相容。查询不存在另一路 delivery-first 后取 cart 的新锁序。
3. order/event_type 业务唯一键与 source_outbox_event_id 唯一键阻止同业务事件重复建通知。listPending 的先决事件过滤发生在 LIMIT 前；未发现一个被前序事件阻塞的行持续占住扫描首位的路径。
4. 订单名字、商品名字/variant/原 locale、金额与下单时间来自固化 order_items/checkout observation。runtime consistency 将冻结 JSON 与原始快照比较，后续目录发布不会改变历史邮件事实。
5. PRF 链接通过固定 notification id/nonce/pepper 重新推导，原始 bearer 不写业务库。UNKNOWN/租约丢失重试固定 transport profile、template version、content hash、recipient lookup identity 与同一 link token，不切换到另一供应商或另发新链接。
6. recipient 每次解密前有当前 lease 与 scoped 审计 receipt；confirmSend 再验相同 contact lookup/retention、相同 generation、原内容 hash、link 状态与 dedupe deadline。撤销、过期、内容漂移、失去授权都停止发送。
7. EXCHANGED link 仅在存在先前 UNKNOWN 且原 content hash 已固定时允许同命令重试；不是重新给予另一用户授权。公开 exchange 只匹配 LINK purpose；CHECKOUT_BOOTSTRAP 要在同事务内 EXCHANGED+同订单 session+BOOTSTRAP audit，旧 to_jsonb immutable guard 同时保护新 purpose 字段。
8. 新 token issuance 会按既有单一活动公开链接策略退休旧 token；后续事件阻止旧事件再次签发链接。此为当前明确采用的顺序/轮换策略，未发现绕过该策略的实现分支。
9. 最大尝试次数、原始 provider dedupe 截止、旧租约 UNKNOWN 记录和终态失败保留审计事实。删除旧 transport 配置、旧 pepper 或旧 template 版本会 fail closed，部署需保留仍被未完成通知引用的版本。
10. 0029 down 在已有通知、bootstrap 或 SYSTEM expiry 历史时拒绝回滚，避免静默丢失新权威记录。

## S.U.P.E.R

1–9 通过本次静态核对：source/claim/recipient/link/finish 职责明确；Application→Port→PG/provider 单向；边界均为 schemaVersion/Zod/JSON；无在 Application 直接 SQL、存储明文收件人/令牌或引入新 SaaS 业务源的发现；provider、模板与 PG 依赖可替换，配置版本固定。

第 10 项（全部测试）交由 root 当前统一全仓库 check 与正在运行的 PG/mail/真实 Next browser 集成结果确认。本审查不重复重跑这些正在执行的门禁，不把只读代码审查等同于生产验证。
