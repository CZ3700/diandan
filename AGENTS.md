# Fan Support Platform — Agent Instructions

本仓库用于开发全球偶像礼物应援平台。任何 Codex、Claude Code 或其他开发代理都必须遵守以下入口与边界。

## 开始任何任务前

2026-09-28 起，新工作按用户确认的可配置装修与精简上线方案推进（规范 §0.3–0.4、ADR-020/021）。按顺序读取：

1. `docs/FAN_SUPPORT_PLATFORM_SPEC.md` —— 行为权威（§0.3–0.4 为本轮变更）
2. `docs/progress/MASTER.md` —— 当前入口
3. `docs/plan/2026-09-28-flexible-storefront-launch.md` —— L0–L4 范围、顺序与验收
4. `docs/progress/launch-progress.md` —— 当前任务与外部条件
5. `.agents/skills/fan-support-platform-dev/SKILL.md` 与当前任务引用的 ADR

按方案顺序逐项推进，开工前在 `launch-progress.md` 登记执行者、范围与验证计划。V2 和原 Phase/Task/Lane 文件保留历史成果与未完验收，不再作为新工作的领取门禁。用户已授权逐步推进，不重复询问是否继续。

## 权威与范围

- 当前用户要求和 `docs/FAN_SUPPORT_PLATFORM_SPEC.md` 高于其他项目文档。
- `docs/双站调研与类似平台技术架构规划.md` 与 `research/` 只作参考证据，不能恢复已删除的扩展范围。
- MVP 只做：浏览偶像、选择礼物（虚拟打赏/实物投喂/艺人心愿/周边四类，ADR-019）、私密留言/署名、游客支付、安全查单、准备与送达、轻量运营与支付适配边界。榜单与公会赛（ADR-018）已于 2026-09-28 由用户取消，不得实现。
- 首发新增受控装修：已部署区块/模板、主题和动效预设，真实预览、草稿、发布和恢复；不做任意画布或脚本上传。先贯通一家获准 PSP，外部接入与装修并行，已有通道代码保留。后台首发用内置账号登录、两步验证自选（ADR-021）；两端在同一分支并行，开工前在 `launch-progress.md` 登记执行者，完成即推送。
- 禁止自行加入社区、可兑换积分/等级、活动众筹、偶像登录、分账、储值、直播、多租户或原生 App。

## 实施纪律

- 合同与测试先行；跨模块对象使用 Zod/schemaVersion，可序列化。
- 依赖方向固定：Browser/Route → Application → Domain → Port → Adapter。
- PostgreSQL 是内容、商品、价格、库存、购物车、订单与支付编排的唯一业务真相源；缓存、CDN、搜索和分析只做可重建投影。
- 私密留言和完整显示名必须进入加密 `support_intent`；不得进入公共购物车响应、日志、分析、对象元数据或截图。
- 粉丝前台、管理后台、商城核心和部署定义必须由本仓库实现；禁止引入 Shopify 或其他建站/CMS/商城 SaaS 作为业务依赖。
- 卡号、CVV 与钱包凭据只能进入合规 PSP 托管页面/字段；完全自研不代表自行处理卡数据。
- 支付最终状态只来自验签 webhook 或经认证、审计的 PSP reconcile 证据；浏览器回跳只查询。
- 支付“热更新”仅指已部署 adapter 的版本化规则/开关；禁止动态上传或执行支付代码。
- 首发公开 locale 固定为 `en/zh-CN/th/vi/ja/es/pt`，`en` 为默认/源语言。公开 HTML 使用 `/:locale/...`；locale、market、country、currency 与 payment capability 必须分离，切换语言不得改变购物车、价格、币种或支付 attempt。
- MVP 异步链路使用 PostgreSQL Outbox + pg-boss/等价持久队列，不引入 Redis，除非先有经用户确认的 ADR。
- 不硬编码站点/主域名、偶像 ID、生产 locale 特判、国家、币种、支付方式、密钥或正式品牌值。
- 不回滚用户改动，不使用破坏性 git 操作，不在未确认时改动任务之外文件。

## 验证与交付

- 代码任务先写失败测试；文档/基础设施任务提供可重复检查。
- 先跑受影响测试，再跑 format、lint、typecheck、build 和任务要求的集成/E2E。
- 前台变化必须在真实浏览器至少验证 390×844 与 1440×900，并检查键盘、错误状态和 reduced motion；涉及文案/布局时覆盖英语、一个 CJK、泰语、越南语和最长西/葡语，当前首发验收覆盖全部七语言。
- 完成前运行 SKILL 中的 S.U.P.E.R 10 项检查；日常门禁为 `pnpm check:dev`。
- 验证产物写入 `output/`（已被 git 忽略，证据不入库）；结论以不超过十行记入 `docs/progress/launch-progress.md`。仅该项完整验收后使用 `DONE`，外部缺口不得用 TEST 证据填补。
- 每个通过的条目提交并推送（用户 2026-09-26 已授权 push）；云 apply、真实资金、正式内容发布与生产发布仍须逐次获得用户确认。
- 本地通过不等于生产发布；不得省略实际 PostgreSQL、对象存储、PSP sandbox/真实小额支付、staging 或灰度证据的范围说明。
