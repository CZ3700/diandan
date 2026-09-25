# P4-02 购物车界面与编辑验收

状态：DONE。全部任务技术检查通过，最终非作者独立复核 ACCEPT。原整仓门按失败前缀与完整原后缀覆盖，未出现单条完整exit0；详见 gate-coverage.json。

基线 `c6ca6ba`，分支 `codex/p4-02-cart-storefront`；只本地提交。本任务交付礼物详情加购、七语言购物车抽屉/页、独立收礼艺人行、数量与逻辑删除、授权私密编辑、失败回滚与同键恢复。结账仍明确不可用，预占、订单、支付属于 P4-03 及以后。

## 实现与评审

- 普通购物车仅返回安全展示 DTO；CSRF 与未决原请求/key 只在内存。私密 editor 显式打开后，先持久授权审计、事务外 KMS 解密，再重新授权并检查版本；关闭、pagehide、卸载均清除草稿并忽略晚响应。完整留言/署名不进入普通 DTO、日志、截图或浏览器存储。
- 数量和私密草稿保留读取版本。冲突只刷新事实，须用户再次确认，不静默覆盖。提交结果不明保留同 key/body，明确失败则回滚界面。价格和独立库存策略仍由 PostgreSQL 重验，零现货的按单礼物保持可重复售卖。
- 删除保留 item、加密 intent 与不可变回执历史。历史 ADD 重放只返回 CART_ITEM_REMOVED，不复活旧行。修改回执与独立持久 `cart_edit_outbox_events` 原子提交；事件保持 PENDING，旧 v1 dispatcher 不消费，未虚构派发成功。
- `contract-persistence-review.md`：独立逐项核对 448 个旧 JSON 根、145 个旧 OpenAPI schemas、2 headers、6 security 定义保持；新增 20 根与 2 路径。旧 82 路径只有 3 个 cart 路径的 24 个响应引用扩为兼容的 CartRuntimeCurrentResponse。46 个旧 SQL 文件、23 个旧 manifest 项原字节不变。
- `api-bff-review.md` 是 API/BFF 非作者复核；Application 由 directory 非作者复核，PG 由 UI 作者交叉复核，root 负责 UI/整体整合。各报告明确作者与复核范围，没有把作者自审称为独立评审。
- code-simplifier 收敛只做共享安全投影提取、清晰版本检查与现有 token 使用；最终不再为表达偏好新增抽象或改动功能。

## RED → GREEN 与局部门

所有 Node/pnpm 命令使用 `mise exec node@24.20.0 --` 与锁定 pnpm 11.25.0；无依赖或 lockfile 变更。

- 新合同/仓储/应用/API/BFF/UI 先失败后实现。`contracts-suite.log`：67 文件 / 379 tests PASS；旧 OpenAPI path allowlist 最初失败后只增两路径，旧断言保留。
- `receipt-version-red.log` 为 3 FAIL / 13 PASS，增加数量 intent +0、私密修改/删除 +1 的回执防御后，`receipt-version-green.log` 为 3 文件 / 26 tests PASS。先前 Application 全量 439 tests PASS 属较早版本，最终结果由完整门覆盖。
- `check-dev-1.log` 首轮只因新并发测试文件格式失败；格式化后 `check-dev-2.log` exit 0：typecheck 60/60（6 cached）、test 60/60（30 cached）、build 35/35（29 cached），format/lint/工作区/架构通过。之后 UI 修复有对应定向单测、types/lint/format，不用旧开发门代替最终整仓门。
- 真实 PG 已完成 24 迁移 / 162 表 up/down/up，10 个新增 SQL PREPARE 加两项私密 hash 检查共 12 断言。旧六个 PG harness 仅适配新 head 或先正常退空 0024 后保留所有旧保护断言，最终由原全量链验证。

## 实际协议与浏览器

字体更新前最终协议/浏览器入口 `run-2026-09-08T12-20-02.282Z`，汇总见 `api-http-browser-evidence.md`、`harness-verification.json` 与 `axe-incomplete-review.json`。

