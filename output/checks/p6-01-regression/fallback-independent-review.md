# P6-01 英文降级独立复核

- 日期：2026-09-23；复核者：Codex `/root/regression_coverage_audit`，不是该实现作者。
- 范围：`packages/content/src/published-content-recovery.ts`、对应测试、`published-content.ts`、`storefront-seo.ts`，以及 `apps/api/src/public-content-locale.ts` 与 `published-content-route.test.ts`。本复核只读源码并运行轻量测试，未启动服务、修改业务实现或运行真实 PostgreSQL/浏览器回归。

## 修复前发现与闭环

发现两条 P2 反例：在正常配对缺失非英语翻译后，修改仍存在的 `candidate.translations` 行的父 revision ID，或追加指向未知 metadata revision 的 `candidate.mediaTranslations` 行，公开投影仍返回 SUCCESS。原 `validatePreflightBindings` 忽略了前者的 parent 字段及后者的外来行；恢复重建候选翻译会覆盖这些现存异常。无缺失时原 `verifyPublicationManifest` 也存在该字段盲点，因此不是新内容暴露回归，但不满足新恢复边界“不修复或抹除现存异常”的要求。

作者在重建前加入所有现存候选翻译与原 snapshot 重建行的 `equalSet` 精确比较，包含 parent、ID、重复和多余行，并添加两条回归测试。独立复核确认两项关闭；无剩余本轮 P1/P2 阻塞发现。

## 修复后反例与验证

- 内存构造反例：伪造 parent、未知 media 行、重复 media 行、仅 candidate 丢行、audit 单边缺失、额外 unknown flag，均返回 FAILURE。
- 另核对：源英语缺失、重复 locale、present 文本或 audit 变动、无关 approval 丢失、错误 publication head、manifest hash 篡改及媒体权利撤回，仍失败关闭。
- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/content test src/published-content-recovery.test.ts`：14/14 PASS。
- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test src/published-content-route.test.ts`：7/7 PASS。
- 额外 6 条内存反例通过 `mise exec node@24.20.0 -- apps/api/node_modules/.bin/tsx --input-type=module` 执行；只导入包内 fixture、公开投影与 snapshot hash 函数，不接触数据库。逐例结果仅输出反例名称与 FAILURE。

## 结论与证据界限

恢复绑定原 immutable manifest hash，并对仍存在的 snapshot 内容精确匹配冻结片段；恢复后继续执行原 currentPublication、manifest、审批、媒体权利和来源验证。只允许非英语 translation/audit 配对缺失，不能通过新 flag 启用恢复。完整英语对象投影保持英语 translationRevision provenance，媒体、alias 与详情随对象整体降级；SEO 移除 fallbackUsed 语言。API 在完整 schema 验证后仅接受 V1 非英语请求降至英语，拒绝 requested locale 不匹配及其他伪降级；V2 日常原语言发布规则不变。发布写入路径没有调用恢复函数，原发布约束未降低。

本报告证明内存合同、领域投影和 API 路由边界。真实 PostgreSQL 查询形态、HTTP 缓存失效、浏览器 hreflang/sitemap 互返与线上/CDN 行为，仍须 root 的隔离集成验收；本报告不替代这些证据。

## 追加复核：canonical 持久化表示与根执行器

复核时间：2026-09-23T11:17:40Z 后；基线 HEAD `7ad8be93`，本轮工作树变更。最终恢复源码 SHA-256：`ad9d2943f4e9a53cf483a5e7b8b81223d3ec4bfe71c40756e6fbeb047bd18550`；恢复测试 SHA-256：`b1fbb81037de8cda25e71dff42e21968d1ca8b6d0f63fc8aa4d0817ee5bd02bf`。

实际 SQL 路径暴露的差异是：已存 manifest 使用原有 canonical 序列化，集合顺序、UUID 大小写及同一时间的字符串精度可能不同。新恢复比对复用既有 `canonicalPublicationValue`，没有改变该 canonical 算法，也没有对文本做归一化、去重数组或截断时间精度。恢复只追加 manifest 中确实缺少的非英语 translation/audit 及其 approval/copy，保留全部 present 原对象。所有候选行仍先做精确 `equalSet` 绑定，最终原完整验证保持。

独立反例结果：持久化 canonical manifest、仅集合排序变化均允许；真实一微秒 audit 时间变化、重复 approval、无关 approval 丢失、单边 audit 缺失、伪造 parent、额外 metadata 行均拒绝；同步篡改 present 文本的输入在合同/hash 构造阶段已拒绝。新增 inherited-copy 测试证明：缺失 ja 配对的原 copy 可恢复，但仍存在 th 配对的 copy 丢失不能被补齐。未发现恢复范围扩大到篡改数据或不完整配对。

本次独立执行：

- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/content test src/published-content-recovery.test.ts src/published-content.test.ts src/storefront-seo-proof-reuse.test.ts`：3 文件、37/37 PASS（恢复用例 20）。
- `mise exec node@24.20.0 -- node ./scripts/check-ci.mjs`：PASS。
- `mise exec node@24.20.0 -- node --test ./scripts/regression-*.test.mjs ./apps/api/scripts/regression-*.test.mjs`：40/40 PASS。
- 对 `planRegression([])` 全部固定 pnpm 命令逐项解析根 `package.json`：所有入口存在；SEO 入口已接通。

根执行器/CI 审阅结论：`test:regression-tools` 已在 Node tests 前构建 API/worker/admin/storefront 所需依赖图，避免依赖本地旧 dist。snapshot 位于仓库旁的新随机私有目录，排除 node_modules、dist、私有 .env 与旧 output，并拒绝 source 符号链接和路径穿越；安装固定锁文件并使用先前安装的包缓存，不复用业务数据库。journey 仅使用新随机 `test-regression-*` 实例，失败保留数据，完整成功且 stop 成功后才 reset。CI 的 Quality 通过 `always()` 汇总整个 regression matrix，失败或取消不能成为绿色；选跑保持 partial 覆盖。

确认原其他套件未覆盖 `admin-access-browser` 的完整七语登录/退出、OIDC 拒绝、会话故障与撤回、退出失败重试。root 已将既有 `verify:admin-access:browser` 加为 operations 首项，并增加计划断言；此改动已纳入上述 40 项 PASS。

证据边界：归档只读取隔离 output，不复制私有实例 cache、HAR、key、db 或 .log；JSON/PNG/TXT 的内容安全仍依赖各套件自身脱敏，collector 不提供内容级秘密扫描。本次没有发现具体私密输出路径。未启动 Docker/PostgreSQL/浏览器，也未运行 GitHub Actions；40 项 Node 测试使用当前已构建依赖，不能替代完整冷 CI 及 root 的真实隔离矩阵验收。无剩余明确 P1/P2 阻塞发现。

### 后续 runner 反例（2026-09-23，同轮新增发现）

P2：`verify-regression.mjs` 的 `git ls-files --cached --others --exclude-standard -z` 会包含已从工作树删除但尚未暂存的受管源码；`createRegressionWorkspace` 随后对该路径 `lstat`，以 ENOENT 终止。因此正常含本地删除改动的回归无法开始。用独立临时 git fixture 复现：新增并索引 `apps/site/deleted.ts`，只删除该临时文件，执行原 inventory 命令，再调用真实 snapshot helper；结果 `workingTreeDeletedSourceRemainsInInventory=true`、`snapshotError=ENOENT`。未改动项目文件。建议只排除 git 明确识别的已删除项，仍拒绝复制期间意外消失的其他来源；已报告 root，待其实现与验证闭环。本轮当前源码无此删除，不影响既有测试证据；这是一项后发现的执行器覆盖缺口，不是用户数据破坏。

闭环：root 已加入 `readRegressionInventory` 并接入真实 CLI，枚举时剔除 `git ls-files --deleted` 已确认删除项，复制阶段仍严格拒绝 ENOENT。独立复跑 `mise exec node@24.20.0 -- node --test scripts/regression-workspace.test.mjs`：4/4 PASS，覆盖已索引文件的本地删除、保留新文件及枚举后文件消失失败关闭。P2 已关闭。复核版本 SHA-256：workspace `ee1791a9f9f93a82ffeb0992fbe191aebe0c52ae99681fb9f72579ebbed068cd`，对应测试 `8c1ef0471730e5784f3d1d3065e5392041000eb8a2fdfec40e2085220566cb2a`，CLI `b1167f0047ba71e68a9f1454685a36742a4e770c7a1e00644b0ae0e88576083a`。

## 作者稳定版本绑定：regression_readiness

作者确认此 15 文件版本可冻结。额外审读确认：SQL 故障只作用实际查询叶节点，不改最终 DTO 或持久行；每次 pool connect 有独立 missing-ID 集合，其他事务不能继承复制证据缺失。英语源修改与回滚按正常审批发布命令进行，写入时清除只读故障；观察阶段重新施加相同日语缺失，确认真正依赖英语的 fallback 内容及失效范围。HTML 增加本地语言 fallback notice 与 heading `lang=en` 断言。独立执行 `mise exec node@24.20.0 -- node --test apps/api/scripts/regression-seo-faults.test.mjs apps/api/scripts/regression-seo-purge.test.mjs`：14/14 PASS。仅作源码/轻量证据绑定，完整新版 CLI 集成结果由 root 另行验收。

```text
ad9d2943f4e9a53cf483a5e7b8b81223d3ec4bfe71c40756e6fbeb047bd18550  packages/content/src/published-content-recovery.ts
b1fbb81037de8cda25e71dff42e21968d1ca8b6d0f63fc8aa4d0817ee5bd02bf  packages/content/src/published-content-recovery.test.ts
a206677ce09601447f2a499c7790fe48e9b8da4c0d666e1b2a1051017a3bf230  packages/content/src/published-content.ts
28f730a62b8fcb9e80b25c782d644c462b8eb20e4be867bbfde357c66c4188c0  packages/content/src/storefront-seo.ts
39dcff4bfe87a154f04f48431317e3f721000cadd9c6211e2b9ef4a1a7c8cd0e  packages/application/src/published-gift-commerce.ts
3f4d24d29b2803f702c5ae374d26fc28ccdb7635e52e593812907ee4aa2d012a  packages/application/src/published-gift-commerce.test.ts
1d04b694c7c14446dfc7de4d42c61a8e8069d1a5272e570f6cfd4a09a503f920  apps/api/src/public-content-locale.ts
450eb9006a421e0e770ef19a0bf85b5bf694f7a44615568cbfa90438fa56a296  apps/api/src/published-content-route.test.ts
85a49c3243c28287c1802d4b955a558fa267dfa9fb82b393c47668f245b1d65e  apps/api/scripts/storefront-acceptance-runtime.mjs
e3ae7d4fc66a208588a33625535d47cccbba9ea61b8a835e64c8d890bcef9ee9  apps/api/scripts/regression-seo-faults.mjs
7ff277b2b8294c94f69a8f4b2ad816f33f07fb7e09134518b7f76d07aa3cf57c  apps/api/scripts/regression-seo-faults.test.mjs
208980a8b13342d138ca81727771bd5e86b69c0dbce6c93b5a5fe3c3ab9558d7  apps/api/scripts/regression-seo-http.mjs
fda420d61c78753d4f5906bcc163051d8c47b6f5a8b26073679593d891ca8d62  apps/api/scripts/regression-seo-purge.mjs
55ffe0df842230c09fe8e89036f8fcd273d58b5e345bd9e0248499dd22b96059  apps/api/scripts/regression-seo-purge.test.mjs
120fade62560cf945ccb563dacb63d49e27a59d15ee517f930efcf04534de0bb  apps/api/scripts/regression-seo-recovery.mjs
```

## 编译版旅程启动器与其余 UI 门追加复核

作者 `seven_locale_journey` 首次宣布稳定后的只读复核：`regressionWebMode` 缺省仍为 development；显式 production 同时要求 LOCAL_TEST、专属 `test-regression-*` 名称及长度限制。编译 storefront 运行在既有 TEST tier、移除 ADMIN_* 凭据并禁用 Admin；管理中心仍执行原 development/LOCAL_OIDC 分支。`packages/config/src/server-config.ts` 的 LOCAL_OIDC 双 development 限制没有放宽。编译使用既有 preview build 合同常量，真正服务仍使用当前专属实例分配的 origin/port。

发现并通知 root/作者一项 P2：`startRegressionStorefront` 在 `await build.closed` 时没有启动取消通道，`createLocalLifecycle.stop` 先等待 startup ownership barrier，因此编译挂起时停止请求无法向 build 发送信号；若其稍后成功，仍继续 spawn start/proxy。独立内存 EventEmitter 子进程反例（不启动真实进程/服务）结果：编译期间 `signals=[]`、`stopSettled=false`；手动完成 build 后 `spawned=[build,start]` 才清理。请求补中途取消与禁止后续启动测试。此处记录发现时版本，等待修复闭环后再绑定作者最终哈希。

轻量命令 `mise exec node@24.20.0 -- node --test apps/api/scripts/regression-journey*.test.mjs apps/api/scripts/local-experience-lifecycle.test.mjs apps/api/scripts/local-experience-web-config.test.mjs`：14/14 PASS；现有用例未覆盖上述编译期间取消。

按 root 追加范围，只读运行 `mise exec node@24.20.0 -- corepack pnpm <script>`：

- `check:ui-primitives`：43/43，checker PASS。
- `check:ui-interactions`：91/91，checker PASS。
- `check:ui-composites`：16/17，唯一失败是已有 P2-04 浏览器证据与当前渲染输入哈希不符（test 第 74 行）。
- `check:ui-motion`：11/12，唯一失败是已有 P2-05 浏览器证据陈旧（test 第 81 行）。

直接调用两套实际 `collect*SourceFingerprint` 与既有 `browser-results.json` 比较：P2-04 差异 34 文件，包含 ja/zh-CN 生成 fallback CSS、manifest、配置/合同/锁文件；P2-05 差异 52 文件，额外包含之前的礼物详情/目录/购买、首页、storefront CSS、checkout/payment 等渲染输入。不是仅本轮测试脚本改变导致陈旧，已建议保留门并在最终源稳定后真实刷新。本人没有运行浏览器或修改哈希/旧证据。该失败不推翻纯结构检查结果，也不得用结构检查替代真实浏览器门。

`regression_readiness` 作者另报告其最终增强 CLI retry3 为 19,086 assertions/42 HTML cases PASS，持续 ja 英语依赖 publish/rollback 5.028s/5.185s；这是作者执行的独立隔离集成结果，引用入口 `output/checks/p6-01-regression/seo-implementation-review.md`，并非本复核者重新执行，也不是整个 P6-01 ACCEPT。

### 旅程取消 P2 闭环与作者稳定版本绑定

作者新增 supervisor `startupCancellation`，shutdown 在等待原 ownership barrier 前 abort，仅显式编译版 storefront 消费该信号；owned child 清理幂等，立即 TERM，5 秒未退出则 KILL，等待 close。build 完成后先检查取消才允许启动服务；health 阶段也检查。普通 development 启动器没有新增信号消费，管理中心开发模式约束不变。新增真实 `createLocalLifecycle` 配合 pending-child 的取消测试，验证不需要手动释放 build 即可完成 stop，且没有 start/proxy。原 P2 已关闭。

独立命令 `mise exec node@24.20.0 -- node --test apps/api/scripts/regression-journey*.test.mjs apps/api/scripts/local-experience-lifecycle.test.mjs apps/api/scripts/local-experience-web-config.test.mjs scripts/regression-journey-lifecycle.test.mjs`：18/18 PASS。

同时复核七语流程：七 locale × 双视口必须各具完整 10 步，实体/金额/币种/market/冻结语言/attempt 在 Header 切换和失败返程保持；失败后私密内容比较只在内存处理完整加密 support-intent 行及艺人/礼物/数量。业务只读池查询已 SENT 通知，再按 notification ID 从独立 TEST provider 只读池取得加密邮件并在内存验证原语言、日期与金额；不输出邮件正文或私密表单内容。截图仅在私密编辑器关闭后采集并额外 mask，滚回顶部等两帧不隐藏焦点或忽略浏览器错误。所有 pageerror 仍失败，输出仅闭合错误类型。成功报告已用 `evidenceChecks` 明示步骤证据数量，不冒充逐 assertion 计数。

最终 11 文件 SHA-256（含 root 授权的 supervisor 最小取消接线）：

```text
248fe723065947bbd5042e6d4d60df0a80cba78fb2c18f743dbfb3e006834a7c  apps/api/scripts/regression-journey-browser.mjs
13be42b46df48cc90f4bf8044545b0618a49b2b59c9fa709d54ef860a6c0ad43  apps/api/scripts/regression-journey-contract.mjs
f2db99ac63bcde23dd824956611e998171ee452f1d42ba1aa306b148fb4f30b3  apps/api/scripts/regression-journey-contract.test.mjs
87072ae112cb22a5611d8093437d201e957ae50b196d96fe6b874559c25d7c03  apps/api/scripts/regression-journey-state.mjs
70998e8b7d912a4c49047031ff53e023a1f29cc62e006ddd6a89d57dd578006c  apps/api/scripts/regression-journey-state.test.mjs
89ce40dcc68e385265bfe995442b700083b865cfea1145650cad0674901e0d34  apps/api/scripts/regression-journey-web.mjs
7b4b6d804446298a306069246dd2775c3f1a3066c3865dbd6166a745bfce0c6d  apps/api/scripts/regression-journey-web.test.mjs
330158afedec21763c09934cb131746930002202668c0090ac142cf2ff091e67  apps/api/scripts/regression-journey.mjs
6eb9305709ae1e1bfc1e27d9a58f820f81cfcfa94f702d0b58dca96eb5684567  apps/api/scripts/local-experience-web.mjs
92f0e6989b2e1dbc117306bf785bf135db11370f04c2996f3018cd48b5d93df1  apps/api/scripts/local-experience-supervisor.mjs
486f19ba901e0547d21a1e045f2118ec5b50f6001bee5f23515b3d518954caf6  scripts/verify-regression-journey.mjs
```

### 新发现：quality snapshot 缺失必需 UI 浏览器证据

P1（已报告 root，待闭环）：source-only snapshot 排除全部 `output/`，但 quality 组直接执行 `pnpm check`，其中 composite/motion 门必须读取 `output/playwright/p2-04`、`p2-05` 的持久证据。当前质量计划没有生成这两套证据的前序步骤，因此仅刷新主仓库证据不能使隔离 quality 通过；全新 snapshot 必然 missing。若选择在隔离 workspace 真实生成，另需处理其新 git 仅 init+add、尚无 HEAD，而两个 browser runner 的 collectGit 均调用 `git rev-parse HEAD`。此发现来自直接入口/实现审阅，未运行重型套件。仍须保留陈旧/缺失失败门，不应通过人工换哈希跳过真实验证。

后续源码闭环：quality 现顺序执行 `test:regression-tools`、真实 `verify:ui-composites:browser`、真实 `verify:ui-motion:browser`、原 `check`，不复制旧证据；前置 build 保证冷导入所需包完整。CLI 仅在新 owned snapshot git init/add 后创建初始 commit，固定临时 identity、关闭 GPG 与 hooks，不改原仓库；原项目 sourceHead 单独保留。CI 安装 xvfb/xauth 并通过 1920×1080 的 xvfb-run 运行矩阵，精确 CI 合同同步。独立 `node --test scripts/regression-plan.test.mjs scripts/regression-workspace.test.mjs scripts/regression-runner.test.mjs`：10/10 PASS；`node scripts/check-ci.mjs`：PASS（均经 `mise exec node@24.20.0 --`）。该 P1 的入口与缺 HEAD 原因已修；真实浏览器重建与整组通过仍由 root 验收，不能仅以本次轻量检查认定完成。

此闭环审阅版本 SHA-256：plan `14dc267c4a1c6f5ff80208fa1125f63cee769582d24d0909386ac29925672226`；plan test `21f75ec327d1707a27815e10169a41a90cae65b2fde58d651cc146265446aa67`；CLI `5b24d3e1c2d4edf57ccc18c4ad16be3503a2d821afaaa3feab527022c1e05f1a`；check-ci `99d2ba29082d9dcc960f52a9ef81f7f420cbe5385f4c885f94a1a4349be69318`；workflow `623365ff567c31a1551744c21641c00dc42642f5d6c3d06e07d57b7227cb7be9`。

旅程最终单文件补充：作者对 `regression-journey.mjs` 仅在 FAILED/CANCELED 回跳后点击真实 `[data-payment-method-refresh]`。已对照 `checkout-controller.ts:184` 的 returnLocator 只读初始化及 `checkout-client.tsx:286` 的显式 capability 加载按钮，确认此为正确测试流程，不改变产品权限或支付状态。该文件最终 SHA-256 更新为 `655b29d473e709d26c182bba8bf2a5969d66ec298620620c2e0df633190ef1be`，替代上方旧值；其余十文件未变。作者报告两返程及非法 locale 实际 targeted PASS，完整旅程仍由其随后执行。独立审阅不将该 targeted 结果计作全矩阵 PASS。

## final2 环境边界故障独立复核

root 实际运行发现：全局传入的 `FAN_SUPPORT_LOCAL_POSTGRES_BIN` 被原 P2 runner 通过 process.env 继续传给 preview，严格 config resolver 将未知 FAN_SUPPORT_* 拒绝，导致 health 500。独立只读调用真实 `packages/config/dist/server-config.js` 的 `resolveServerRuntimeConfig` 对照：相同合法 preview 三项配置，多该工具变量返回 ConfigValidationError，移除后返回 preview。没有改业务配置解析器或放宽未知键约束。

修复位于 `runRegressionSteps` 的 suite 入口：去除外层全部 FAN_SUPPORT_*，仅 journey 保留明确需要的 LOCAL_POSTGRES_BIN。通用 `runRegressionCommand` 保持显式传入环境，故下层各 harness 生成的临时 S3 配置、journey 自己建立的 REGRESSION_WEB_MODE 等不被误删。源码检索确认固定 quality/catalog/commerce/operations 没有必须继承的 FAN_SUPPORT_* 工具值；几支 standalone local-experience integration 不属于这些固定质量命令。GOOGLE_CHROME_PATH 为原生 zoom 的可选路径，固定安装 Chrome/CI 默认路径可解析；当前边界不承诺继承该外部可选覆盖。财务原生 PG 使用非 FAN_SUPPORT 的 ADMIN_FINANCE_TEST_POSTGRES_BIN，继续保留，DISPLAY、PLAYWRIGHT_BROWSERS_PATH 与 PATH 也继续保留。

独立验证：

- `mise exec node@24.20.0 -- node --test scripts/regression-runner.test.mjs scripts/regression-plan.test.mjs`：7/7 PASS，包含真正子进程检查 quality/journey 所见环境。
- 额外内存反例逐一检查所有五 suite：外层业务 origin、S3 config、旧回归 mode 与可选 Chrome 覆盖不进入子环境；仅 journey 保留 native PG；非 FAN_SUPPORT 工具变量保留；冻结的输入对象未修改。四个非 journey 清理结果再合成合法 preview 环境，真实 resolver 全部 PASS。

此范围无剩余明确 P1/P2。修复 SHA-256：`scripts/regression-runner.mjs` 为 `44a0301111812003930cfef671cc4bc287b28ae5718ea7864ac2eba3c1d27877`，对应测试为 `5d8777154002da46bd212c8fb6d5c36630ec5d2d536d159183847903c9206db2`。本复核未重启真实服务；final2 失败保留，后续完整 suite 结果仍由 root 单独验收。

## final3 旅程观察器同步与邮件页面错误检查

只读复核最后两文件改动。`regression-journey.mjs:163` 的路由仅匹配当前专属实例的 PSP origin；仅主 frame 的 navigation 请求等待已收到响应的 observer pending 集合排空，随后无参数 `route.continue()`，没有替换请求/响应、伪造成功或吞掉 observer 错误。实际 observer 仅解析 storefront origin 的 attempt GET 响应，所以等待集合不包含被暂停的 PSP 文档请求，未形成自等待。继续支付内部发出的真实 attempt 读取在旧 document 销毁前完成读取；其余一次 create、所有 reads 同 attempt、SUCCEEDED、零 observations/pageErrors 与 canonical purchase 检查全部保留。该同步范围用于旅程证据稳定性，不替代独立 SEO/cache 套件验证。

`regression-journey-browser.mjs:300` 在独立 mail context 创建任何 page 前订阅其 pageerror，记录计数并在真实安全邮件查单完成后要求为零；不记录错误正文、邮件 token 或私密内容。独立 context 仍没有 checkout cookies；原邮件语言、订单身份/金额、fragment token 清除和本地格式化断言保留。失败仍由顶层 safe failure 元数据报告，finally 关闭 context。

独立复跑 `mise exec node@24.20.0 -- node --test apps/api/scripts/regression-journey*.test.mjs apps/api/scripts/local-experience-lifecycle.test.mjs apps/api/scripts/local-experience-web-config.test.mjs scripts/regression-journey-lifecycle.test.mjs`：18/18 PASS。作者报告 HTTP 200 但旧文档 CDP body 已销毁的两次 RED，以及同步后两次真实单 case GREEN；本人未重跑这些浏览器诊断或完整矩阵。未发现上述最终差异的明确 P1/P2，完整 final3 仍待 root 真实五组汇总。

最终 SHA-256 覆盖之前同名记录：

```text
9093956870aa7ed4cafc123d4cb5c537acc5cfff413135ae2709a35f861a66c5  apps/api/scripts/regression-journey-browser.mjs
5da151fdc9318e8c523b01030d9615a6468c151edf4391bfabcadb1c509e78fb  apps/api/scripts/regression-journey.mjs
```

同次重新计算其余九个 journey/launcher 文件，仍与上方稳定版本绑定一致。

### 重要纠正：上述 route 同步静态接受被实际反例撤销

root 与作者的真实七语 checkout 切换 case 推翻了上段“未形成自等待”的静态判断：暂停 PSP 主文档请求后，旧 storefront body Promise 直到 context close 才 settle，旅程因此触发 30 秒超时。即使 pending 集合不直接包含 PSP 请求，也不能据此认定浏览器底层跨文档生命周期不存在等待环。作者已保留 `production-4` FAIL，正在撤掉 route 方案。本审阅明确撤销对该方案的接受；保留历史结论和命令结果以说明轻量测试及单 case 通过不能证明七语连续导航稳定。

后续方案须重新独立复核，不能沿用上方 main 文件哈希或结论：所有 GET HTTP 状态继续严格，离开前真实 current/status 主动验证完整 schema 与经济身份，RETURN 仍须真实 body 验证 SUCCEEDED 及同 attempt；原 observer 的默认行为不得降低。完整矩阵仍未验收。另据 root 通知，final3 的 P2 motion rAF 100 ms 门真实失败，计划停止其他自有浏览器后独立重测，阈值保持；本复核者未重跑该性能测试。

### 撤掉 route 后的新版本独立复核

源码确认已彻底移除此次 PSP route 暂停，没有 fetch 包装、响应 mock 或导航等待。共享 observer 的可选 `readBodyForStage` 缺省 true，原 P5-08 caller 没有传该参数；所有匹配的 attempt GET 非 200 在阶段谓词之前立即记录失败，默认仍读取并验证 200 body，body 不可取也继续失败。只有新旅程显式限定 RETURN body 证据，安全报告通过 `paymentBodyEvidenceScope` 明示范围。

离开前新增真实 same-origin `/api/storefront/checkout/current/status` 主动读取：完整 `paymentRuntimeResponseSchema`、SUCCESS/CURRENT/attempt 均验证；与实际只读 PG purchase 比较 checkout ID、publicOrderId、冻结语言、market、currency、total minor amount、attempt ID/checkoutSessionId/REQUIRES_ACTION。审阅时发现旧 helper 丢弃 HTTP status，已要求作者补强；现在先要求 200，新测试证明 503 即使携带 SUCCESS 字样仍失败。RETURN 仍读取真实响应并要求 SUCCEEDED、同 attempt，同时一次 create、零 observations/pageErrors 与完整矩阵门保留。独立邮件 context 错误断言也保留。

独立命令 `mise exec node@24.20.0 -- node --test apps/api/scripts/regression-journey*.test.mjs apps/api/scripts/local-experience-lifecycle.test.mjs apps/api/scripts/local-experience-web-config.test.mjs scripts/regression-journey-lifecycle.test.mjs`：22/22 PASS。新增四例分别证明默认 JOURNEY 仍取 body、主动 current 非 200 拒绝、显式跳过 body 仍拒绝 503、RETURN 非法或不可读 body 失败且不泄漏错误文本。此结论只覆盖源码与轻量反例；作者正在实际复跑 en/390、checkout 七语切换、付款与邮件组合，本复核不预判浏览器/CDP 导航稳定或完整矩阵通过。

本次重新计算全部 13 文件 SHA-256：

```text
2efcd45cffaa190627149f1ef2fc2464b7e66b31fd3811fac06585b45e2299bb  apps/api/scripts/regression-journey-browser.mjs
13be42b46df48cc90f4bf8044545b0618a49b2b59c9fa709d54ef860a6c0ad43  apps/api/scripts/regression-journey-contract.mjs
f2db99ac63bcde23dd824956611e998171ee452f1d42ba1aa306b148fb4f30b3  apps/api/scripts/regression-journey-contract.test.mjs
c51233dfc51423117e8d01b1700892a02ece94c60fa7ebc37455517d16404f8d  apps/api/scripts/regression-journey-observer.test.mjs
87072ae112cb22a5611d8093437d201e957ae50b196d96fe6b874559c25d7c03  apps/api/scripts/regression-journey-state.mjs
70998e8b7d912a4c49047031ff53e023a1f29cc62e006ddd6a89d57dd578006c  apps/api/scripts/regression-journey-state.test.mjs
89ce40dcc68e385265bfe995442b700083b865cfea1145650cad0674901e0d34  apps/api/scripts/regression-journey-web.mjs
7b4b6d804446298a306069246dd2775c3f1a3066c3865dbd6166a745bfce0c6d  apps/api/scripts/regression-journey-web.test.mjs
f0767e535cf5abc7e8af7ad5e3338536f83ae2ed35351cc82cebfffbd08adfcb  apps/api/scripts/regression-journey.mjs
1af8d9a0c5429e46acec6164a5423c8dce38950fca5347278ac77a0106bee6ca  apps/api/scripts/local-experience-browser-payment-observer.mjs
6eb9305709ae1e1bfc1e27d9a58f820f81cfcfa94f702d0b58dca96eb5684567  apps/api/scripts/local-experience-web.mjs
92f0e6989b2e1dbc117306bf785bf135db11370f04c2996f3018cd48b5d93df1  apps/api/scripts/local-experience-supervisor.mjs
486f19ba901e0547d21a1e045f2118ec5b50f6001bee5f23515b3d518954caf6  scripts/verify-regression-journey.mjs
```

该版本没有发现尚未处理的明确源码 P1/P2；此表替代上方含 route 的版本绑定，不撤销已保留的实际失败证据，也不代表 P6-01 ACCEPT。

## 全质量门后续：缓存旧断言与通知回滚前缀

root 在真实完整质量门中发现两个旧测试入口与已实现合同不同步，本轮只读复核限定三文件。`apps/api/src/public-get-revalidation.test.ts` 保留原九个 V2 原语言发布/请求 locale 不匹配场景及其负例；另拆出九个合法 V1 ja→en 英文恢复场景，验证 200、带旧 ETag 的请求仍先读取当前值再 304、恢复 ja 后返回 200/不同 ETag，以及 requested/resolved/fallback/revision/schema 五类非法上下文都返回 503、no-store、无 ETag。此前“合法英文恢复必须 503”与本轮已接受内容恢复语义冲突；变更仅更新测试，没有修改 route/缓存实现或原公共 schema。V1 translationRevision 在原合同为 optional，因此缺失不能作为非法反例；空串违反原 min(1) 约束，修正后的负例有效。这里注入的是 transport DTO fixture，不充当真实发布/审批/manifest 验证证据。

`notification-rollback-prefix.mjs` 的已知版本列表只新增 0037；未知/未来 0038 仍在任何回滚前拒绝。0037 的 admin_exception_operations、admin_exception_receipts 与 EXCEPTION_% audit 三类计数全部加入现存统一预检，任一非零在第一次 down 前失败。逐项对照未修改的 `0037_admin-exceptions.down.sql`，原 ACCESS EXCLUSIVE 锁及相同历史存在性保护仍权威执行；此前所有通知、身份、订单、退款、配置等历史保护未删减。测试将未知下一版本更新至 0038，三个新 history 反例检查 migration 调用数组仍为空，真实 PG 测试仍保留，由作者独立执行。

独立执行（未启动 Chrome、Next、Docker 或 PG）：

- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test src/public-get-revalidation.test.ts`：33/33 PASS。
- `mise exec node@24.20.0 -- node --test --test-name-pattern='^(empty known head|retained |unknown head)' packages/persistence-postgres/scripts/notification-rollback-prefix.test.mjs`：50/50 PASS，明确排除真实 PostgreSQL 用例。

