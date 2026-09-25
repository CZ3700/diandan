# P3-06 礼物正文与 SEO 共享读取

2026-09-17，Codex `/root`，Lane D；基线 `587b3a2`，分支 `codex/p3-06-performance-resume`。本记录属于 P3-06 的本地检查点，正式计数仍为 27 DONE / 2 IN_PROGRESS / 20 PENDING，Phase 5 仍 LOCKED。

## 实现边界

`StorefrontGift` 成功响应已经包含完整的发布证明、内容、图片、分类与市场报价。页面正文、metadata 和 Product JSON-LD 通过 `gift-content-read.ts` 共用这份请求内读取，避免两份独立内容快照混用。缓存键为 locale、handle、market、currency、idol 的原始值；variant 不改变返回全部规格的接口请求。没有跨请求缓存、自动重试、API/合同、数据库、价格、库存或支付规则变更。

- 正常市场：一次 scoped 读取，零 unscoped 读取。
- scoped 404、普通失败或意外拒绝：保留错误，不从另一路内容恢复成功。
- `MARKET_UNAVAILABLE`：随后读取介绍，不生成报价；此异常分支由并发改为顺序读取。
- 没有市场及非法查询：保持原 unscoped 内容读取和各自页面语义。
- SEO entity 仍是独立证明；发布身份或翻译版本不匹配时继续 noindex、移除 alternates/Product。日常原文语言、暂停艺人和无效规格边界保留。

## 已获得的验证

| 验证 | 结果与范围 |
|:--|:--|
| 行为 RED | 原生产源码下 76 tests：23 FAIL / 53 PASS，`gift-reads-red-result.json` |
| 定向 GREEN | 三个文件 88 tests PASS，原始 `gift-reads-green-attempt-1.log`；子命令捕获限制见 `gift-reads-implementation-results.json` |
| TEST 观察/计数工具 | root 单独执行 12 tests PASS，exit 0；`measurement-tests-result.json` |
| 全仓开发检查 | `check-dev-final-result.json`，57.564 秒 exit 0；workspace/依赖方向/format/lint/typecheck/test/build 通过 |
| Turbo 任务 | typecheck 62/62（60 cached），test 62/62（60 cached），build 36/36（34 cached）；本轮重跑 Storefront 651 tests、API 245 tests |
| 真实协议 | 实际 PostgreSQL、TLS S3、图片 worker，32,461 assertions PASS；120 艺人、26 礼物 seed |
| 完整 UI | attempt 3：88 场景、88 截图、85 axe 扫描（0 violations、30 incomplete），七语言 390×844 / 1440×900，浏览器错误 0 |
| 秘密扫描 | 显式暂存本轮文件后运行，36.33秒exit0；`secrets-staged-result.json` |
| 独立审查 | `independent-review.md`，三个生产文件和三个测试文件 ACCEPT；近期代码经 code-simplifier 复核，无需额外重构 |

全仓开发检查不等于单条完整 `pnpm check`，后者本轮未执行。axe 的 incomplete 项仍需人工判读；自动浏览器不证明手机、VoiceOver 或真人运营计时验收。

## 真实对比与保留的失败

同一 owned fixture：`output/checks/p3-06-storefront-acceptance/run-2026-09-16T17-15-30-987Z/`。每次 callback 都重建 Next，每次页面导航使用隔离 browser context、禁用 browser cache，保留完整 HTML、SEO、截图及原生读取记录。服务端、图片和数据库缓存可能已预热。

1. attempt 1 为失败基线：原生日志序号 12 比 11 先落盘，TEST 解析器错误假定文件顺序等于事件顺序。原始文件及失败未覆盖。按原生序号重排，并要求从 1 连续、唯一、每请求三阶段完整；缺号、重复、ERROR 和 TRUNCATED 仍拒绝。
2. attempt 2 为有效旧版基线：七语言双视口 14 次导航均为 `GIFT_CONTENT=1 / STOREFRONT_GIFT=1`。
3. attempt 3 为有效候选：14 次导航均为 `0 / 1`。另有真实 scoped 404、scoped HTTP 503、无市场以及市场 HTTP 409 后介绍回退四个边界；文档错误/介绍和无虚构报价断言通过。之后原完整 UI 回归通过。
4. 因首次候选中文和日文 Lighthouse 退步，追加 attempt 4 旧版→attempt 5 候选交叉复验，保持原各14次正常导航、三语言各3次Lighthouse和候选4边缘；不重复原完整UI。总计56次正常导航、8次边缘、36份Lighthouse，全部内容有效。所有原样本保留，不挑最佳值，不更改原阈值。交叉发生在原完整UI的发布/回退之后，内容已回退但proof历史增加，不是同一数据库snapshot。
5. 首轮 `check:dev` 在新测试文件格式检查失败，后续检查未运行；只修该文件格式后重新全仓运行成功。两个命令结果均保留。

性能结论与全部样本详见 `performance-analysis.md`，逐报告SHA和完整读取摘要见 `comparison-summary.json`。四轮12个语言组的LCP中位全部超预算。中文模拟LCP两轮候选均较慢，不能排除回归；B1三次实际呈现停顿在B2未重现不是修复证明。本地只接受内容一致性与功能范围，不接受性能门。诊断观察器保持开启，有限礼物对比不充作关闭观察器后的全 63 次正式性能门，也不证明之前偶发内容不可用的根因已经消除。全部5代原生日志均无ERROR/TRUNCATED，完整UI所在第3代为116请求/348条记录。

## 复跑入口

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/storefront test src/storefront/gift-page-scheduling.test.tsx src/storefront/gift-seo.test.tsx src/storefront/gift-content-read.test.ts
mise exec node@24.20.0 -- node --test apps/api/scripts/storefront-test-fetch-diagnostics.test.mjs apps/api/scripts/storefront-gift-read-verification.test.mjs
mise exec node@24.20.0 -- corepack pnpm check:dev
FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS=1 mise exec node@24.20.0 -- node apps/api/scripts/storefront-gift-read-comparison.mjs
```

比较入口读取本目录 `mode.json`，支持 `baseline` 或 `candidate`，可选 `fullMatrix`；模式必须与实际源码匹配。入口只在 TEST 启用观察器，并复用原实际服务 fixture。每次生成全新 run 目录；重建与清理只能针对本次日志返回、重新核对的 owned PID，不能复用本文历史 PID。Lighthouse 预算失败独立记录；callback PASS 只表示采样/内容和所选 UI 检查成功，不能据此宣称性能过门。

## 保护与后续

`candidate-source.json` 固定2212个验证输入，SHA `ae070dff1fc4ea83caff72f08f0e0a2b85beae365fb3391a04c1ef85c49e7590`；`initial-untracked.json` 固定开工前3,770个未跟踪文件，最终逐SHA无改动。生产源码临时交叉时保留候选逐字备份，已全部恢复到相同SHA。owned fixture已正常清理，命令exit0；该exit不替代上述逐callback与预算结论。详见 `protection-final.json`、`final-verification.json`。只本地提交，不 push、不发布。

未关闭：全部页面与七语言正式性能门、首次绘制延迟调查、人工/读屏/真机验收、商户 PSP、正式资产/译文、staging 与上线门。
