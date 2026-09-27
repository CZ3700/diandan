# 当前上线进度

> 当前方案：[可配置装修与完整交易上线计划](../plan/2026-09-28-flexible-storefront-launch.md)；用户于 2026-09-28 确认，见 ADR-020。
> 状态：`PENDING / READY / IN_PROGRESS / LOCAL_ACCEPTED / BLOCKED_EXTERNAL / DONE`；DONE 必须满足该项明确验收，不等于整站已上线。
> 旧成果与未完证据保留在 [v2-progress.md](v2-progress.md)，不复算旧 49 项百分比。每项结论不超过十行，详细日志在 `output/`。

| 项目 | 状态 | 当前结论与下一步 |
|:--|:--|:--|
| L0 基线对齐 | DONE | root，2026-09-28 开始并完成；同步 GitHub 55d5165b，更新 SPEC 5.0.0 / ADR-020 / 统一入口；13 份文档的 17 个相对链接及独立复核通过。现有服务器和数据未改动。 |
| L1 首页装修样板 | DONE | root 协调，2026-09-28 完整验收；管理中心排序/显隐、真实双端预览、草稿/发布/历史恢复已接通。实际 PG 35 项、44 迁移往返、七语双端、海报与布局互不覆盖、正式构建 21+107 项及重启 7 项、原交易专项 258 项、check:dev 与独立复核通过；原体验和服务器未动。详情见下方本轮验收。 |
| L2 日常装修完善 | READY | L1 完整验收已满足；下一步按有限预设扩展主题、图片焦点、布局/动效，再接艺人/礼物模板和导航页脚；尚未开工。 |
| L3-01 沙盒验证结果可信性 | DONE | root 协调、独立执行与复核，2026-09-28 开始并完成；零回调/错配/验签失败均不通过；配置检查不联网、秘密与付款链接不入普通输出。29 个 adapter 测试及 43 个脚本测试、check:dev、独立真实 adapter/HMAC 检查通过。 |
| L3-02 Stripe adapter 实际沙盒 | DONE | root，2026-09-28；受限本地配置 + 官方 CLI 转发 + Playwright 托管测试页：USD 25 测试付款、USD 5 部分退款、重放、查询、取消及对应验签回调通过；12 项检查全通过。仅 adapter 验收，`siteOrderFlowVerified=false`，没有真实资金交易。 |
| L3-03 本站 Stripe 接线准备 | LOCAL_ACCEPTED | stripe_site_audit / root，2026-09-28；新隔离实例可显式选 stripe-test，统一账户/方法/凭据引用/验签头/托管源站，旧 fake 实例不可切换，Web/Worker 不接收支付密钥。75 项相关测试及独立复核通过；本站实际 Stripe 付款、Inbox/Worker、查单和后台退款仍待下一项联调，未冒充完成。 |
| L3 正式交易与运营 | IN_PROGRESS | Stripe 测试凭据已配置，adapter 实际沙盒通过；下一步为隔离实例的本站 checkout→API webhook→Inbox/Worker→查单→后台退款。Airwallex 收单号申请中，邮件/正式 OIDC 资源待落实；生产商户尚未批准。 |
| L4 发布验收 | PENDING | 依赖 L1–L3 首发范围；当前服务器仍为公开 TEST，尚未转正。实际资金/正式发布需单独授权。 |

## 当前外部条件

- PSP：用户提供的 Stripe 测试凭据已保存到 Git 忽略且权限为 0600 的 `.env`。通过临时 npm 执行官方 `@stripe/cli@1.51.1`，API key 仅注入子进程环境；CLI 签名密钥自动保存到同一本地文件，原始输出受限保存。验收完成后已停止转发和浏览器。再次运行须启动同一沙盒的转发并核对签名密钥；不把 CLI 本地签名密钥当作正式 API endpoint 配置。
- 邮件/身份：需真实服务账号、发信域名配置、OIDC/MFA 与恢复方式；已有 TEST 能力不充当生产证据。
- 正式内容/政策/客服/商户业务范围：保留待确认项，不能由开发代理猜测或伪造批准。

## L0 与 L3-01/02 历史证据