此三文件无尚未处理的明确 P1/P2。实际 PG 与最终完整矩阵仍需作者/root 的真实结果，不因本次轻量通过替代。SHA-256：

```text
86ed290a37ab5085c8b5b9b309a55c10aae3578583d28487fd43b60dc0737c9e  apps/api/src/public-get-revalidation.test.ts
d6eab7bc3be051a13db516441f1500f2f17f69b9d423909be16326c3a49a37df  packages/persistence-postgres/scripts/notification-rollback-prefix.mjs
593a345ddac8ddb431d01f5d8654230bd35590fa24001c8ba9a038be786f1223  packages/persistence-postgres/scripts/notification-rollback-prefix.test.mjs
d511312cfe601d6cf7fb460b16f666e0b7822bf0653f78b376e1f65b04e29bd6  database/migrations/0037_admin-exceptions.down.sql (未修改，仅对照)
```

root 授权的 `owned-source-paths.json` 已由 57 增至 60，新增仅上述三个 tracked 文件，与最初 6144 未跟踪路径清单交集仍为零；没有 stage、提交或改动那些原文件。

## 管理登录 PostgreSQL 时钟测试前提独立复核

2026-09-23，仅复核 `packages/persistence-postgres/scripts/postgres-admin-access.mjs`，未启动 PostgreSQL、Docker、Next 或浏览器。对照完整 git diff、两处原阻塞事务和作者 `pg-admin-access-clock-review.md`：修改只将单次数据库剩余时间采样后的 host 固定 delay，改为只读查询数据库实际 deadline 条件。`expires_at + 30ms <= clock_timestamp()` 才放锁；60 秒 monotonic 预算控制轮询，空/非有限 deadline 或未观察到过期直接失败。这里的预算是轮询截止条件，不将它表述为独立数据库查询的强制超时。

