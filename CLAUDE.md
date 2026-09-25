# Claude Code Entry Point

本项目的执行规则由以下文件共同定义（2026-09-26 起按 V2 上线方案推进）：

1. `AGENTS.md`
2. `docs/plan/2026-09-26-v2-launch-plan.md` —— 当前阶段 R0–R3、已确认决策与流程约定
3. `docs/progress/v2-progress.md` —— V2 进度记录
4. `docs/FAN_SUPPORT_PLATFORM_SPEC.md` —— 行为权威，§0.2 汇总 V2 变更
5. `.agents/skills/fan-support-platform-dev/SKILL.md`

开始时完整读取这些文件，按方案顺序逐项推进当前阶段条目。原 Phase/Task/Lane 文件保留为历史记录与验收参考。不要根据旧调研文档扩展范围；未满足测试、浏览器与进度记录时不得标记完成。

硬边界：本项目的前台、Admin、内容、商品、价格、库存、购物车、checkout、订单与履约必须完全由仓库源码和 PostgreSQL 实现。不得引入 Shopify、托管 CMS 或 commerce engine；银行卡/钱包敏感输入仍必须交给合规 PSP 托管页面或字段。

语言硬边界：`en` 是默认/源语言，首发 locale 精确为 `en/zh-CN/th/vi/ja/es/pt`。公开页面使用 `/:locale/...`；locale 与 market/currency/payment capability 分离，切换语言不得改变购物车、价格、币种、订单或既有支付。

## 本机环境（Windows）

- 项目锁定 Node 24.20.0，本机使用便携版：运行项目命令前执行 `source /c/Users/admin/.tools/xiadan-env.sh`（把 Node 24.20.0 与 corepack 的 pnpm shim 放到 PATH 最前）。
- 日常门禁：`corepack pnpm check:dev`。完整 `pnpm check` 依赖 PostgreSQL 18 与 S3 模拟，本机尚未具备，由 CI 承担。
