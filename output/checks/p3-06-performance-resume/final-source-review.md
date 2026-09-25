# P3-06 本地实施检查点：最终非作者源码审查与显式提交清单

Reviewer：`/root/order_bff`。分支 `codex/p3-06-performance-resume`，基线 `7d1a5391a70c655da2d0a654d47c79c11e37b04d`。

**结论：本轮已列源码范围 ACCEPT，无待修源码阻塞；可以作为本地 implementation checkpoint 的候选。P3-06 仍 IN_PROGRESS，不是性能或阶段验收通过。** 原内容不可用故障尚待新诊断 fixture 捕获，不把诊断代码的测试通过当作该产品故障已修复。

本审查仅读取源码、diff、进度、既有证据及初始受保护文件清单。未执行测试、build、数据库或 Chrome，未 `git add`/commit，未创建 worktree。唯一新增写入是本报告，不覆盖初始受保护文件。

## 最终源码兼容性

### 购物车首访提示

`cart-cookie-name.ts` 集中定义原来的 `__Host-fan-cart` 名称，`cart-proxy.ts` 仅改为引用；BFF 请求、响应、凭据、CSRF 与授权逻辑未改变。`readCartRestorationHint` 是 server-only、每请求调用 `cookies().has()`，不读取/序列化 cookie.value，也没有跨请求缓存。

`CartProvider` 新可选 boolean 默认 `true`，原消费者行为继续兼容；`useCartSession` 仍返回同一 session 或 null。false 只阻止 header 自动恢复，不把 session 的 idle/cart:null 改为“已确认空车”，不授予任何权限。手动 drawer、独立 CartBody、初始化/加购仍使用原 private transport；已有或畸形 cookie 的 true 提示只触发实际验证。多标签后续产生会话不会因旧 false 被伪为空车，用户打开仍重新读取。没有引入依赖于浏览器 cookie.value 的逻辑。

共享 `StorefrontPageShell` 改为 async server component；其现有 server JSX 消费者兼容，直接单测改为 await/stream，而不是 mock 掉异步行为。独立 gift-family shell 同样传入 hint，Promise.all 的 copy/detail/boolean 与旧 contextRead 等待含义保持。浏览器回归检查同 origin 的 GET，返回徽标按 actual added cart quantity 求和，空车明确 404/CART_NOT_FOUND；HTML private/no-store 与 raw credential 不进入 HTML 有实际回归证据。此处不声称 no-cookie functional case 是 cold-bundle 性能测试。

### 字体互斥 CSS 与所有消费者门

完整审查结论见 `font-independent-review.md`。两 profile 只将原 fontsource 全量入口换成生成 fallback，再接既有 UI CSS；所有旧 WOFF2/UI CSS/manifest/OFL 字节保留。原各 face 范围减去完整当前 UI 词库，验证全 union、不重叠、每个非 UI point 仍选择相同原资源及其真实字节，保留顺序与 descriptor。没有基于当前 fixture 文案缩小动态内容支持范围。

生成器明确分离 output/input 目录，Python hook 同时把本轮 output_dir 作为 ui-dir；资源相对路径按正式安装位置生成，未引入机器路径或 `.pnpm` 路径。临时产物用于 byte comparison，README 未误称可从任意临时目录加载。旧 `font-display` 经原 Storefront 插件转为 optional，未改加载策略。

除两项 root `check-design-foundations` 入口常量与拒绝旧 profile 的测试外，最终还核对了 `packages/design-tokens/src/foundations.test.ts`：只同步真实入口，另检查 UI/fallback 都使用本地资源；没有移除原 Latin/Thai/Vietnamese 与禁远端检查。根 package 脚本加入生成器测试，原语义/artifact/loading 门保留。锁文件、依赖声明、字体 source config 未漂移。

### 默认关闭的 TEST 诊断

完整审查与修复过的 F1 见 `read-diagnostics-review.md`。root 入口仅 env 严格等于 `1` 开启；默认不包装业务 persistence，不保留日志、不启用 gateway observer。只在 TEST scripts 接入实际 publication-runtime composition 工厂；产品 SQL、Application/catch、contracts、retry、超时、状态和预算均未修改。

新 helper 只写固定字段/枚举、受控 schema issue path、合法 request/trace ID，不写输入正文、token、完整 URL/query、SQL、error message/stack/cause。observer 失败被隔离，原对象/异常实例与操作次数保持。gateway 使用原一次读取的 bytes、原 status/header，入口捕获 phase closure 保留迟到响应的起始轮次；API 明确 COMPLETION_ONLY，不伪称 request-start 关联。transportCode 限九项固定码、最多三层 own data descriptor，不执行 getter。

诊断的额外 schema 校验与同步写文件会改变执行开销；开启时只能作为诊断条件。PG 原异常可能在既有多层映射中丢失原 SQLSTATE；当前分类不能自行恢复它。各层 operationId 也不是完整跨层共享 request ID。这些限制不由源码接受结论消除。