原 2 秒 session TTL、30 秒 challenge TTL、30ms 余量均未变；FOR SHARE/FOR UPDATE 真实行锁和 pg_blocking_pids 可观测等待断言均保留。两个被测 blockedRevoke/blockedClaim 各只启动一次原始 transaction，轮询不调用它们，也没有期限写入或挑战重建。既有通用 run helper 的 serializable 重试未改且这两次 blocked 调用不经过该 helper；后续单独 expired READY/CLAIMED 检查原已存在。放锁后仍严格要求 UNAUTHENTICATED / LOGIN_RESTART_REQUIRED；HARNESS_FAILURE、LOGIN_CLAIMED 或任何其他结果都不能被接受。finally 清理不变。新增失败输出仅固定 scenario、既有返回 code/kind 与安全时间差，没有 token、ID、私密内容或原始错误。

独立执行 `mise exec node@24.20.0 -- node --check packages/persistence-postgres/scripts/postgres-admin-access.mjs`：exit 0；重新读取作者真实 `pg-admin-access-clock-green-1.txt`，为 PASS / 115 checks。真实 PG 执行是作者完成，本复核不将读取日志声称为本人重跑。生产 repository SHA 与作者诊断前值一致；没有修改生产 repository、迁移或合同。原 RED 的 PG 尚剩 41.453ms 且 claimed_at 早于期限 38.179ms，支持“原测试尚未满足数据库过期前提”，不证明产品到期判断故障，也不推断具体 VM 时钟原因。

