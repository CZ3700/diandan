# Claude Code Entry Point

本项目的执行规则由以下文件共同定义（2026-09-28 起按可配置装修与精简上线方案推进）：

1. `AGENTS.md`
2. `docs/FAN_SUPPORT_PLATFORM_SPEC.md` —— 行为权威，§0.3/ADR-020 为当前变更
3. `docs/plan/2026-09-28-flexible-storefront-launch.md` —— L0–L4 范围、顺序与验收
4. `docs/progress/launch-progress.md` —— 唯一当前进度，V2 与 Phase 记录作为历史证据
5. `.agents/skills/fan-support-platform-dev/SKILL.md`

开始时按 AGENTS.md 入口读取文件，按方案逐项推进；外部支付/邮件/身份准备与装修并行，不再放到最后。不要根据旧调研文档扩展范围；未满足测试、浏览器与进度记录时不得标记完成。

硬边界：本项目的前台、Admin、内容、商品、价格、库存、购物车、checkout、订单与履约必须完全由仓库源码和 PostgreSQL 实现。不得引入 Shopify、托管 CMS 或 commerce engine；银行卡/钱包敏感输入仍必须交给合规 PSP 托管页面或字段。

语言硬边界：`en` 是默认/源语言，首发 locale 精确为 `en/zh-CN/th/vi/ja/es/pt`。公开页面使用 `/:locale/...`；locale 与 market/currency/payment capability 分离，切换语言不得改变购物车、价格、币种、订单或既有支付。

## 本机环境（Windows）

- 项目锁定 Node 24.20.0，本机使用便携版：运行项目命令前执行 `source /c/Users/admin/.tools/xiadan-env.sh`（把 Node 24.20.0 与 corepack 的 pnpm shim 放到 PATH 最前）。
- 日常门禁：`corepack pnpm check:dev`。
- 真实 PostgreSQL：便携 PostgreSQL 18.6 在 `C:\Users\admin\.tools\pgsql-18.6\pgsql\bin`，环境脚本已导出 `POSTGRES_TEST_BIN`，测试框架据此启动临时原生集群（无 Docker）。可本机运行 `pnpm --filter @fan-support/persistence-postgres test:postgres`（约 40 分钟）、`migrations:manifest`、`migrations:catalog`。API/浏览器级集成脚本还需要 S3 模拟（versitygw 容器），本机没有，由 CI 承担。
- Bash 工具的 heredoc 超过约 8KB 会被截断报 `unexpected EOF`；长脚本先写成文件再执行。

## 阶段交接

交接文档写到 `docs/handoff/YYYY-MM-DD-<主题>.md`，纳入 git 跟踪并推送（用户 2026-09-26 确认）。新会话以 AGENTS.md 和当前进度冷启动，旧交接不得覆盖新决策。
