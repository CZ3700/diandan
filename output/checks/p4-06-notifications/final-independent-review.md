# P4-06 最终独立证据验收

结论：**ACCEPT（本地开发验收范围）**。未发现尚未闭环的 P1/P2。
这不是生产邮件、远程 CI 或整条 `pnpm check` exit 0 的声明。

评审者 `/root/order_view` 未编写所评审的 contracts/application/Worker 和
PostgreSQL 实现；本人参与模板与网关测试实现，因此这些部分在本报告中属于证据
交叉核对，源码独立批准应结合其他代理的非作者评审。本次仅阅读源、日志和产物，
重新计算冻结文件摘要，查看截图；没有修改产品源、改变阈值或重跑重型测试。

## 完整检查与后缀结果

- `check-full-3-result.json` 如实记录 2220.017 秒、exit 1。日志确认原 PostgreSQL、
  API、TLS S3 及新 action 5843、expiry 6105、notifications 6814 断言已经通过，
  后续格式、lint、typecheck 也已执行。失败点是原
  `translation-transfer-repository.test.ts` 的首次动态 import 测试超过 5000ms：
  此包当时 639/640 测试通过。
- 该测试及全局测试配置相对基线无改动，未放宽超时。原两项测试独立重跑通过：
  外层耗时 0.899 秒，Vitest 记录 446ms。不能从一次重试推定确切超时根因；保留
  并发运行时偶发测试时延这一剩余风险，不能隐藏原失败。
- 首次 `quality-tail` 因命令 PATH 包装器失败，0.011 秒、exit 127，原记录保留。
  修正为 `pnpm exec` 后，`quality-tail-2-result.json` 确认原七项质量后缀
  **46.254 秒、exit 0**：格式、lint、typecheck 62/62（62 cache）、test 62/62
  （59 cache）、build 36/36（32 cache）、adapter 边界、32 个实际 Node 导出均通过。
- 因而可声明“完整实际集成通过，原质量后缀同源重跑通过”，不能声明“单条完整
  check 全绿”“冷缓存全绿”或“实际 GitHub CI 已通过”。

## 源码与范围一致性

独立重新计算 `source-final-frozen-2.json` 的 compact JSON 摘要，确认它与
`source-after-full.json` 的 **2190 项集合和逐文件字节完全一致**，摘要均为：

`fdfeb7436391fd492f5484f0cd1b769755ee8f6f27a4b5b1e372f061de26db91`

质量后缀完成后再次读取这 2190 个当前文件，未发现任何差异。

第三轮检查开始前的 `source-final-candidate-2.json` 与最终冻结之间只有 `packages/persistence-postgres/package.json`
不同；新增构建前置覆盖 API、Worker 和 Storefront 依赖。实际通知调用日志明确
执行新命令，28 个构建任务通过，然后才运行通知夹具。
`notification-build-prerequisites-2.json` 列出完整集合；早先仅 UI 的构建探测
不单独充当完整前置证据。

Next dev 夹具生成的两条 admin 声明已按
`admin-next-env-restoration.json` 归档并精确恢复。此过程存在中途文件变化，
最终摘要相同不能改写成“全程零漂移”。更早回退夹具、SQL 提取器与 CI 预算修正
在前两轮失败证据中保留，未覆盖原日志。

`compatibility-and-protection.json` 记录 573 个原合同根、96 个公开 API 路径、
180 个原组件、56 个旧 SQL 和 2413 个初始未跟踪文件无改变。新增通知和到期
运行合同/迁移均明确属于本任务；没有增加商品范围或生产供应商承诺。

## 最低验收覆盖

| P4-06 要求                                                | 核对结果                                                                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 七语言 subject/preheader/HTML/text/变量及 review manifest | i18n 包 44 单测、七语言三事件双视口及大单摘要共 44 浏览器场景/842 断言；全部 21 译审保持 DRAFT，生产门关闭。                                     |
| 不可变版本和历史重现                                      | 21 个消息在三个时区按存档摘要复现；十项摘要、原文 lang、精确整数金额与 UTC 下单时间有测试；未发布版本修订原因和旧证据保留。              |
| 固定 locale、英语事故 fallback                            | 原订单快照驱动；事故仅作用于新通知，数据库原因和稳定告警可见；重试保持已冻结版本。                                                       |
| 幂等、重试和未知结果                                      | 实际 PostgreSQL/TLS 接收器、真实丢 HTTP 响应、独立进程重启、并发、一致正文和绝对截止均通过；已消费链接的未知回执恢复不重新激活 token。   |
| 真实 Worker 和安全邮件查单                                | 最新 6814 断言整合包含 pg-boss、Worker 和实际生成的邮件 CTA，原路由 `/order-access` 一次消费后进入真实历史订单。                         |
| 到期与支付竞争                                            | 实际 action 5843 与 expiry 6105 断言通过；UNKNOWN 不重新开放付款入口，迟到可信成功仍入账并可进入 ON_HOLD。                               |
| 异常隔离与配置                                            | 独立源码复核的静态凭据 P2 已关闭：启动校验全部活动/保留 profile，捕获凭据快照；7 项测试及独立 probe 通过。通知异常不回滚已提交订单事实。 |

准备/送达覆盖使用正常付款订单上的受约束 WORKER SQL 测试事件，不代表已经执行
P5 运营动作或真实物品送达。去重证明是 TEST 接收器的接收副作用，不代表普通
SMTP 或尚未验收供应商的 exactly-once 收件箱投递。

## 最新实际邮件浏览器目检

`persistence/run-2026-09-16T03-30-06.970Z` 的 `run-result.json` 为 PASS、6814
断言、选定输入摘要不变。其 `notification-link-browser/report.json` 包含：

- 390×844 和 1440×900 两视口，4 张 PNG，键盘与 reduced motion 通过。
- 两端可见金额精确断言通过，axe 均 0 violations / 0 incomplete。
- 原始 fragment 在 exchange 之前清除；只有一次 exchange，刷新沿用安全会话。
- 真实受保护 READ、历史金额/时间/四项独立状态、无脚本可读授权、无私密泄漏。

独立打开两张最新 summary 视口图，Tạm tính 与 Tổng cộng 的 **15,00 US$**
均清楚可见，无裁切；手机按钮及桌面两栏正常。上轮疑似金额缺失没有在原图复现，
没有为其改动产品源。模板安全预览和真正邮件 CTA 两类证据明确区分。

## 保留的门与结论边界

人工翻译批准、真实邮件服务/域名、SPF/DKIM/DMARC、收件箱客户端、退信/投诉、
云 KMS、实际 PSP 商户/sandbox、物理手机/读屏、staging 与生产发布继续保持原门。
P3-06/P4-04 的未完验收、Phase 5 依赖和生产授权不因本报告自动解除。

S.U.P.E.R 1–9 的独立源码复核结论保持；静态凭据问题已修复。第 10 项由实际
集成、同源质量后缀、共享浏览器与现有测试证据闭环，带缓存与原失败事实明确记录。
在上述范围内接受 P4-06 本地验收；最终登记、提交和后续阶段安排由 root 汇总。