1. 基线：`git fetch origin v2/r1-production` 与 `git merge --ff-only origin/v2/r1-production`，67039d7a → 55d5165b；已有上传图片修复已同步。
2. RED/GREEN：旧脚本零回调误通过反例失败；修复后 `pnpm --filter @fan-support/payment-stripe test` 29 + 43 全通过；capture 关联的变异反例能失败。证据：`output/checks/lean-launch-2026-09-28/sandbox-*.log`。
3. 日常门禁：Node 24.20.0 / pnpm，`pnpm check:dev` exit 0（typecheck 69、test 69、build 38 个任务，含缓存）；最后的测试强化再次跑完整受影响包通过。`output/checks/lean-launch-2026-09-28/check-dev.log`。
4. 真实 Stripe 沙盒：构建依赖后运行 `stripe-sandbox.mjs --no-wait` 和 `--webhook-port 4242` 均 exit 0；后者付款/退款/验签回调全部通过。报告：`output/checks/r1-03-stripe-sandbox/sandbox-2026-09-27T22-40-19.318Z-ee3edf67-0a1b-4cc5-b877-bc4b372ca9d7.json`。随后只读查询确认该 USD 25 付款只有一笔 USD 5 成功退款：`output/checks/lean-launch-2026-09-28/stripe-refund-readback.json`。
5. 复核：独立文档与脚本审查通过；真实 adapter/HMAC/HTTP 的五个正反例通过。S.U.P.E.R 十项检查见 `output/checks/lean-launch-2026-09-28/sandbox-verification-summary.md`；code-simplifier 检查未发现需要增加抽象或扩大重构的部分。
6. 范围：本轮无本站 UI / 数据库迁移 / 正式 adapter 改动，不冒充 PostgreSQL、S3、七语商城浏览器或本站订单验收；未部署服务器、未执行真实资金交易。
7. 下一项：L1 首页排序显隐→真实预览→草稿/发布/恢复完整样板；L3 隔离本站 Stripe 链路并行。账号、邮件、身份和正式内容仍按实际条件逐项验收。

## L1 与 L3-03 本轮验收（2026-09-28）

1. 执行：root 负责组合入口/现场验收，layout_backend 负责合同/PG，layout_frontend 负责编辑器/预览，stripe_site_audit 负责隔离支付接线；launch_independent_review 独立复核。基线 `04e01d97`，远端再次检查无新变更。只使用新建 `test-l1-20260928` 和 `test-regression-layout-0928`，不迁移原体验或服务器。
2. 样板：八个现有区块排序显隐，海报/艺人/礼物必显；同一真实首页渲染器，独立 PostgreSQL 草稿/发布/恢复。发布与恢复不会覆盖海报、商品或订单；旧 722 个合同根未变，新增 9 个。实际 PG 35 项、44 个迁移/207 表完整往返通过，见 `output/checks/l1-home-layout/backend-verification.md`。
3. 浏览器：开发模式公开内容专项 545 断言、七语双端 14 场景/42 次 axe；正式构建装修发布 21 项、恢复及七语双端 107 项、重启读回 7 项通过。真实 iframe 为 390×844 / 1440×900；缓存/嵌入隔离、键盘、失败保稿、减少动态与无横向溢出通过，14 次装修 axe 无严重/致命违规。证据：`output/checks/l1-home-layout-production/`。
4. 交易回归：正式构建下新订单支付→可信返回→邮件查单→审核/送达照片→全额退款→未支付取消→支付配置审核/发布/恢复，258 断言/4 场景、零 observation/pageerror；报告 `output/playwright/p5-08-local-experience/test-regression-layout-0928-1790551372769/report.json` 为限定 COMMERCE 范围 `PARTIAL_PASS`，不冒充全套 FULL 或真实 PSP 验收。
5. 修复与原失败：补正式 API 白名单接线、保留旧授权合同、退出脏稿确认、正式验收启动器保留公共预览 origin。首轮开发期间海报观察中断（数据库 2.35 秒已成功）、并行登录超时及 Next dev 改写缓存头的失败均保留；正式构建重新通过。交易观察曾在跨页 HTTP 200 后未能读取/解析 body（与跨页观察中断相符，底层异常未留存），原 FAIL 不改写；改用既有离站前严格 CURRENT 核对和完整 RETURN 观察，所有 HTTP 失败仍拒绝，最终新订单完整重跑通过。
6. 最终门禁：`pnpm check:dev` exit 0（69 typecheck / 69 test / 38 build 任务），四项观察器负例、六项正式启动配置测试与独立复核通过。全局 S.U.P.E.R、code-simplifier 与证据入口见 `output/checks/l1-home-layout/final-verification.md`。
7. Stripe 接线：75 项本地工具/fixture 测试和真实 verifier 的合成 HMAC 检查通过，未在本轮调用 Stripe；`output/checks/l3-03-site-stripe/implementation-handoff.md` 列出隔离实例与 CLI 转发步骤。本站 Stripe 实际沙盒仍是下一项，上一轮 adapter 沙盒结果不变。
8. 用户入口：[本地操作说明](../runbooks/local-experience.md)；当前可体验实例 `test-regression-layout-0928`，管理中心→店铺装修。原实例配置/运行记录 hash 不变，秘密仍受限保存，未部署服务器、未执行真实资金交易。
