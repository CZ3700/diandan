# 当前上线进度

> 当前方案：[可配置装修与完整交易上线计划](../plan/2026-09-28-flexible-storefront-launch.md)；用户于 2026-09-28 确认，见 ADR-020。
> 状态：`PENDING / READY / IN_PROGRESS / LOCAL_ACCEPTED / BLOCKED_EXTERNAL / DONE`；DONE 必须满足该项明确验收，不等于整站已上线。
> 旧成果与未完证据保留在 [v2-progress.md](v2-progress.md)，不复算旧 49 项百分比。每项结论不超过十行，详细日志在 `output/`。

| 项目 | 状态 | 当前结论与下一步 |
|:--|:--|:--|
| L0 基线对齐 | DONE | root，2026-09-28 开始并完成；同步 GitHub 55d5165b，更新 SPEC 5.0.0 / ADR-020 / 统一入口；13 份文档的 17 个相对链接及独立复核通过。现有服务器和数据未改动。 |
| L1 首页装修样板 | READY | 已核对旧内容/海报发布守卫，先做现有首页区块排序显隐和真实预览；完整草稿/发布/恢复、换海报不覆盖布局通过后才交付。尚未修改装修业务代码。 |
| L2 日常装修完善 | PENDING | 依赖 L1 完整验收；再扩展主题/焦点/布局/动效、艺人/礼物模板和导航页脚；尚未开工。 |
| L3-01 沙盒验证结果可信性 | DONE | root 协调、独立执行与复核，2026-09-28 开始并完成；零回调/错配/验签失败均不通过；配置检查不联网、秘密与付款链接不入普通输出。29 个 adapter 测试及 43 个脚本测试、check:dev、独立真实 adapter/HMAC 检查通过。 |
| L3-02 Stripe adapter 实际沙盒 | DONE | root，2026-09-28；受限本地配置 + 官方 CLI 转发 + Playwright 托管测试页：USD 25 测试付款、USD 5 部分退款、重放、查询、取消及对应验签回调通过；12 项检查全通过。仅 adapter 验收，`siteOrderFlowVerified=false`，没有真实资金交易。 |
| L3 正式交易与运营 | IN_PROGRESS | Stripe 测试凭据已配置，adapter 实际沙盒通过；下一步为隔离实例的本站 checkout→API webhook→Inbox/Worker→查单→后台退款。Airwallex 收单号申请中，邮件/正式 OIDC 资源待落实；生产商户尚未批准。 |
| L4 发布验收 | PENDING | 依赖 L1–L3 首发范围；当前服务器仍为公开 TEST，尚未转正。实际资金/正式发布需单独授权。 |

## 当前外部条件

- PSP：用户提供的 Stripe 测试凭据已保存到 Git 忽略且权限为 0600 的 `.env`。通过临时 npm 执行官方 `@stripe/cli@1.51.1`，API key 仅注入子进程环境；CLI 签名密钥自动保存到同一本地文件，原始输出受限保存。验收完成后已停止转发和浏览器。再次运行须启动同一沙盒的转发并核对签名密钥；不把 CLI 本地签名密钥当作正式 API endpoint 配置。
- 邮件/身份：需真实服务账号、发信域名配置、OIDC/MFA 与恢复方式；已有 TEST 能力不充当生产证据。
- 正式内容/政策/客服/商户业务范围：保留待确认项，不能由开发代理猜测或伪造批准。

## 本轮证据

1. 基线：`git fetch origin v2/r1-production` 与 `git merge --ff-only origin/v2/r1-production`，67039d7a → 55d5165b；已有上传图片修复已同步。
2. RED/GREEN：旧脚本零回调误通过反例失败；修复后 `pnpm --filter @fan-support/payment-stripe test` 29 + 43 全通过；capture 关联的变异反例能失败。证据：`output/checks/lean-launch-2026-09-28/sandbox-*.log`。
3. 日常门禁：Node 24.20.0 / pnpm，`pnpm check:dev` exit 0（typecheck 69、test 69、build 38 个任务，含缓存）；最后的测试强化再次跑完整受影响包通过。`output/checks/lean-launch-2026-09-28/check-dev.log`。
4. 真实 Stripe 沙盒：构建依赖后运行 `stripe-sandbox.mjs --no-wait` 和 `--webhook-port 4242` 均 exit 0；后者付款/退款/验签回调全部通过。报告：`output/checks/r1-03-stripe-sandbox/sandbox-2026-09-27T22-40-19.318Z-ee3edf67-0a1b-4cc5-b877-bc4b372ca9d7.json`。随后只读查询确认该 USD 25 付款只有一笔 USD 5 成功退款：`output/checks/lean-launch-2026-09-28/stripe-refund-readback.json`。
5. 复核：独立文档与脚本审查通过；真实 adapter/HMAC/HTTP 的五个正反例通过。S.U.P.E.R 十项检查见 `output/checks/lean-launch-2026-09-28/sandbox-verification-summary.md`；code-simplifier 检查未发现需要增加抽象或扩大重构的部分。
6. 范围：本轮无本站 UI / 数据库迁移 / 正式 adapter 改动，不冒充 PostgreSQL、S3、七语商城浏览器或本站订单验收；未部署服务器、未执行真实资金交易。
7. 下一项：L1 首页排序显隐→真实预览→草稿/发布/恢复完整样板；L3 隔离本站 Stripe 链路并行。账号、邮件、身份和正式内容仍按实际条件逐项验收。