此限定修复未发现未处理的明确 P1/P2，可纳入下一次冻结源。最终 SHA-256：

```text
1c08aef69d8f2425c6410e56ad8a4aa9014c8c1e4c2ab42b9e92563a43d401ca  packages/persistence-postgres/scripts/postgres-admin-access.mjs
98ba37cfede075ed0e4019ff8d7f91e2d3e256200caa1f3792bfe0683793d5a1  packages/persistence-postgres/src/admin-access-repository.ts (未修改，仅对照)
```

授权的 owned-source-paths.json 已由 60 增至 61，仅新增上述 tracked 测试脚本；与最初 6144 用户未跟踪路径交集仍为零。未 stage/提交、未改动这些原文件。完整 P6-01 验收仍等待 root 后续实际完整汇总，不以本单脚本 115 checks 替代。

## 最终候选清单与 runner/CI 复核（full-6 前）

本次 owned-source-paths.json 为 65 条，新增仅 regression-journey-publication-state.mjs 及其 test。实际 git diff --name-only 的所有 tracked 修改均在清单；git ls-files 新增、扣除原 6144 路径及 output 证据后，没有遗漏的源码/运行文档。原用户未跟踪路径与候选交集为零，未 stage/commit。18 个运行入口、计划、CI、文档与新原子性 helper 的当前 SHA 记录于 runner-final-source-hashes.json；后续修改必须重新冻结，不能沿用旧 hash 代表最终源。

