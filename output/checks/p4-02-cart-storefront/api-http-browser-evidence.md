# P4-02 API / HTTP / 浏览器证据

本报告保留字体更新前已通过的子步骤证据；字体/CSS更新后最终报告见 `run-2026-09-08T12-52-45.960Z/validation-summary.json` 与 `final-verification.md`。完整仓库联合检查由 root 另行记录。以下历史真实浏览器报告为 `run-2026-09-08T12-20-02.282Z/browser-attempt-5/browser-results.json`，原四次浏览器失败全部保留。机器可读计数及当前相关源文件 SHA 在 `harness-verification.json`。

## 实际验证

- API 最终四文件 14 tests：`cart-api-final-unit.log`；BFF 10 tests：`cart-proxy-final-unit.log`；真实 HTTP 代理单测：`cart-gateway-final-unit.log`。API / Storefront 类型及作者范围 lint / format 通过。
- 正常业务 seed 为 5757 断言、1902 请求；独立真实购物车协议为 167 断言、33 HTTP 请求。合计 5924，迁移 0024 的真实 SQL 与正常迁移器拒退另有 8 断言，不混入前者。十张表 counts / hashes 不变。
- 串行数量、授权私密编辑、逻辑删除为 3 mutation receipts / 3 durable events / 2 private-read audits；另一独立车的并发场景为 2 receipts / 2 events。相同旧版本不同 key 只有一个成功；同 key / body 并发只一次更新并返回真实重放。真实 40001 经既有 SERIALIZABLE 恢复后满足这些严格结果。
- 全七语言 × 390×844 / 1440×900 的页面与抽屉矩阵，加两端完整交互，共 16 cases、40 PNG、30 axe scans、0 violations、0 page errors。不是 30 scans 全部无 incomplete：14 个抽屉各保留一项 aria-hidden-focus、各 10 targets，总 140 targets，见 `axe-incomplete-review.json`。
- 172 个触控目标观测的最小宽高均为 44 CSS px。两端英文抽屉各实际 13 个可聚焦控件，连续 20 Tab + 20 Shift+Tab；每步必须在 popup，只有明确 Base UI inside sentinel 可在 500ms 内回到 popup。所有语言 Escape 返回触发按钮。删除首行与末行分别恢复到下一行删除按钮和购物车容器，并有 live announcement。
- 无 cookie 的真实首次加购建立 Chrome 原生 Secure / HttpOnly / SameSite=Lax host cookie；同规格不同艺人独立行。私密编辑 v1 与另一页面更新 v2 冲突，不静默覆盖；显式关闭重开读取真实原文。真实提交前 503 回退、提交后断开响应再同 key/body 重放，只产生原定 5 次 mutation。
- 私密 canary 仅运行时生成、仅内存与真正授权 editor response 接触原文；普通响应 / 页面文本 / API 日志 / 浏览器持久化均检查不含它。所有截图 mask 私密表单，失败也不截图已泄露原文的页面。未导出 Cookie、HAR、trace 或私密 DOM。

## 保留的失败与修复

HTTP 第一次失败为 fixture 用另一空车的错误 expectedCartVersion，改为该车实际版本后验证 foreign item 404；未改业务。第二次 HTTP 5896 / 27 请求通过不含后来新增并发用例，最终以 33 请求报告为准。

Browser attempt 1 是礼物独立页面遗漏 provider / CSS；页面回归测试先 RED 后修复。Attempt 2 是初次 popup 可见早于 autofocus，三次实际轨迹均从 trigger 在 50ms 内进入 close；仅增加初次焦点就绪有界等待，后续键盘门不变。Attempt 3 是页面和抽屉同名 landmark，保留页面 named section、抽屉使用 div。Attempt 4 是正常 360ms 动画途中扫描：真实 opacity 从 0 经过 0.375 / 0.897 到 1，transform 归位后同页 axe 无违规；仅截图 / axe 前等待真实视觉完成 ≤1000ms，不调用 finish、不改动画或对比度门。分时诊断和原失败 PNG / JSON 都保留。

## 可重复入口与环境范围

`pnpm --filter @fan-support/api test:postgres:cart-storefront` 运行真实协议；`pnpm verify:cart:browser` 运行 production 编译的 TEST 前台完整浏览器。`pnpm --filter @fan-support/api preview:cart-storefront` 只作新的临时预览与 smoke，不替代完整 browser gate。默认种子和每次运行各自独立；任何失败保留。

本轮使用真实 PostgreSQL、API、TLS 对象存储及媒体处理，真实加密 adapter 与本地 TEST KMS 边界；不是 AWS KMS 线上认证。前台是 HTTP localhost，Chrome 的 Secure localhost cookie 行为已实测，不能宣称生产 HTTPS 域名验收。390 只是桌面 Chrome viewport / reduced motion，不是真机；axe 和键盘不是 VoiceOver 或人工译审，也不是 P3 性能预算通过。无库存预占、订单、支付或真实数据。

最终 owner 31709 已先 SIGUSR2 暂停 Next，再 SIGTERM 正常清理；wrapper exit 0，owner 与 59129 listener 均不存在。预览 URL 已停止，PNG / JSON 是持久证据。