- 5757 准备断言 / 1902 准备请求 +167 cart 协议断言 /33 cart HTTP 请求，共5924断言；0024 非空拒退另8断言，10张表 count/hash 保持。串行3修改回执/3事件/2私密读取审计，独立并发车2回执/2事件。
- 同版本不同 key 并发严格一成功一冲突；同 key/body 并发一次更新一次真实重放。只恢复明确 40001 中止，不把未知提交当成可任意重试。
- `browser-attempt-5`：七语×390×844/1440×900 加两端完整流程，共16 cases、40 PNG、30 axe scans、0 violations、0 page errors。14个 drawer 各保留一项 aria-hidden-focus incomplete、10 targets，总140 targets；键盘实测每端13可聚焦控件、20 Tab+20 ShiftTab、Escape及删除焦点/live region通过。不得写 incomplete=0 或等同真人读屏验收。
- 172次触控目标观测最小44×44。14抽屉截图/axe前实际opacity1、transform归位、无运行中自身动画；桌面保留正常motion，移动尺寸启用reduced motion。
- 原生 Secure/HttpOnly/SameSite Cookie 首购、同礼物不同艺人隔离、切语言重载保车、跨页私密编辑冲突、提交前503回滚、真实提交后断开响应再原key/body重放、删除与隐私检查均实际执行。所有私密截图字段均mask，未导出Cookie/HAR/trace/私密DOM。

保留全部失败：HTTP第一轮 fixture 错用另一空车版本，纠正测试后精确验证foreign item；浏览器1为独立gift页面漏Provider/CSS（RED5→86PASS），2为首开visible早于autofocus（3次实际50ms内归位，只加有界首次等待），3为重复named landmark（RED1→5PASS），4为正常360ms动画中途axe（等待真实视觉完成，不改动画/阈值）。这些失败不被后来的PASS覆盖。

## 字体、共享证据与完整门

- `check-full-1.json/log`：原单条 `pnpm check` 1.340秒exit1，停在设计门。新词库使旧子集陈旧：ja 303→332字，新增30、移除“今”；zh 322→367字。旧子集仍接管已移出UI的“今”，同时触发日文fallback断言，不能只放宽请求数。
- 按 `scripts/fonts/README.md` 原生成器与固定官方输入/SHA，更新两CSS、两WOFF2、manifest共5文件；第一次无缓存 FileNotFound 保存于 `font-regenerate.log`，第二次 `--download` 精确校验后成功于 `font-regenerate-2.log`。ja104776B、zh95820B；OFL、生成器、原fallback、字重和测试阈值均不改，不声称实际LCP提升。
- 字体41 tests先通过后，原设计扫描发现cart.css的62rem/1.25em两硬编码；换为既有layout-content-max/space-6，`font-design-green-2.log` 的41 tests和设计门全部通过。
- P2-03 原91 tests/checker通过，其交互实现/checker未变，不重复旧采集；共享字体已更新，旧P2-03不冒称新字体同源证据，新字体显示由最终七语购物车矩阵覆盖。P2-04/05的fingerprint覆盖字体资源，因此两次均用原collector；最终严格顺序刷新 `p2-04-browser-2.log` 与 `p2-05-browser-2.log`，exit0。原始72文件与第一次已通过刷新各逐SHA归档于 `shared-ui-before/`、`shared-ui-before-font-refresh/`。P2-05既有3条moderate heading-order和incomplete保留，阻断critical/serious为0，不能称所有旧组件axe零违规。
- 当前1799项实现输入冻结于 `final-source-snapshot-3.json`，摘要 `315b79316cff1cd681f16113d2e4d0dc3a54c2afff40913a46c7d5579dc4bdac`。首版至最终只增加字体5资源更新和cart.css两处token修正；旧快照完整保留。
- 字体/尺寸更新后以原 `pnpm verify:cart:browser` 重新验证，新 `run-2026-09-08T12-52-45.960Z/browser-attempt-1` 一次通过16cases/40PNG/30axe零违规，原5924协议断言及独立8项回退检查通过，14项incomplete保留。wrapper exit0，Next于12:54:37.545Z正常清理。root实际查看新中文390cart与日文1440cart截图，文案/金额/行区分可读；该证据绑定最终字体与CSS。
- 运行前 `source-before-full-2.json` 核对1799文件hash与集合，0更改/0新增/0缺失；原单条 `pnpm check` 在351.162秒于旧资源管理并发断言exit1（`check-full-2.json/log`）：96断言后SQLSTATE23514，未记录确切constraint，不能称根因已修。该脚本只迁移至0017；原脚本未改的定向复验 `resource-management-rerun.log` exit0/129断言，实际显式40001冲突与注入P0001回滚符合原断言。
- 为避免重复已通过的真实等待，从实际package scripts逐字派生三组完整原后缀：PG包从失败的resource-management起至末尾；根test:postgres剩余全部API链；根check在test:postgres之后的全部原步骤。每组前重核冻结字节，精确命令与退出保存 `check-resume-1.json/log`。最终结论必须说明前缀+后缀覆盖原门，不能改称单条完整exit0；PG原后缀12命令45.763秒exit0，API原链14项846.065秒exit0，末项新cart5924断言通过。