只读确认五套件/17命令和14条覆盖映射，质量前置工具依赖构建与真实组件/动效证据、operations登录权限、journey compiled TEST/部分覆盖标识均保留。CI 五矩阵全部成功才允许 Quality，通过 always 上传证据，Security 独立；artifact 扩展名白名单不承担正文脱敏，与文档已一致。独立命令 `mise exec node@24.20.0 -- node --test scripts/regression-{plan,runner,workspace,artifacts,journey-lifecycle}.test.mjs` 15/15 PASS（runner-final-independent-tests.txt），check-ci.mjs PASS。未运行服务、浏览器或真实数据库。

发现新的 P1 隔离缺口：verify-regression.mjs 准备阶段把默认 process.env 传给 runRegressionCommand，Git 即使 cwd=owned workspace 仍尊重外部 GIT_DIR/GIT_WORK_TREE 等定位变量。以两个新建的纯临时 Git 仓库执行当前真实 runner 的 init/add/commit，三步全部 PASS，外侧 control 仓库 HEAD 改变，owned/.git 不存在。复现证据 runner-git-environment-independent-red.json；两个测试目录随后仅按自有路径清理，用户仓库未修改。故现有“只在副本建立提交”的保证对外部 Git 定位环境不成立。已提交 root 修复：仅 Git 准备步骤隔离所有 GIT_* 定位/配置变量，勿改变通用 runner 接收显式环境的合同。此项尚未闭环，不能判定最终 runner ACCEPT。

