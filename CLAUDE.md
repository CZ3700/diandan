# Claude Code Entry Point

本项目的执行规则由以下文件共同定义：

1. `AGENTS.md`
2. `docs/FAN_SUPPORT_PLATFORM_SPEC.md`
3. `docs/progress/MASTER.md`
4. 候选任务所在的 ACTIVE phase 文件（Phase 1 与 Phase 2 可能同时激活）
5. `.agents/skills/fan-support-platform-dev/SKILL.md`

开始时完整读取这些文件，只领取 `MASTER.md` 允许、位于 ACTIVE phase、依赖已完成且 Lane 空闲的下一个 `READY` Task ID。不要根据旧调研文档扩展 MVP，也不要在未满足测试、浏览器与进度证据时把任务标为完成。

硬边界：本项目的前台、Admin、内容、商品、价格、库存、购物车、checkout、订单与履约必须完全由仓库源码和 PostgreSQL 实现。不得引入 Shopify、托管 CMS 或 commerce engine；银行卡/钱包敏感输入仍必须交给合规 PSP 托管页面或字段。

语言硬边界：`en` 是默认/源语言，首发 locale 精确为 `en/zh-CN/th/vi/ja/es/pt`。公开页面使用 `/:locale/...`；locale 与 market/currency/payment capability 分离，切换语言不得改变购物车、价格、币种、订单或既有支付。