- 进入第三组前，冻结防漂移检测主动停止：唯一差异是原后台集成以 `next dev` 运行后自动把 `apps/admin/next-env.d.ts` 的两条 `.next/types` 导入改成 `.next/dev/types`。原脚本 `admin-workspace-http.mjs:792` 与独立复核确认来源，1798其他输入相同；不是购物车业务源码修复。暂态原字节/摘要保留于 `admin-next-env-generated-before-restore.txt` 与 `generated-declaration-restoration.json`，仅恢复这两条至冻结字节后全部1799再次匹配。不能说1799全过程无漂移。
- `check-resume-1.json` 最终状态为STOPPED_AT_SOURCE_GUARD/exit1，前两组exit0，quality组NOT_STARTED。质量后缀改由 `pnpm exec sh -c` 提供与原pnpm脚本相同的本地binary PATH，执行原8项（含S3）；此前预计的PATH错误没有发生，不编造127失败。精确命令/结果为 `check-quality-suffix-1.json/log`，108.613秒exit0：S3与真实媒体worker423断言，Prettier/lint，typecheck60/60（56cached）、test60/60（56cached）、build35/35（33cached），最后31个实际Node出口导入通过。
- `security-verification.json`：最终源后的secret scan exit0；本轮high dependency audit为No known vulnerabilities，依赖版本及lock未变。原始日志保留。

## S.U.P.E.R

| 检查 | 结论与依据 |
| --- | --- |
| 1 单一职责模块 | PASS：session、provider、editor、行、API transport、Application、Port、PG分责 |
| 2 单一概念函数 | PASS：原子修改、审计读取、授权复核、投影独立 |
| 3 单向依赖 | PASS：Browser/BFF→API→Application→Domain/Port→Adapter |
| 4 无新增循环 | PASS：已有工作区/边界检查和类型检查；最终整仓再覆盖 |
| 5 schema接口 | PASS：新command/view/receipt/event严格schemaVersion，不改旧v1根 |
| 6 可序列化 | PASS：跨模块JSON；Buffer仅加密/持久适配边界 |
| 7 配置隔离 | PASS：配置取原入口，复用token；无新硬编码生产身份/密钥/市场 |
| 8 声明依赖 | PASS：无依赖/锁文件变化；生成工具使用原固定开发依赖 |
| 9 可替换部件 | PASS：购物车业务仅依赖事务/KMS端口，UI仅依赖BFF合同 |
| 10 全部必需验证 | PASS：最终七语浏览器、PG/API/S3与原门全部步骤有通过证据；原失败/暂态声明和分段范围完整保留 |

## 验收与本地检查点

非作者最终复核见 `final-independent-review.md`：实际重新计算源/共享fingerprint/新browser摘要及2260旧文件，确认原检查链无遗漏并接受已记录边界。P4-02 DONE，释放Lane B，P4-03 READY；总计24DONE/1READY/1IN_PROGRESS/23PENDING=49。只本地提交，不push或发布；提交哈希通过Git记录定位本文件，避免把自身哈希写入被提交文件。

## 最终一致性

`source-after-all-checks.json`：1799个冻结文件的最终字节与集合匹配；0新增、0缺失，保留Next自动声明暂态例外，不隐藏过程。初始2260个未跟踪文件逐SHA核对全部保持。`gate-coverage.json` 将实际package脚本与两组PG/API续验、最后8项质量后缀逐项对照，原检查遗漏为0，并记录本地原日志摘要。

## 边界与续作入口

只有本地 TEST PostgreSQL、API、TLS S3及真实加密适配器接测试远端的证据；不是AWS/IAM认证、生产HTTPS域名、物理手机、PSP/实际收款或发布。七語新文案仍DRAFT/未人工审定。P3-06性能、人工运营、VoiceOver和翻译/资产批准继续待续且无executor，不因此关闭Phase3。

后续按 `docs/progress/MASTER.md` 领取P4-03；运行入口见 `docs/runbooks/cart-runtime.md`。复用经验：先在新增词库后运行原设计门并生成字体，再冻结共享输入并顺序运行同一 `.next` 下的原collector，最后跑整仓；否则字体/共享合同失效会导致重复采集。原Next开发集成会切换自动类型声明，冻结检查必须记录并精确恢复该副作用，不应隐去暂态变化。局部门或缓存命中不能代替真实PG和浏览器；未知提交只沿原请求/key恢复。