## S.U.P.E.R 1–10

| # | 最终源码依据 | 结论 |
| --- | --- | --- |
| 1 单一模块职责 | Cookie 协议常量、request presence reader、既有 provider/header/server shell、离线字体生成器和 TEST observation helper 各有明确职责。 | ACCEPT |
| 2 单一概念职责 | hint 不验证会话；header 只决定 auto-read；生成器区分范围差集/输入验证/产物/写入；诊断区分安全描述/阶段记录/wrapper/转发观察。 | ACCEPT |
| 3 单向依赖 | server request → boolean → client session 入口；字体固定输入 → CSS/manifest；TEST wrapper 外部观察既有端口。Domain/Application 无反向依赖。 | ACCEPT |
| 4 无新增循环 | server-only constant/helper 为叶节点；字体 helper 未反引 generator；diagnostics 仅供 fixture 与其测试消费。 | ACCEPT |
| 5 接口明确定义 | boolean props/types 保留默认兼容；字体 manifest schemaVersion/完整身份校验；诊断复用真实响应 Zod 并投影固定枚举。业务合同未变。 | ACCEPT |
| 6 可序列化边界 | server/client 仅增加 boolean；生成结果 CSS/JSON；诊断输出 JSON 投影，函数/资源只存在于既有内部 client/TEST composition。 | ACCEPT |
| 7 无新部署硬编码 | 原协议 cookie 名集中化；字体相对包位置；fixture 输出由 root 提供，phase 白名单。没有生产域名、市场、密钥等新常量。 | ACCEPT |
| 8 依赖显式 | React/Next、PostCSS/Prettier、Fontsource、项目 contracts/ports 均为既有依赖；未改 lockfile，API build closure 已有所需 dist 包。 | ACCEPT |
| 9 部件可替换 | 原 BFF/session/业务仓库独立；hint 可替换而不动授权；字体生成入口可临时再现；诊断 factory 可关闭，不改变核心逻辑。 | ACCEPT |
| 10 所需验证全通过 | 已读定向/组合/实际 UI 与 cart 通过；formal 内容失败和性能超标仍有效，共享 UI clean-checkout、最终整仓及人工门未完成。 | **不得标全 PASS；交 root 后续验收** |

## 当前已读证据与未过门

证据全部相对本报告目录；属于 root/作者已有运行，本 reviewer 没有重复执行。

- Cart targeted：9 文件 / 100 tests PASS，后续 Storefront 全集 87 文件 / 606 tests PASS；原行为 RED 与接线 RED 保留。
- Font：generator 8 PASS、subset/artifact/loading 9 PASS、最终 `check:design-foundations` 51 tests / exit 0、design-tokens 入口兼容测试 exit 0；原行为重叠/临时目录失败保留。
- `development-check-4-result.json`：check:dev 44.691 秒 exit 0，typecheck/test 各 62/62、build 36/36，有缓存。前三轮失败保留。此运行早于新 TEST diagnostics，不冒称最新 2203 输入已跑完整原 check。
- diagnostics 接入后的 `development-check-diagnostics-result.json`/log 已补读：**27.866 秒 exit 0**；typecheck 62/62（61 cached）、test 62/62（61 cached）、build 36/36（全部 cached）。日志明确 PG/S3/browser/formal 未执行。root 另报告 acceptance/operations wildcard 44 tests 全 PASS；本报告未读取其单独日志，按 root 执行回报注明，不混作 reviewer 新跑的结果。
- `storefront-ui-result.json`：源码 2201 输入 `fc433ab4…`，88 场景/88 PNG、22,705 callback 断言、85 axe 零 violations、30 incomplete 原样保留；实际七语言、两视口与交互范围。本轮未独立重新目检这些 PNG。
- `cart-browser-final-result.json`/`cart-browser-summary.json`：120.891 秒 exit 0；20 场景/40 PNG/30 axe、pageErrors 0，目标 GET/404/badge/私密 HTML 行为通过。与正式首访资源测量范围区分。
- 最终 diagnostics：`green-final-14.log` 为 14 PASS/0 FAIL、164.990 ms；迟到 HTTP 与 transportCode 行为 RED、format/lint 通过均已读。新真实诊断 fixture 正由 root 运行，未在本报告认定完成。
- `compatibility-and-protection.json`：606 旧合同 roots、96 paths、180 components、58 SQL、2438 初始未跟踪均无变化；2203 源文件 SHA `78f4b75ccb4d5e0a9fb30057fa81587aece51562f8023a5f36d1f87bfbc206ab`。本 reviewer 另实际比对候选路径与初始 protected 路径交集为空；未重复散列全部受保护历史产物。

**仍未通过/未完成：**