管理发布重试两文件已由本人转作者，独立结果仅引用 management-publication-retry-independent-review.md：readiness 完成33应用+59port测试及限定 ACCEPT，本文不对本人实现作独立验收。真实新冷启动又捕获媒体准备事务40001，正作为独立范围继续处理；完整P6-01仍未验收。

### Git ambient P1 闭环及候选清单更新

root 已增加专职 regression-environment.mjs，在源Git inventory/rev-parse、准备init/add/commit/frozen-install和各suite边界移除GIT_*，通用runRegressionCommand显式env保持。本人只读复核所有接线存在；非作者readiness的真实临时Git反例与限定结论见 git-environment-independent-review.md，root报告20工具tests PASS。runner-final-source-hashes.json更新为19文件的当前值。此前RED和历史结论保留。

media错误后的实现现由本人作者承担，不自审；完整变更及54轻量测试边界见 management-media-retry-implementation.md，等待readiness新版独立结论。候选清单现69条，当前全部tracked修改及非output新增源码覆盖完整，与原6144文件路径交集0。实际原文件逐字节不变验证由root全局门执行；这里不把交集检查等同内容SHA保护。


## 2026-09-23 finance selector independent review and final-6 evidence scope

2026-09-23; independent reviewer `/root/regression_coverage_audit`; implementation author `/root`.

Conclusion: ACCEPT the four-file test-harness selection change at the hashes below. No actionable P1/P2 found in this bounded review. This is not full P6-01 acceptance and does not establish the cause or repair of the original Docker `provider_events_time_check` failure.

The shared selector preserves the prior HTTP condition exactly: only an undefined `ADMIN_FINANCE_TEST_POSTGRES_BIN` uses Docker. Empty, relative, unavailable, operation-failing, and cleanup-failing native selections are not retried on Docker. Only the existing private-cluster harness receives the explicit bin path. Its exact ownership marker, isolated fresh data directory, PostgreSQL 18 version checks, loopback authentication, and cleanup behavior are unchanged. The selector forwards only closed runtime kind/configuredBy and native serverVersion metadata; it does not expose cluster directories, connection information, or private run IDs.

Both original HTTP/browser and storage entry points now call the shared selector. The S3 subprocess preserves the explicit tool environment; CI and regression suite environment already retain this non-FAN_SUPPORT tool variable. Storage writes actual safe runtime metadata and includes the two new runtime dependencies in its before/after input hashes. The only caller of exported runAdminFinance now supplies that metadata. The original finance fixture, host-generated event timestamps, migrations, SQL constraints, assertion thresholds, and error outcomes are byte-unchanged by these four files. The generic transaction or production configuration boundaries are not modified.