- 原 formal attempt-3 为 10/63、attempt-4 为 41/63 后遇真实内容不可用，均 FAIL/incomplete，根因尚未知。不能拼接剩余样本补齐。13 个完整组只有 3 个满足全部实验室门，另 10 组至少一项未达；已省 JS/字体请求不等于 LCP 普遍改善，JS SHOULD 150,000 bytes 仍有超标。
- warm 原严格字体报告仍 FAIL/exit 1，不能改称全绿。candidate-vs-existing-overlap 的 16 项 delta 对照可支持此次 CSS 改动未引入该对照下的显示差异，不证明任意文本/平台等价，也不覆盖原完整字体缺 cmap/严格浮点差异。
- P2-03/04/05 共享 UI 原门需在 root 提供实施 commit 后，于新 clean checkout 顺序执行；当前未创建/构建。详见 `shared-ui-plan.md`。
- 最新完整 `pnpm check`/最终 source identity、人工运营 3/5/8 分钟、读屏、正式关键译审/品牌素材、P4-04 商户 PSP、真机/staging/生产等门保持原状态。P3-06 不计 DONE，Phase 5 保持 LOCKED。

## 仅供 root 使用的精确本地提交清单

只列候选，**未执行任何 git 暂存/提交**。本次检查得到 23 个 tracked changes 与 13 个新增 source files；其中实现/测试 33 个、进度文档 3 个，共 36 个。下列路径与 `initial-untracked.json` 的 2438 个受保护路径交集为零。不要使用 `git add .`、全目录 output 或所有 untracked。根后续修改进度文档后应再检查其最终 diff。

同目录 `implementation-source.paths` 是 A/B/C 共 33 个精确实现路径，供 root 单独审阅后使用；D 的 3 份进度文档待 root 更新实际检查点结论后另行明确加入。该清单本身没有执行任何 Git 操作。

### A. 购物车提示与回归：14 文件

```text
apps/api/scripts/cart-storefront-browser.mjs
apps/storefront/src/server/cart-cookie-name.ts
apps/storefront/src/server/cart-proxy.ts
apps/storefront/src/server/cart-restoration-hint.ts
apps/storefront/src/server/cart-restoration-hint.test.ts
apps/storefront/src/storefront/cart-header.tsx
apps/storefront/src/storefront/cart-header-restoration.test.tsx
apps/storefront/src/storefront/cart-provider.tsx
apps/storefront/src/storefront/cart-provider-restoration.test.tsx
apps/storefront/src/storefront/gift-page-factory.tsx
apps/storefront/src/storefront/gift-page-scheduling.test.tsx
apps/storefront/src/storefront/page-factory.test.tsx
apps/storefront/src/storefront/storefront-page-shell.tsx
apps/storefront/src/storefront/storefront-page-shell.test.tsx
```

### B. 字体生成、全部产物与根消费者门：14 文件

```text
package.json
packages/design-tokens/src/foundations.test.ts
packages/design-tokens/styles/fonts/japanese.css
packages/design-tokens/styles/fonts/simplified-chinese.css
packages/design-tokens/styles/fonts/generated/fallback-manifest.json
packages/design-tokens/styles/fonts/generated/japanese-fallback.css
packages/design-tokens/styles/fonts/generated/simplified-chinese-fallback.css
scripts/check-design-foundations.mjs
scripts/check-design-foundations.test.mjs
scripts/font-ui-subset.test.mjs
scripts/fonts/README.md
scripts/fonts/generate-fallback-css.mjs
scripts/fonts/generate-fallback-css.test.mjs
scripts/fonts/generate-ui-subsets.py
```

### C. TEST 诊断与 root 接线：5 文件

```text
apps/api/scripts/gift-storefront-next.mjs
apps/api/scripts/storefront-acceptance-diagnostics.mjs
apps/api/scripts/storefront-acceptance-diagnostics.test.mjs
apps/api/scripts/storefront-acceptance-http.mjs
apps/api/scripts/storefront-acceptance-runtime.mjs
```

### D. 同步本地实施检查点与未完成状态：3 文档

```text
docs/progress/MASTER.md
docs/progress/current-overview.md
docs/progress/phase-3-storefront.md
```

本清单**不自动包含**本轮或历史 `output/` 证据。若 root 要随检查点归档，应在完成正在进行的写入后另外逐文件列举本轮新证据，明确排除 initial-untracked 清单并保留全部失败。也不要加入 dist/.next、临时配置、构建缓存、原 UI WOFF2/manifest/OFL、锁文件、业务合同或 SQL：它们不属于本轮差异。

建议 commit 语义围绕“首访购物车恢复与 CJK 字体加载优化，增加 TEST 读取诊断”，避免 `complete P3-06` 或“性能验收通过”。root 交付实际 commit 后才能继续共享 UI 独立 checkout 窗口。