Independent lightweight commands, all exit 0:
- `mise exec node@24.20.0 -- node --test apps/api/scripts/regression-finance-database.test.mjs apps/api/scripts/admin-finance-native-postgres.test.mjs`: 12/12 PASS. These use injected native execution and database stand-ins; no real PostgreSQL, Docker, browser, or service was started by this review.
- `mise exec node@24.20.0 -- corepack pnpm exec eslint` on the four bound files, `--max-warnings=0`: PASS.
- `mise exec node@24.20.0 -- corepack pnpm exec prettier --check` on the same four files: PASS.
- `git diff --check` for the two tracked modified files: PASS.

Evidence: finance-selector-independent-tests.txt, finance-selector-independent-lint.txt, finance-selector-independent-format.txt. Parent separately supplied real native storage 6023 and HTTP PASS in finance-native-selector-precheck/report.json; reviewed this result but did not rerun it. The one separately authorized Docker numerical diagnostic passed 6023 with four occurredAt values before the same-transaction timestamp; see finance-time-diagnostic-1/review.md. Original full final-6 remains FAIL. Neither targeted PASS replaces a fresh full run.

Candidate commit manifest now contains 73 source/document paths (34 tracked modifications and 39 new source/document files), with no omitted current source changes and zero intersection with the original 6144 user-untracked paths. No staging or Git mutation was performed; see owned-source-verification-final73.json. Generated evidence and original untracked assets are excluded from that candidate manifest.

Bound SHA-256 values:
- `apps/api/scripts/admin-finance-test-database.mjs`: `351b0f6ba4d0fc8e7cf4fe0c81babc5e1a5e30bd2c41233abacf6ae1a36c63cd`
- `apps/api/scripts/regression-finance-database.test.mjs`: `c1db92a80c847b5b318d74cb546cd18e37dd0dfb9e346e5221829b14da61115e`
- `apps/api/scripts/admin-finance-http.mjs`: `e9d5f7d637de27cd9482a1637fee2adf927e3f8ed6ad0479e447deb0f30f69d6`
- `packages/persistence-postgres/scripts/admin-finance-integration.mjs`: `8c6a4dd8e0290b5888a1d44dcf54d900662da248dff291e626c7f1c4d1ec9677`


## 2026-09-23 final-7支付时间约束诊断：未复现，原因保留UNKNOWN

只读源码链路及一次明确授权的owned Docker临时数值探针见 `order-payment-time-readonly-diagnosis.md` 与 `order-payment-time-diagnostic-1/review.md`。原命令单次PASS6847/16samples；late场景occurred-minus-normalized=-37.13ms，实际occurred3位/normalized6位。原source finally恢复hash、root无改。排除本次代码的“先开record事务再调用PSP”和“normalized经Date截断”路径，但缺少旧失败数值，绝不将单次PASS或native选择器视为旧Docker因果修复。full final-7 FAIL保留。


## 2026-09-23 unified native TEST runtime independent source ACCEPT

Independent bounded source review and no-service checks accepted the 20 files bound in `unified-native-independent-source-hashes.json`; full detail `unified-native-independent-review.md`. Isolated package tests 15/15, Node tooling/lifecycle 24/24, same checks under explicit ambient common selector 15/15 + 24/24, CI contract PASS. Native ownership/version/credential boundaries preserved; common selector explicit and fail-closed; metadata records actual selected runtime. 83 candidate paths, original6144 intersection0. Acceptance is only this TEST tooling capability, neither full P6-01 nor an asserted fix of the old Docker time failures.


## 2026-09-23 fallback集成测试外层迁移独立ACCEPT

见 `fallback-test-boundary-independent-review.md` 和其3源hash绑定。移动test body与final7原件字节相同，application基础test恢复HEAD，六non-en producer与六拒绝断言保留。独立API2 +application1共3test PASS，实际adapter边界门PASS；规则/产品导出/依赖未变化。owned84是范围路径（含1个已恢复的无diff文件），实际modified/new83。full final8仍等待真实完整结果。


## 2026-09-23 final-8财务UI读生命周期诊断：未复现，原因UNKNOWN

一次原native完整UI及未改动的5秒poll通过6742断言；278语义POST读全部终结，58capture通过。目标截图入口存在当前document的orders-detail刷新，随后两个finance-detail，均200正常finish；没有本次旧document遗留。原失败请求无历史精确生命周期，不能据此宣布修复。详见`finance-read-lifecycle-diagnostic-1/review.md`，临时owned源已finally按hash恢复，root无改，原full final8 FAIL保留。


## Final-8 finance route teardown paired diagnostic

Scope: one owned loopback HTTP server, fixed `{ok:true}` JSON, Chrome 153.0.8010.53, no business application, database, credentials or private fixtures. Executed once with `mise exec node@24.20.0 -- node output/checks/p6-01-regression/finance-route-teardown-probe-1/probe.mjs`; exit 0. Script SHA-256: `d27402af31a8b9433c68e40a2d7099a916add2423969599ff42379ea7933bc20`.

Each case first intercepted a refund POST with `route.fetch()` followed by `route.abort()`, then continued the retry. The page started a semantic orders-detail POST after the retry response. The server held the read response. A removed the last route while that read was in flight and then released the response; B released the response, waited for the unchanged 5,000 ms outstanding-read gate to reach zero and the page fetch to resolve, and only then removed the route.

All 10 paired cases (20 total) completed: each read returned HTTP 200, produced exactly one requestfinished event whose Set deletion succeeded, and left zero outstanding reads. A finished in 0.954–4.890 ms from request start; B in 0.591–4.670 ms. No requestfailed or unmatched read occurred. The report's `pendingAtTeardown` field is sampled at the common held-response branching point for BOTH modes; for B it is not a measurement at its later unroute call. The source's B branch performs unroute only after both waits.

Result: NOT_REPRODUCED; the original final-8 financial-browser timeout cause remains UNKNOWN. This probe cannot establish that waiting before unroute fixes the original failure. The simplified page omits React refresh/remount, real BFF processing and full-suite history; it only tests the specified held-response last-route hypothesis. No timeout, tracking, source implementation or original evidence was changed.

`report.json` records safe fixed endpoint paths, POST method, local ordinals, phase, status and elapsed values only. `cleanedUp=true`; each owned context, the browser, and the owned server connections/listener were closed in finally. The command exited, and root was notified it could start the operations rerun.
