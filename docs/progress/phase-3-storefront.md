# Phase 3 — 自研 Admin、内容与浏览前台

> 状态：ACTIVE
> 任务：6  
> 解锁条件：Phase 1 与 Phase 2 退出门禁均通过

## P3-06 礼物页绘制追踪继续登记（2026-09-17）

- Owner：Codex `/root`，延续 Lane D 唯一 executor；开始 2026-09-17T04:07:33.455997+00:00，基线本地 `0fd6fd0`，分支 `codex/p3-06-performance-resume`。继续当前 ACTIVE P3-06；27 DONE / 2 IN_PROGRESS / 20 PENDING 不变，不解锁 Phase 5。
- 范围：承接上一检查点的 36 个有效但预算失败的样本，固定中文礼物页旧/当前实现各三次，共六次同条件 Lighthouse 导航；同次保留 LHR、Trace、DevTools log、原生读取窗口、发布证明与源码差异。离线复算 Lantern 关键路径和实际绘制事件，有证据才修改生产实现。
- 所有权：root 独占真实 PG/S3/Next/Chrome、编译/测量/代码切换、Git、进度和证据总报告；gift_read_impl 独占新 TEST trace runner/verifier/tests；gift_read_measure 独占新离线 trace 分析 helper/tests；gift_read_review 只读检查 SSR/绘制与测量假设并最终独立复核。不领取其他任务，不并发写同一文件。
- 验证：工具行为先 RED→GREEN；原 pinned Lighthouse/Chrome 参数、内容校验、慢网/CPU 模拟、预算和六次上限不变；测量期间无并行构建或 CPU 测试。保留全部失败，不增加预热/优选/重试，不把诊断组当七语言正式验收。随后受影响工具测试、check:dev、秘密扫描、独立复核和 S.U.P.E.R；若生产改变再补必要真实 UI/多语回归。
- 风险与保护：R-08/R-12/R-13/R-17；只用虚构 TEST 公开礼物页，不追踪支付、查单或私密内容。开始未跟踪 SHA 见 `output/checks/p3-06-gift-render-trace/untracked-baseline.json`，旧证据保留，仅本地检查点提交、不 push/merge。P3 性能/人工门与 P4-04 商户验收继续开放。

## 目标

让运营通过自研 Admin 管理首页、偶像、媒体、礼物、七语言翻译、价格和库存；让粉丝以英语为主语言并可切换简体中文、泰语、越南语、日语、西班牙语和葡萄牙语完整浏览首页、偶像与礼物。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P3-01 | DONE | Codex `/root` | P1-02、P1-04、P1-05、P1-06 | 全部内容运行时检查点通过；真实发布/回退、七语言公开读取、持久purge，见4C-2验收记录 |
| P3-02 | DONE | Codex `/root` | P2-03、P3-01 | 七语言自研Admin、真实PG/API/媒体/审核/预览/发布与回退；完整check、双端浏览器和独立复核通过，见P3-02验收记录 |
| P3-03 | DONE | Codex `/root` | P2-03、P3-01 | Admin 礼物/variant/适用关系/受控详情块/七语言/价格/库存，以及所需管理API |
| P3-04 | DONE | Codex `/root` | P2-06、P3-01 | `/:locale` Storefront shell/语言切换/首页/艺人连续横滑/搜索定位/详情 |
| P3-05 | DONE | Codex `/root` | P2-04、P3-01、P3-04 | 真实七语礼物分页/筛选/详情/选择艺人/政策；完整check、PG/HTTP、浏览器与独立复核通过，见P3-05验收记录 |
| P3-06 | IN_PROGRESS | Codex `/root`（Lane D，性能续验） | P3-02/03/04/05 | 未完性能/人工验收保留；ADR-013 允许先做 P4 本地开发，不计 DONE |

## 必须证明

- 页面由真实 PostgreSQL seed/fixture 和对象存储媒体驱动，无硬编码正式偶像或礼物。
- 内容发布后 60 秒内前台可见，失败有状态和重试。
- `en/zh-CN/th/vi/ja/es/pt`、self-canonical/hreflang/x-default/locale sitemap、locale cache、图片裁切、空/错/暂停/售罄/fallback-noindex 状态完整。
- 运营达到 3/5/8 分钟更新目标。
- 七语言关键译文批准、缺失/过期为 0；语言切换保留同一实体、购物车、market、currency 和支付上下文。

## Phase 退出证据

已于 2026-09-05 依据用户明确视觉接受与继续开发指令解锁；尚未达到退出门禁。

### 本轮有界追踪结果（2026-09-17，任务未退出）

- 工具与真实采集：新增6个TEST采集/重放脚本及测试文件；同fixture旧/当前入口各固定3次，无额外浏览器预热或替换样本。54原始文件长度/SHA全部匹配，6个同导航内容有效、原设置一致；正常gift读取旧1+1、当前0+1且均200。原32,461协议断言通过，两组之间无发布写入，组前完整公开响应相同（点证明，不冒充逐导航版本绑定）。
- 精确复算：同版Lighthouse13.4.1默认DevTools图，12个FCP/LCP误差均0。较晚图片完成让更多字体进入模型截止范围，慢样本分别结束于fallback字体、共享JS后的CPU或图片/脚本；不能把模拟显式依赖链当浏览器真实因果。图片首请求MISS/STALE约246/207ms响应等待，四次HIT约4–7ms，仍未拆分模块初始化/源读取/解码/转码成本。
- 预算与异常：旧/当前模拟LCP中位3311.5965/2620.4388ms均高于2500；实际LCP六次245–584ms，图片完成到呈现1.7–53.8ms。未重现旧约一秒间隔不等于修复；此前36份和本轮6份均保留，不称性能已改善/无回归或完整门已过。本轮LH mobile实际412×823/DPR1.75，没有重复七语双端88UI或63正式性能矩阵。
- 验证：28项观测/采集/重放tests通过，新工具RED与补强绑定RED均保留；全仓check:dev单条exit0（32.134秒），type/test62/62、build36/36，分别61/61/35cache；adapter/artifact门、显式暂存后秘密扫描exit0（36.899秒）通过；原4,117未跟踪逐SHA未变。真实fixture761.5秒后由root清理exit0，旧与当前入口已精确恢复；原2,212输入不变，最终2,218输入SHA `9a2415ffc3dfa6787b7aaae3df31d0028a0f6012874a48a5d3261fba7efd348f`。未重跑完整pnpm check、物理设备/读屏/人工运营/关键译审或商户验收。
- 复核与后续：独立证据复核与代码收敛检查未见阻塞；S.U.P.E.R十项通过仅指本工具范围，业务性能/人工门OPEN。详细结果、实际退出码、完整追踪SHA与保护结果见 `output/checks/p3-06-gift-render-trace/README.md` / `final-verification.json` / `lantern-notes.md`。下一步针对图像首次/过期响应和共享JS初始化做证据支持的最小优化，不为TEST文字裁字体或提高TTL制造暖样本。本轮无生产代码修改，27/2/20计数不变，只本地提交，不push/merge。

## P3-06 礼物正文与SEO共享读取登记（2026-09-17）

- Owner：Codex `/root`，继续 Lane D 唯一 executor；开始 2026-09-16T17:12:05.392997+00:00，基线 `587b3a2`，分支 `codex/p3-06-performance-resume`。延续P3-06，27/2/20与Phase5 LOCKED保持。
- 范围：请求内复用完整scoped礼物内容，正文/metadata/JSON-LD选择同一发布版本；正常市场页移除冗余unscoped发布读取。没有市场保留unscoped，MARKET_UNAVAILABLE才回退介绍，404/其余失败仍封闭；不增加跨请求缓存、不改API/合同/价格/库存/支付/视觉。
- 分工：gift_read_impl 独占 `gift-detail-page-reads.ts`、新共享读取模块、`gift-seo.tsx`及直接调度/SEO/共享读取测试（必要page-factory类型适配）；先只写失败测试，root完成旧版编译后再允许生产源码。root独占真实fixture/Next构建/Chrome/证据、TEST原生观测补充及计数/performance比较脚本、进度与Git。gift_read_review先只读独立审查合同与错误/SEO边界，后审最终diff；不并行构建/Chrome/PG。
- 测量子模块分工：gift_read_measure 独占TEST原生观察器与测试（新增两个礼物GET固定target），新 `storefront-gift-read-comparison.mjs` 及其专用helper；先真实HTTP RED，再以既有fixture/浏览器/Lighthouse内容校验器采集相同条件的有限诊断样本。root仍为唯一实际PG/Next/Chrome执行者。所有原指标/容量/TEST与隐私限制不变，诊断比较不充作正式关闭观测的完整性能门。
- 验证：先RED，核对scoped完整证明、无市场/非法query/不可售/404/失败/版本变化/七语言，真实Next SSR请求计数；保留同fixture前后有限样本及原始LHR，不预承诺LCP达标；候选全七语言390×844/1440×900、SEO/发布回退/键盘/错误/reduced-motion、全仓开发门与必要真实协议，独立复核/S.U.P.E.R。正式门未全过不标DONE。
- 保护：初始 3770 未跟踪逐SHA存于 `output/checks/p3-06-gift-read-reuse/initial-untracked.json`；只本地提交，无push/部署。R-08/R-12/R-13/R-17及人工/手机/PSP/上线边界保持。

### 共享读取功能检查点与性能复验（2026-09-17）

- 生产变更限3文件：新 `gift-content-read.ts` 用React请求内primitive键复用完整scoped响应，正文与SEO共同使用；只有MARKET_UNAVAILABLE随后读取介绍。404/其他失败不旁路恢复，无市场/非法query/原文lang/库存/recipient/variant保护不变。独立SEO entity仍严格比对发布/翻译版本；无跨请求缓存或新重试。
- RED：原生产代码下23/76失败；GREEN：3文件88 tests。观测工具新增真实HTTP礼物target以及异步落盘序号回归，root独立12/12 PASS。全仓开发门首轮因新测试格式exit1，修正后57.564秒exit0；62 typecheck/62 test/36 build，缓存60/60/34，本轮Storefront651/API245 tests通过。构建产物与adapter边界另有exit0证据。
- 原生TEST观察保持默认关闭、owned loopback与TEST限定、256请求/768记录容量和无URL/正文/隐私字段。实测首轮日志12先于11落盘，修正解析器按唯一连续序号重建事件，仍拒绝缺失/ERROR/TRUNCATED，保留原失败；不修改fetch/时序/响应。
- 实际fixture `output/checks/p3-06-storefront-acceptance/run-2026-09-16T17-15-30-987Z`，真实PG/TLS S3/图片worker、120艺人与26礼物seed，32,461协议断言PASS。attempt2/4旧版，attempt3/5候选；四轮56次七语言双端正常导航，旧版1 unscoped+1 scoped，候选0+1；36次Lighthouse导航也逐次确认同样计数和真实可见内容。候选四分支各复验两次：scoped404/503零unscoped、无市场只unscoped、市场409后仅介绍无offer。
- attempt3原完整UI PASS：88场景/88截图/85 axe（0 violations、30 incomplete待人工）/0 pageErrors；包含七语言390×844/1440×900、SEO、键盘/搜索/分页/返回/错误/reduced-motion。真实发布12,322ms与回退11,655ms可见，均小于60秒。不是手机/VoiceOver/人工运营计时证据。
- 性能未通过：三语言各3次×A1/B1/A2/B2共36份报告完整保留，诊断ON且不是正式63次门。A1→B1模拟LCP中位en2629→2632、zh2677→5573、ja2886→3913ms；A2→B2为2616→2626、3315→4359、2709→2711ms。B1三次约1秒实际绘制等待在B2未复现；旧版也有模拟高值，但不足以排除时序回归或声称提速。接受功能/内容一致性范围，性能保持OPEN，下一步有限成对trace/devtools取证，不降低阈值或修改浏览器特性刷分。
- 独立代码/证据审查ACCEPT，code-simplifier无额外重构。S.U.P.E.R 1单责/2职责/3依赖方向/4无环/5既有类型合同/6可序列化结果/7无新增生产硬编码/8无新依赖/9替换边界/10所选功能测试均PASS；第10不等于完整pnpm check或P3退出门已通过。
- 秘密扫描36.33秒exit0；开工前3770个未跟踪文件逐SHA无改动，owned fixture已正常清理。只本地checkpoint，无push/merge/部署。
- 复跑、原失败、四轮完整路径和输入SHA见 `output/checks/p3-06-gift-read-reuse/README.md`、`comparison-summary.json`、`performance-analysis.md`、`final-verification.json`。当前候选2212输入SHA `ae070dff1fc4ea83caff72f08f0e0a2b85beae365fb3391a04c1ef85c49e7590`；旧源仅在owned编译交叉期间临时恢复，已逐字恢复候选。P3-06仍IN_PROGRESS，27/2/20不变，Phase5保持LOCKED。

## P3-06 读取错误保真检查点登记（2026-09-16）

- Owner：Codex `/root`，继续唯一 Lane D executor；开始 2026-09-16T16:56:18.865802+00:00，基线 `75751e1`，分支 `codex/p3-06-performance-resume`。延续已有任务，27 DONE /2 IN_PROGRESS /20 PENDING 保持，Phase 5 不解锁。
- 范围：修正已证明的 PostgreSQL 错误跨内容读取嵌套边界后二次误分类，保留明确中止/暂时不可用与恢复语义；不增加自动重试、不改变事务隔离/COMMIT未知结果/发布资格、公开合同或视觉。旧自然内容错误尚不能归因为该缺陷。
- 分工：root 独占事务转换函数、读取回归测试、实际PG脚本、检查入口、文档与Git；read_error_audit 只读审查错误传播/调用者风险；first_paint_audit 只读分析已有首屏trace和SSR/bundle，不并行构建/PG/浏览器。
- 子步骤所有权补充：read_error_audit 经授权独占新 `postgres-publication-read-failure-cases.mjs` 与原 `postgres-publication-runtime.mjs` 的导入/调用；复用实际已发布艺人、独立连接真实持有行锁，原 preflight FOR SHARE 触发55P03。root继续独占构建与PG执行，error_fix_review非作者复核；先保留旧dist实际RED，再构建候选GREEN。
- 验证：先新失败单测及真实 PostgreSQL 故障传播，再最小实现、受影响包测试、原事务COMMIT/回滚保护与实际公开读取回归；全仓format/lint/typecheck/build及非作者复核、S.U.P.E.R。性能分析若无充分证据不加推测补丁，不重复已通过UI矩阵作为新功能。
- 保护：初始未跟踪 3767 项 SHA 保存在 `output/checks/p3-06-read-errors/initial-untracked.json`，已有证据不覆盖。只本地提交；R-08/R-12/R-13/R-17与原PSP/真机/人工/性能门保留。

### 读取错误保真检查点结果（2026-09-16 UTC）

- 已修复嵌套仓储重复转换标准数据库错误的缺陷，保留原code/recovery/retryAfterMs；使用现有JSON快照与合同解析清理附带信息。未知Proxy/篡改getter的初版回归经独立复核发现，新增RED后修复。没有自动重试、COMMIT/事务/发布/合同/视觉变更。
- 单测先9FAIL/68PASS，再77PASS；边界4FAIL/77PASS后81PASS。最终受影响四包1424tests PASS，独立5文件116tests ACCEPT。真实PG旧dist准确在仓储分类RED，最终原发布487断言（含新增10项55P03真实行锁与回滚/同连接恢复）及原事件时间30断言通过；事务manager原本已保留首个inner错误，不能扩大为HTTP根因结论。
- 真实HTTP目录49请求/331断言覆盖七语言、实际数据库故障503与同进程恢复；全仓check:dev45.86秒exit0（type/test62各59缓存，build36/34缓存）。本轮未跑完整pnpm check、UI或LH；前端源码全部不变。没有新增媒体字节/手机/正式支付/上线证据。
- 2207输入SHA `d10c5da1cc5c2193bb41ae34319109bdbeb5387668646cb42da8d30c09e6fd93`一致，仅3旧文件改动/1新PG测试；初始3767未跟踪逐SHA保持。最终secrets36.252秒/diff通过；S.U.P.E.R本检查点10项通过，整项P3-06仍IN_PROGRESS，27/2/20和Phase5 LOCKED不变。只本地提交，验证/复跑入口 `output/checks/p3-06-read-errors/README.md`。
- 下一具体候选：正文与SEO共用完整scoped礼物读取，减少正常市场页面重复发布证明请求；先失败测试，再保留无市场/不可售/404/当前版本不一致/七语与SEO边界，实际同条件性能测量。只读报告 `output/checks/p3-06-read-errors/performance-audit.md`；本轮未实施或宣称收益。旧自然不可用根因、性能及人工/商户门继续保留。

## P3-06 读取稳定性与首屏续验登记（2026-09-16）

- Owner：Codex `/root` 继续唯一 Lane D executor；开始 2026-09-16T09:32:59.586772+00:00，基线 `995d1c5`，分支 `codex/p3-06-performance-resume`，跟踪工作区干净。继续已有任务，不领取 Phase 5。
- 范围：按上轮原始失败与 TEST 安全观测复现公共内容读取偶发不可用，区分持久层、投影、传输与 SSR；并行只读分析保留 trace 的中文礼物真实绘制延迟。先复现/失败测试再做证据支持的最小修复，保留当前发布证明、七语言、价格和权限边界。
- 分工：root 独占运行 fixture/浏览器/构建、进度/Git及整合；order_bff 只读分析证明/事务失败条件；order_browser 只读分析现有首屏 trace；order_view 只读审查诊断覆盖与复现方案。确定根因后登记具体实现所有权，不并行改共享文件。
- 诊断子步骤：order_view 独占新增 `apps/api/scripts/gift-storefront-gateway.test.mjs`，以真实本地 HTTP 检查 TEST gateway 是否错误转发上游连接头；先记录失败，暂不修改实现。root 继续独占实际 PG/Next fixture，独立轻量 HTTP 复现不影响其数据。
- 已复现协议缺陷后的实施分工：真实 HTTP RED 证明 gateway 将上游72秒保活声明转发为自身声明，实际自身默认5秒加1秒缓冲；41次自然边界探针未出现reset，故不能归因为旧内容错误。order_view 现独占 `gift-storefront-next.mjs` 中该 gateway 的逐跳头处理及上述测试，按RFC移除连接及其指定字段，让Node按自身策略生成；不加重试、不改预算或生产读取。root负责接入原检查入口与最终真实验收。
- 下游观测补齐：现有API/gateway观察不能识别Next侧连接错误；order_view独占新 `storefront-test-fetch-diagnostics.mjs`/test、gift-storefront-next 的 start-only启用及acceptance runtime的显式Boolean接线。默认关闭，只订阅原生Undici诊断channel观察本次owned proxy的首页/艺人GET，固定字段与有界记录；不修改fetch/正文/headers/重试/timeout，不加载到build或生产运行。root负责原检查入口串接。
- 实际整合失败与窄修：首个候选真实协议32461通过，但Next健康500；新增两项 `FAN_SUPPORT_*` 诊断环境键被原严格配置白名单拒绝，尚未进入浏览器。原失败/源码冻结保留；order_view先加真实config解析兼容RED，再仅将新TEST私有键改独立 `STOREFRONT_TEST_FETCH_DIAGNOSTICS*` 前缀，不放宽生产配置。root新建修正后的实际fixture复验。
- 验证：保留新旧失败，比较等同 UI 变更历史及存活时间；受影响测试、format/lint/typecheck/build和必要真实 PG/HTTP/浏览器。生产 UI 改动再跑七语言双视口/键盘/错误/reduced-motion，性能报告必须通过同导航内容验证；不放宽预算、不拼接样本。
- 保护：本轮开始未跟踪文件 SHA 清单见 `output/checks/p3-06-read-stability/initial-untracked.json`。只做本地提交；27 DONE /2 IN_PROGRESS /20 PENDING 不变，真人/真机/PSP/Phase 5/上线门保留。风险 R-08/R-12/R-13/R-17。

### 本轮实际结果（2026-09-16）

- 修正后的最终候选输入2206项，SHA `692608036c21db82ec3a874843c275443dbb3700d38f5584202ee5d09060bae0`；相对995d1c5只改3个TEST/检查入口、增3个TEST文件，2200原输入不变。初始3386未跟踪逐SHA保持，本轮自有fixture均清理。
- 55/55定向测试、全仓check:dev27.609秒exit0（类型/测试62各61缓存，构建36/35缓存）；新实际PG/TLS S3/worker协议32461断言、Next UI22705断言/88场景/88PNG/85axe零violations、0pageErrors通过，30incomplete规则保留。发布15636ms/回退12263ms。Next观察201条/67请求，未截断，build无记录，原生HTTP完成不代表schema或故障因果。
- 首个候选健康500与config兼容RED均保留；仅更名TEST私有env解决该新冲突，生产config守卫不改。网关实际逐跳协议问题已修，但41次自然边界probe未重现旧内容错误；旧读取故障不能宣称修复。
- 原网关已加载的基线重演UI历史后84资源页/63次内容有效，仅5/21组全部预算通过，诊断ON且未重演旧44–57分钟fixture年龄，不作正式性能或候选对比。最终候选本轮没有再跑完整性能矩阵；原失败不合并或覆盖。无依据的CSS/字体补丁未实施。
- S.U.P.E.R1–9本次TEST范围ACCEPT，第10受影响/开发/协议/UI通过但任务正式性能与人工门未过。本轮未重新执行完整pnpm check，不将上轮43门当作本轮重跑。27/2/20保持，P3-06 IN_PROGRESS、Phase5 LOCKED，商户/真人/真机/上线门保持；只本地提交。最终记录 `output/checks/p3-06-read-stability/final-verification.md`，复验入口同目录README。

## P3-06 性能续验登记（2026-09-16）

- Owner：Codex `/root`，恢复本任务唯一 Lane D executor；开始 2026-09-16T06:55:54.011415+00:00，基线 `7d1a539`，跟踪工作区干净，分支 `codex/p3-06-performance-resume`。承接已有 IN_PROGRESS 任务，依赖 P3-02/03/04/05 已完成；不另领任务。
- 输入与范围：保持已确认视觉及当前真实内容/价格/库存/支付规则，核对旧性能报告与最新实现后，针对首屏图片/LCP等待链做有证据的最小优化。先保存当前生产编译版baseline与trace，编写失败测试，再实现和同条件比较；不把旧样本当新结果。
- 分工：三个子代理只读审计旧trace、服务端读链与真实harness；root拥有进度/Git、实际运行与整合。写入分工待根因和合同确认后逐文件登记；测试/构建与资源采样由root统一串行调度。
- 验证：受影响测试、format/lint/typecheck/build；真实PG/S3/API/Next/Chrome两视口/七语言、键盘/错误/reduced-motion及21组三次Lighthouse；所有失败样本保留，不能修改预算或以错误页当成功性能。非作者复核和S.U.P.E.R，按实际范围保留人工门。
- 实施所有权补充：新基线已冻结后，order_view 独占 server cart cookie名/恢复hint及测试、cart-proxy常量引用、StorefrontPageShell/GiftPageFactory/CartProvider/CartHeader及直接测试；root独占真实cart browser回归、进度/Git和统一验证。hint仅允许自动恢复，缺cookie不代表授权为空；手动打开/加购仍完整验证。order_browser只读字体trace，order_bff只读证明链，未并行改共享文件。
- 字体范围补充：真实trace与16页隔离实验确认同族UI/fallback unicode-range重叠可触发额外分片，现授权仅CSS范围互斥分配，保留原字体二进制、全部动态字集与non-UI原资源选择。order_view独占新fallback CSS生成器/测试、两profile及生成CSS、原Python生成入口尾部集成/字体README；order_browser独占font-ui-subset语义检查（总覆盖/原字形资源/互斥）及本轮隔离验证。root另独占check-design-foundations及其测试的profile入口兼容、package.json串接新生成器测试、design-tokens基础测试的旧import假设兼容，仍统一构建、Chrome性能和实际完整矩阵；冷optional系统字体像素相同不作为Noto字形证明。
- 读取故障诊断补充：两轮正式采样分别在中文首页及日文艺人页遇到真实不可用，全部失败保留。order_view 独占 TEST 验收 runtime 的已有 createPersistence 工厂观察器、新安全诊断 helper/测试及测试 gateway 的可选观察器，先 RED 后接线；只记录固定层级/枚举/计数，不记录上下文、token、原文、SQL或错误message，不增加重试、不改生产catch/守卫/预算。root统一新fixture与回归，order_bff只读原因审核，order_browser只读部分性能复算。
- 边界：P3性能及人工运营/读屏/关键译审未通过，不预先DONE；P4-04商户验收待续无executor，Phase5仍LOCKED。计数27DONE/2IN_PROGRESS/20PENDING=49；只本地提交，原2438未跟踪文件保持，详见本轮initial-untracked.json，不push/部署。

### 本轮本地实施检查点（2026-09-16，验收仍未通过）

- 本地实施提交 `0dabba9`：无 Cookie 首访跳过自动购物车恢复，手动操作及已有会话恢复仍严格验证；CJK fallback 与完整 UI 字库 CSS 范围互斥，保留旧字体字节与全部动态字集。两轮各84页资源测量中共有页面减少152,421 gzip字节、4个script请求，JS仍有超过150,000字节建议线的页面。
- 定向cart 100tests、全Storefront606tests、字体/设计静态门51tests，七语言双视口真实UI88场景/88PNG/85axe及实际cart20场景/40PNG/30axe通过；axe incomplete和字体原始严格warm FAIL分别保留。新TEST诊断14tests及接线后的check:dev通过，源码独立ACCEPT；未将开发组合门当完整check。
- 正式性能attempt-3在10/63、attempt-4在41/63遇真实内容不可用，原失败和未达标组保留。新诊断fixture协议32,461断言通过，27次页面内容正常、分层零失败，3/9组预算通过，整体仍exit1；有观测开销且缺原UI发布/回退历史，不能证明旧错误修复或充作完整63次验收。共享UI三原自动脚本已按clean-checkout顺序首轮通过，55PNG/102文件SHA相同；手机门与原moderate/incomplete保留。随后单条完整check2144.195秒exit0，43门连续通过、types/tests62（61缓存）、build36（35缓存）/32出口。最终2203输入SHA78f4b75ccb4d5e0a9fb30057fa81587aece51562f8023a5f36d1f87bfbc206ab，606旧合同/96paths/180schemas/58SQL/2438初始未跟踪保持；所有结果入口 `output/checks/p3-06-performance-resume/final-verification.md`。
- P3-06仍IN_PROGRESS，27/2/20计数不变；PSP商户、真人运营/读屏/译审和Phase5门保留，不push/部署。S.U.P.E.R第10项不预先全PASS。

## P3-06 开发效率与采样有效性登记（2026-09-08）

- Owner：Codex `/root`，继续 Lane D；开始 2026-09-08T07:42:30Z，基线 `020379c`，已有跟踪文件干净。用户要求汇报总进度、优化开发速度并继续推进。
- 范围：增加独立的日常开发检查入口，保留原 `pnpm check` 与 CI；修正 Lighthouse 每次实际导航的内容有效性证明，防止 HTTP 200 错误页参与成功页面性能汇总。只改验证工具和执行说明，不修改商品、支付或前台产品行为。
- 分工：root 独占性能采样脚本、新采样验证和进度/Git；storefront_e2e 独占新 `scripts/check-development*`；storefront_read 独占新 `docs/plan/development-cadence.md` 的执行方案，其他文件只读；storefront_directory 只读复核采样行为。子代理为同一任务下的独占文件子步骤，不另外领取 Lane 任务。
- 验证：先失败测试，再定向 Node 测试、format/lint/typecheck/build；真实本地 Chrome + Lighthouse 同导航验证正常页与 HTTP 200 错误页。没有产品代码/SQL改变，不重复真实 PG/S3 或完整 63 次性能矩阵；保留上一检查点证据与本轮边界，不将定向检查写作新整仓通过。
- 阶段顺序：已核实 P4-01 直接依赖全部 DONE；提前开展购买闭环的顺序调整已询问用户，尚未收到答复，Phase 4 仍 LOCKED。P3-06 与 22/49 DONE 计数不变；未降低现有性能、人工操作、读屏与关键译文验收要求。

### 本轮结果与下一入口

- 日常入口：`pnpm check:dev` 支持默认全仓、`--plan` 和精确包/传递依赖筛选；全仓格式/lint/工作区与领域边界始终执行，Turbo 类型/单测/构建串行复用缓存。消费者须用无筛选模式。原 `pnpm check` 与 CI 不变，检查范围和不包含的真实集成验收直接打印。
- 实测：第二次全 `check:dev` exit0，28.16秒；类型58/58（57cache）、测试58/58（56cache）、构建35/35（33cache）。第一次因新浏览器验证脚本裸 `fetch` 未符合仓库全局声明规则在lint正确停止；改为既有 `globalThis.fetch` 后完整入口重跑通过，失败日志保留。28项定向工具测试全部通过。
- 采样：增加单独 Lighthouse 内容类别，在本次测量 document 读取 URL/locale/真实标题与内容/可见错误状态；没有额外导航、等待或重试，不改标准性能权重。主内容失效和未知证明都失败；原报告先落盘再拒绝汇总，不把失败补成好样本。
- 浏览器：`storefront-acceptance-content-browser.mjs` 的最终12个实际DOM场景与2次真实Lighthouse通过；包含先预查正常、下一次实测HTTP200不可用的反例。仅验证采样工具，不能声称后端偶发不可用根因已修，也不代表七语言产品LCP达标或全部子区域状态成功。证据 `output/checks/p3-06-development-cadence/README.md`。
- S.U.P.E.R：本工具切片1–9通过（单职责的计划/执行、DOM采集/独立audit、单向依赖、versioned可序列化结果、无新依赖或生产配置）；10为本轮受影响测试/静态/类型/构建/实际浏览器通过。P3整体性能与人工验收仍未通过，不用工具检查关闭该任务。
- 下一入口：按 `docs/plan/development-cadence.md` 缩短日常反馈；P4-01的动态资格/空私密intent/当前购物车视图三项兼容缺口已完成只读审计，先等用户对阶段顺序提案的回复再改硬门。现有PG/S3、七语产品UI与完整性能证据保持历史来源，不重复生成或宣称本轮全量通过。

## P3-06 性能收尾继续登记（2026-09-08）

- Owner：Codex `/root`，继续 Lane D 唯一 executor；开始 2026-09-08T01:39:31.426931Z，基线 `fd19144d9b19c6fe7752b635dbc99cef117660b3`。用户授权继续下一阶段；先完成当前 ACTIVE 的 P3-06 可执行性能缺口，Phase 4 保持 LOCKED，不重复领取任务。
- 范围：在已验收简洁管理中心基础上，针对真实编译版移动首屏 LCP、字体请求及公共详情等待链做有证据的优化；保持现有视觉、七语言任意内容、当前发布/权利/价格/库存校验。先保存同条件 trace/devtoolsLog，区分 observed 与 simulated 指标，再以失败实验/测试约束实施。
- 隔离：当前管理预览仍运行于原 checkout；在本仓库忽略的 `.turbo/p3-06-performance-worktree` 建立独立 `codex/p3-06-performance-final` worktree，避免 build 覆盖预览 `.next`。三个代理先只读分析实际性能报告、前端依赖和后端链路；root 独占进度/共享文件/Git，实施分工另行明确。
- 实施文件所有权：storefront_read 独占 gift-detail-page-reads、gift-page-factory、gift-detail、gift-page-scheduling test、新 gift-detail 异步 section/test 与 gift-detail.css；storefront_directory 独占 site-header 与新 lazy 语言组件/test、packages/ui/src/menu.tsx、selection-controls.tsx 及受控入口测试；storefront_e2e 独占本轮 trace-preflight/test。root 独占字体诊断、构建入口、进度/证据/整合；生产改变均在 baseline 编译冻结且有效 RED 后执行。
- 后续分工：依据第一轮 trace，storefront_directory 延伸负责三个默认关闭抽屉的本地懒加载入口与 overlay 可选受控入口；storefront_read 独占 Menu 受控入口的静态门兼容、独立复核及干净工作区 P2-03/04/05；storefront_e2e 负责字体真实字节探针、最终 63 样本只读复算。root 仍独占字体产物/最终冻结/Git 和整仓验证，没有并发修改同一产品文件。
- 验证计划：准确保留 baseline 与每次样本，不改预算/协议/挑最好一次；定向 RED→GREEN、受影响测试、全仓静态/构建门、真实 PG/S3/worker/Next/Chrome 七语言双端与 21×3 Lighthouse，独立复核及 S.U.P.E.R。人工运营计时/读屏/正式关键译文与生产发布证据仍分开。
- 保护与同步：新增开始未跟踪清单见 `output/checks/p3-06-performance-final/untracked-baseline.json`；不回滚已有工作，不推送 GitHub，不停止用户正在使用的预览。仅完成实际验证后做本地检查点。

### P3-06 首屏优化实际结果（2026-09-08，Phase 未退出）

- 实现提交：本地 `7db722b4f5480ffb78eb19f5e2eec7675e50b1bd`。当前发布与报价先确认，艺人目录/市场政策独立 SSR 流式返回；语言菜单与三个抽屉按实际使用下载；中日文 UI 字体从固定官方来源生成，并保留任意动态内容的原字体回退。五个 API 验收/预览命令补齐原有 design-tokens 构建依赖，不增加运行依赖或新业务流程。
- 最终编译来源：995 项实现/样式/资产/构建输入 SHA256 `df759a88a8dd62d8f08a08eccf87f2e29781e867ffffe955e4f554b7cadce62e`，逐项与该提交相同。该清单排除测试、验证脚本和生成的 Next 声明；与早期 1640/1664 项全源码清单范围不同，不能混用。
- 真实前台：同一 PG/TLS S3/worker/API fixture 32,461 准备/协议断言通过；最终 browser-attempt-6 七语双端 88 场景/88 PNG、22,705 callback 断言、85 axe 零 violations、30 incomplete、零页面错误。发布/回退 9,177/9,368ms 可见；Header 11 场景/67 断言、Drawer 23 场景/153 断言，另 34 PNG 通过，包括触屏、冷键盘、取消、重试与嵌套。首轮触屏焦点检查捕获原 Base UI 帧间哨兵，依据既有 P2 焦点稳定等待修正探针时机，最终仍断言真实焦点回到弹层内，不接受哨兵为成功；失败证据保留。
- 字体：全部 149 个静态 UI 文案，日文 303 / 中文 322 码点，最终 96,956/84,152 B；7 产物可重复生成逐字节相同。真实 Chrome 3,692 组像素/字宽/DOM 尺寸一致、42 响应 SHA 正确；中文 weight700 的 20 个完整字符串 Canvas descent 有微小浮点差，严格零容差探针仍 FAIL/exit1，不冒称所有 metrics 相同。完整原 WebFont GSUB/GPOS 功能集合及原许可保留。OFL 上游行尾空白为精确字节许可的限定例外，不扩展到代码。
- 完整性能：browser-attempt-7 共 63 次原始 Lighthouse、21 组三次中位数，不剔除样本。评分 18/21、LCP 3/21、CLS 21/21 达标，整体 **COLLECTED_BUDGET_FAILED**；84 页首屏 JS gzip 148,428–152,024 B，14 页达 150,000 B SHOULD、70 页略超；234 张图片均达预算。礼物 JS 相比本轮基线 207,283 B 减少约 26.7%；英文/日文礼物 LCP 中位数约 2.61/3.76 秒仍未达 2.5 秒。独立逐报告复算与构建字节校验通过，实验室结论不等于 RUM。进一步确认 62 次 LCP 为内容图片，ja-artist-mobile-2 为真实临时不可用页；原三次中位数保留，不能把该次当作艺人内容成功，日志不足以归因，见 remaining-performance-diagnosis。
- 共享与整仓验证：前台 442 / UI 100 项测试、format/lint/typecheck 通过；干净 detached `7db722b4` 顺序 P2-03/04/05 浏览器通过，共 55 PNG/21 axe，保留物理设备门。原共享证据已归档再替换，真实服务/Chrome 清理证据完整。整条 `pnpm check` attempt1 在旧 P2-04 证据过期处退出1；刷新后 attempt2 的 preflight 夹具准备阶段失败，原 cause 未保留，原样166断言独立复验通过但原因未确定。最终 attempt3 于03:31:05–03:50:51 UTC单条exit0（1186.146秒）：真实PG/API/TLS S3/worker、format/lint、类型58/58（57cache）、测试58/58（53cache）、构建35/35（34cache）及31实际Node出口通过。没有改源/放宽断言，原失败完整保留；最终995输入及全部tracked代码仍与7db相同，详见本轮 `validation.json`。
- 保留与入口：`output/checks/p3-06-performance-final/README.md`、`validation.json`、`final-independent-review.md`。原 1,376 未跟踪文件中 1,375 不变；旧管理预览在预定到期附近更新其 state 后 exit0，该一项更新另记 SHA 并保留。独立审查未发现必须修复的代码问题；S.U.P.E.R 前九项通过，第十项因性能与诊断原门仍未全过。P3-06 IN_PROGRESS、22 DONE/1 IN_PROGRESS/26 PENDING（49）、Phase3 ACTIVE/Phase4 LOCKED；仍只本地提交。后续继续最终报告所支持的性能缺口、简洁管理中心真人计时、实际读屏与关键译文批准，不增新生产/PSP/真机证据。

## P3-06 用户反馈修正：简洁管理中心（2026-09-08）

- Owner：Codex `/root`，仍为 P3-06 的唯一协调 executor；承接本地 e38297a。用户明确否定复杂操作卡/角色切换/翻译包流程，要求艺人图+名+描述提交即展示、礼物图+名+描述+价格+分类上架、海报上传替换并可历史恢复；本次用户要求覆盖旧日常内容运营步骤与强制多语独立审核交互，不再请求同一授权。
- 范围：单一 Admin 管理中心、真实文件直传及自动处理、服务端可恢复发布编排、原文发布的明确语言/审核来源、真实价格和独立库存策略、海报历史恢复、前台实时可见。日常内容由同一实际授权操作者确认提交，不伪造另一审核人或七语已翻译证据。政策/付款/退款等关键内容及交易状态仍沿原严格边界。
- 设计：沿用中性黑金，左侧仅艺人/礼物/海报；主区图片列表和一个主动作，新增/编辑为单个短表单。上传即预览、提交显示处理状态、成功回到可见条目；动画只用于抽屉/预览/状态反馈并支持减少动态。避免多步骤向导、素材ID、价格簿、技术状态、培训打卡或角色窗口。
- 实施顺序：读取/审计 → 同步新决策与规范 → 冻结新发布与管理合同 → 失败测试 → 按职责拆分实现数据库/应用/上传UI → 真实PG/S3/worker/API/Admin/Storefront联动 → 双端/键盘/错误/七语言 → 全仓与独立复核。新修正保持49任务计数，P3-06 IN_PROGRESS；不以旧UAT准备成功作为本需求完成。
- 验证重点：用户真正选择新图片后提交，等待真实媒体队列与发布完成，刷新前台可见；同次重试不重复创建，失败可恢复；礼物原价/限量或按单库存策略正确，单图不伪造不同原图，海报恢复沿不可变历史；普通编辑者不能绕过发布权限；原文语言如实标记，不制造APPROVED译文。
- 保护：本次开始所有未跟踪文件SHA清单保存在 `output/checks/p3-06-management-center/untracked-baseline.json`；本地提交、不push/merge。三个代理先只读审计持久层、应用编排和Admin/E2E；合同/迁移由root冻结后分配独占文件。

### 简洁管理中心真实功能回归（2026-09-08）

- 当前 checkpoint：简洁管理中心真实浏览器与完整仓库检查均通过；P3-06 继续 IN_PROGRESS，Phase 4 不解锁。最终综合状态以 `output/checks/p3-06-management-center/validation.json` 为准。
- 交付：单一中文/七语管理中心，艺人一图+名字+描述，礼物一图+名字+描述+价格+分类，海报上传替换及历史恢复。普通内容原文直接发布，表单不要求多角色或七份译文。默认按单准备与四类礼物分开，实际限量库存和价格仍通过权威账目。
- 真实浏览器：`run-2026-09-07T23-14-15.765Z-1e58b49b` 综合 exit0，Chrome 七语言 × 390×844 / 1440×900，10 次实际发布/编辑/恢复操作，70 个公开艺人/礼物详情页；7 场景、98 PNG、98 axe，0 violations、0 pageErrors、0 observationFailures，1 项 color-contrast incomplete 保留人工复核。请求重试/重复点击、实际对象字节、原文 lang、真实价格和新艺人收礼资格均验证，未执行支付。
- 图片与历史：一张原图生成真实角色产物，CONTAIN 保留比例、低像素不放大；海报历史恢复只引用历史图片，沿用当前首页其他字段。root 实看手机艺人表单和桌面海报历史，960 宽预览清晰。
- 数据与兼容：22 迁移 /159 表真实 up/down/up 通过，原382合同定义深比较不变。价格发布复用原收据校验与不可变价格簿；outbox 新证明分支严格绑定实际日常操作，不削弱旧发布证明。
- 故障收尾：API/Application 原文 locale 门、海报 slot schema、价格创建收据最终约束顺序等均由有效失败验证后修正；管理操作事件时间使用单行单调值，原授权/租约/SQL守卫保留，受控实际PG12断言通过，但自然失败没有记录两时间，不能称已实测系统时钟倒退。旧TEST政策仅补生效后的等待余量。浏览器观察器从请求开始跟踪直至响应体与传输完成，4项定向测试及真实复跑通过，旧失败记录全部保留。
- 验证与边界：共享P2-04/05已刷新通过；完整 `pnpm check` attempt5 于 2026-09-08 00:16:12 UTC 单条 exit0，1187.855秒，type58/58（56cache）、test58/58（56cache）、build35/35（30cache）及31个Node实际出口通过。最终1637项实现输入SHA256 `7a60d6d39fa6b35b9dc566ff7c192b13fde191ef4bbae9e8d1278b1bae7339e1`；与runtime13仅七个旧TEST harness差异，产品代码未变。原文展示不冒充人工翻译批准；axe incomplete、真实读屏、运营计时、性能和生产账号/持久部署/PSP/staging门仍独立开放。当前本地体验为110分钟临时TEST环境，停止后清理其测试数据。
- 最终焦点与窗口：全仓check后窗口复验发现迟到标题聚焦会抢走已Tab到file的焦点；仅4个Admin UI/验证文件修正，保留用户新焦点、取消旧帧并清理卸载，原浏览器断言不变。controlled Chrome有效RED→3caseGREEN、非作者ACCEPT。最终1640项源码SHA `7bc844b288300d40a55b8b37449258c2e2126e761b7a3d2ca41011c9bbe30622`；全仓format/lint、type/test/build组合105/105（99cache）、边界/31出口通过；后端/DB/合同与已通过整条check的7a60源码逐字相同，未声称最终源码又重跑整条check。runtime15 `run-2026-09-08T00-27-54.438Z-de8e9e67` 7345检查/1481断言、10操作/70公开页/98截图全通过，0 violations/页面错误/观察失败、1 incomplete。真实HTTP200及ARTISTS列表就绪后打开唯一已登录中文窗口；北京时间10:17:54到期并清理临时数据。secret scan exit0。
- 保留与Git：原852项未跟踪文件和780个旧tracked output先按原字节备份，最终复核写入 preservation-final.json；旧全仓回归重写的两项报告另存本轮后恢复。只做本地检查点，不push/merge。

## P3-06 执行登记（2026-09-07）

- Owner：Codex `/root`，Lane D唯一executor；开始2026-09-07T09:35:24.293839+00:00，基线`6eacb83ff39776cb09be16ae6ac398699d180129`，分支`codex/p3-06-storefront-acceptance`。用户授权继续，Phase3 ACTIVE、P3-02/03/04/05 DONE，P3-06由READY领取；本轮只执行本任务。
- 输入：已批准V2原色黑金、真实七语言首页/艺人/礼物/政策/市场价格、不可变publication/媒体/翻译证明、持久outbox/purge，以及已有Admin与浏览器harness。先核对规范全文/完整phase/依赖风险和实际实现，不把已有测试数量当本任务完成。
- 输出与顺序：先冻结缺口与合同，接完整SEO读取、self-canonical/hreflang/x-default/OG/适用JSON-LD和分页locale sitemap；再接ETag/条件请求、locale/market/currency缓存隔离与精确发布失效；随后七语言大目录/IME/键盘/读屏/混合比例媒体、移动Lighthouse与资源预算、实际Admin运营计时及验收材料。
- 边界：不改变已批准视觉主方向，不接购物车、支付、订单或正式云发布；不凭locale猜市场，不伪造价格、评价/库存或Organization正式品牌。旧378合同根/全部历史operations保持兼容，新增跨模块接口先Zod/schemaVersion与失败测试；不修改历史已发布内容及人工审核证据。
- 证据纪律：TEST发布证明与人工正式译审分开；自动浏览器时长不当作非开发运营3/5/8分钟计时；实验室指标不当作真实用户p75 RUM；axe/可访问树不当作实际VoiceOver/NVDA。先完成所有可独立实施与验证工作、准备可操作验收包，再为确实需要人的验收获取结果，未满足退出条件不关闭Phase3或解锁Phase4。
- 所有权：root独占计划/进度/Git、共享合同exports/registry/生成物/根依赖锁及最终合并；三个子代理完成只读审计与合同冻结后按`output/checks/p3-06-storefront-acceptance/implementation-plan.md`独占后端SEO、首页拆分/既有公开GET重新验证、真实harness与UAT准备工具。root负责SEO页面/站点地图及共享cache helper。无同一文件并写，不另领取任务。
- 验证：先失败测试；七locale互返/事故fallback撤出cluster和sitemap、真实lastmod、基础分页与筛选noindex、未知参数/私密值不入SEO/cache、ETag/304与价格边界、发布/回退≤60秒及跨实例路径；受影响tests→format/lint/typecheck/build→真实PG/API/TLS S3/worker/Next/Chrome全七语390×844/1440×900、键盘/reduced-motion/重排/axe/读屏、可重复性能与运营门→非作者review、S.U.P.E.R十项与全仓check。风险R-08/R-12/R-13/R-17。
- Git：按用户决定只本地检查点、最终统一推送；保护本轮前414项未跟踪产物与全部既有验收原字节，记录`output/checks/p3-06-storefront-acceptance/untracked-baseline.json`。旧门禁如须刷新，保留历史与新回归的来源边界，不push/merge，不强制加入原始日志。

### P3-06 连续执行检查点（2026-09-08，未退出）

- 技术实现：当前发布证明驱动的七语 SEO/OG/JSON-LD、分页 sitemap、公共 ETag 条件请求与私有 no-store、0021 发布失效路径；修复公共读取之间的锁升级冲突，收敛同请求七语重复证明计算，完整审核与媒体校验保留。
- 新真实证据：`run-2026-09-07T11-46-25-432Z` protocol 32,461 累计准备/协议断言与 6,090 管理请求通过；63 并发读成功，数据库 deadlocks 0→0。PUBLISH 14,562ms、ROLLBACK 17,291ms 可见。compiled browser callback 22,692 断言通过，84 页面组合/4 交互、88 PNG、85 axe 零 violations，30 incomplete rules 保留待逐类复核。后续等待环境结束记录 FAIL，不将 callback 与整体环境退出混为一谈。
- 整仓冷测试以包级并发 2、content 文件 worker 2 完成 58/58、0 cached；原断言和 5 秒门未变。此前两次默认并发超时反证保留，最终整条 `pnpm check` 与 Lighthouse/资源采样尚未完成。
- 继续时重新核对 1,515 项源码/配置/测试输入与冻结清单完全一致，SHA256 `fe46825ee20b329c3291f632a556388381e4f80a9fa6ec76e92ff19e9da6d000`；已有实现和浏览器结果可连续使用。
- 第二轮实际性能：`run-2026-09-07T17-13-43-828Z` 完整 63 次 Lighthouse / 84 资源页；LCP 21/21 组超标，分数仅 5/21 组达 90，CLS 和图片预算通过，JS 331,928–345,161 bytes 超出建议。原失败全保留。随后将首页/艺人目录从主视觉等待链中拆出、礼物独立读并行、临时加载字体用现有系统字 token、公共合同隔离内部依赖；另修复浏览器实测顶栏遮挡弹层。前台 46 files / 316 tests、types、相关 lint/format 与依赖 6/6 build PASS；非作者复审 ACCEPT。新冻结 1,526 files、SHA256 `5cafc7406b4213ac07c35e2d8a5e304b5efea745dcba4d7e1f22dfa071df4b5b`；新生产 build + 双端 smoke 于 17:47:23 UTC PASS，完整新矩阵/性能及整仓门待复测。详见 `performance-iteration-2-implementation.md`。
- 第三轮首屏减包：63条公开route编译入口不再静态加载Zod/内部proof；精确locale纯值、目录按需完整验证、Server购买展示+Quantity小client、Server筛选初值+按需schema。完整前台52files377tests、types与全仓format/lint PASS，独立边界复审76tests PASS；实际首次交互故障注入9cases51assertions PASS。6页JS203,468–207,239 bytes，LCP2,785.8–3,918.9ms仍未达lab目标，CLS0；新完整矩阵/63次LH进行中，未改测量方法/预算。源码1,540files，`662dcb3e30ca0d97e070e90262a7e8b6945d5b52ba12088a338ea7d119cc148f`。
- 第三轮完整验收（18:38 UTC前完成）：同一662源码的84页面组合/4交互、88PNG PASS；85axe零violations，29 color-contrast incomplete/533节点、1 aria-hidden-focus incomplete/3节点保留，实际弹层9/9命中。真实发布/回退10,418/10,240ms均在原60秒门内。63次LH完整收集、21组各三次中位数：score20/21、LCP1/21（2,416.4–5,415.9ms）、CLS21/21（全部0）；84资源JS203,468–207,239B仍超150KB SHOULD，236图片全达SHOULD，0资源失败。性能状态COLLECTED_BUDGET_FAILED，不以正常fixture清理exit0覆盖失败。共享P2-04/P2-05新浏览器回归各exit0；最终冷test与整仓check继续串行执行。
- 最终静态门同步：整仓attempt3被旧locale.ts本地声明假设阻断，原失败保留。仅修正foundation/interactions四个检查器与测试文件；32/59定向tests及实际两gate、格式/lint通过。最终1540输入SHA256 `3572b837e0ed6d532fc6d967a22763d64a1c6fb921c1281443104c61e4c75c94`；与662产品来源仅四个验证器差异，所有应用/资产/依赖构建输入不变，浏览器与性能证据可继承。整仓attempt4从头执行。
- 最后检查修复：attempt4准确暴露旧.at(-1)取0021而未测试0020历史保护，精确version目标修后真实PG117项通过。静态绑定检查独立复审发现三类遮蔽，修后66项及实际gate通过。attempt5完整PG/API/S3与format/lint/type/test/build通过后，末端adapter guard拒绝src内测试helper导入typescript；现移到包内test-support，noEmit/build rootDir分离，九测试/实际adapter/31exports通过，其余296个生产编译文件逐字节不变，独立复审ACCEPT。最后1540源SHA `59ebd051a135110a3cf01b6b22bc5c373f83e41ad2b79a0b07e2dd166fe2a04d`；P2-04/05分别26.511/37.662秒通过，完整attempt6正在执行。
- 最终整仓验收：attempt6于19:51:02 UTC整条exit0，1207.834秒；真实PG/API/TLS S3/媒体worker、format/lint、type58/58（28 cache）、test58/58（29 cache）、build35/35（30 cache）、31Node实际出口通过。独立bounded冷test58/58零缓存；最后protocol run19-44真实32,461断言/6,090 setup请求通过。1540实现与59ebd051冻结完全一致，原414项仍未跟踪且字节一致；818保留旧output核对通过，两项重写JSON先存本轮副本后恢复。共享P2新证据保留，原五次完整check失败均保留。S.U.P.E.R 1–9 ACCEPT，第10 PARTIAL（性能及人工门未完成）；总记录 `validation.json`。
- 状态仍 IN_PROGRESS，22 DONE / 1 IN_PROGRESS / 26 PENDING；真实非开发运营 3/5/8 分钟、读屏及其他未满足门不以自动化代替。Phase 3 ACTIVE、Phase 4 LOCKED，未推送或合并。证据入口 `output/checks/p3-06-storefront-acceptance/README.md`。

## P3-05 执行登记（2026-09-07）

- Owner：Codex `/root`，Lane B唯一executor；开始2026-09-07T06:38:55.240243+00:00，基线`4c7adf15dbb0933d3afea382f4a6f333b8b0b7e5`，分支`codex/p3-05-gift-storefront`。用户授权继续；P2-04/P3-01/P3-04 DONE，Phase3 ACTIVE，P3-05 READY后领取；只领取本任务。
- 输入与输出：复用已发布商品/变体/真实价格与三类库存策略、七语详情与媒体、P3-04 shell/艺人搜索/图片。完成礼物服务端分页/筛选/金额排序/URL与后退恢复、七语详情/规格与数量展示、未选艺人选择、真实政策及加载/空/下架/不可用/失败/fallback-noindex；必要公开读取与BFF一起实现。
- 商品语义：VIRTUAL/PHYSICAL/WISH/MERCHANDISE/OTHER与TRACKED/PROCURE_ON_DEMAND/PREORDER独立；无库存的按单准备仍可重复展示为可售，有限库存按canonical余额，工作室准备/采购后转交艺人。市场/币种来自校验上下文与真实数据库，语言切换不选市场、不改金额；不在内容文字中复制库存价格。
- 视觉与范围：沿用V2原色黑金，商品图片居主位，桌面紧凑工具栏、手机筛选抽屉、清晰页码/结果数与收礼艺人上下文。完整购物车/support_intent/支付属于Phase4，不做假加购或浏览器持久化私密留言；政策使用现有受审发布内容，正式条款/时效/市场仍需后续运营决定，不擅自编造正式承诺。
- 所有权：root拥有计划/进度/Git、共享exports/registry/生成物/根配置锁、页面组合/详情/政策/i18n。三个子代理先只读审计服务端商品与市场/政策读链、分页筛选交互、真实联合harness；合同冻结并登记精确文件所有权后再并行实现，不交叉改同一文件/迁移。
- 验证：合同/测试先行，覆盖分页上限1000与out-of-range空页、同价稳定排序/筛选金额精度、URL重复非法参数、未选/不适用/暂停艺人、按单/低库存/售罄/预售、七语详情/关键政策拒绝fallback、当前价格/发布证明与隐私；受影响tests→format/lint/typecheck/build→真实PG/API/TLS S3/Next/Chrome全七语390×844/1440×900、键盘/错误/reduced-motion/320px及重排/axe→独立复核、完整仓库门与S.U.P.E.R。R-01/R-13/R-17；沿用既有测试5秒门限，记录P3-04并行artifact初始化波动，必要时以实测定位后最小修复，不放宽断言。
- Git：只本地检查点提交、最后统一推送；保护原261项未跟踪产物，不push/merge；原始运行日志依仓库规则仅本地保留，结构化结果和截图随检查点交付。

## P3-05 验收记录（2026-09-07）

- 状态：DONE；最终完整门于2026-09-07T08:48:57.366664+00:00通过，Lane B释放。Phase3仍ACTIVE（5/6），全局22 DONE /1 READY /26 PENDING，共49；仅解锁P3-06，本轮不领取，Phase4仍LOCKED。
- 交付：七语言真实礼物目录、结果数/分页/分类/金额/可售状态/价格排序、URL/刷新/原生后退恢复；详情包含完整原色图片、受审描述和结构化块、艺人搜索选择、规格/真实价格/数量边界、工作室转交说明和真实政策。市场/币种由数据库当前配置显式选择，语言不推断市场，跨礼物链接清除旧规格，语言切换保留当前实体和商业上下文。
- 商品与读取：VIRTUAL/PHYSICAL/WISH/MERCHANDISE/OTHER与TRACKED/PROCURE_ON_DEMAND/PREORDER独立。TRACKED采用单一有效位置最大实际可用量，不累加仓位；按单准备与预售不制造库存记录。暂停/不适用艺人、无效规格、不可用价格/发布证明均明确拒绝，不静默换商品。两条公开GET经Application/Domain/Port/PG，严格BFF绑定scope/locale/entity/recipient与目录cardinality；政策缺失或关键fallback拒绝正文，详情/政策不存在返回真实404。
- 兼容：旧373合同根、113 OpenAPI schemas及全部旧HTTP operations逐项深比较不变；新增5根（总378）、4 schemas（总117），无新迁移/第三方依赖，当前20迁移/153表。真实PG DOMAIN数组问题以`currency::text`最小聚合修正，不放宽发布/价格/当前授权条件。
- 测试先行与修复：保留公开读取/offer/目录/选择状态RED→GREEN；浏览器发现并修复政策导航同名、规格group语义、非BFCache原生Back表单恢复。内部focus guard允许短暂转移的oracle严格沿用P2上限500ms，普通外部焦点立即失败；这是测试oracle修正，未改共享弹层。后退诊断明确pageshow.persisted=false，不冒充BFCache命中。
- 完整门禁：`mise exec node@24.20.0 -- corepack pnpm check`最终整条exit0（08:34:37Z至08:48:57Z），全部真实PG/HTTP/TLS S3/worker、format/lint/typecheck/test/build/依赖与构建出口通过；最终type/test各58/58（58 cached）、build35/35（35 cached），31出口经Node实际导入。独立完整冷测试`turbo run test --force --output-logs=errors-only`58/58、0 cache、36.735秒通过，contracts52文件/319 tests，storefront36文件/221 tests。最终完整门复用这些缓存，不称零缓存整条check。
- 反证与维护：首次完整check真实前缀通过后因browser harness单处格式失败exit1；原失败记录保留。合同严格路径清单补齐真实两接口；动态import移到文件级后单文件通过，但全仓仍7340ms超时。仅contracts包worker上限改为2后冷测试通过，原5秒预算、两次独立完整渲染/字节freshness/全部断言不变；不承诺所有机器从此无波动。源码与证据详情见`test-maintenance-review.md`。
- 真实协议：本轮15714断言/1902 setup请求，来自实际管理会话/七语作者与独立审核/价格簿/库存/发布、PG/API/TLS S3及媒体worker；旧P3-04再次15221断言/5006请求通过。媒体联合423断言通过真实重试/租约/数据库恢复，尝试1/2/1/1/2；120艺人/120礼物目录307断言通过。正式身份和资产仍非本轮结论。
- 浏览器：最终attempt7对应冻结源码，七语言390×844/1440×900，8组场景、55PNG、10 axe零违规零incomplete、44重排、33/33响应式图片实际解码、0 pageErrors。完整总21266=协议15714+build/health2+browser5550；不能全称浏览器断言。键盘/IME/Escape/筛选取消/Back/语言上下文/无效范围/JPY精度/错误/404/reduced-motion全部通过。31本机未限速指标不冒充正式性能预算。
- 共享与预览：P2-04/05最终真实浏览器刷新分别18PNG/10axe与22PNG/3axe，指纹见`shared-browser-summary.json`；P2-05新真机门仍明确保留。最终check后恢复同一临时TEST预览，attempt8短smoke通过，中文目录200、未知礼物404；未覆盖attempt7完整证据，不将短验证混入完整计数。
- 冻结与复核：1428实现输入摘要`689ca8596cac257223c7b3f0445314aebd5c00a34ed48d7bfdad22a05e1a8122`前后逐项一致；源清单排除docs/output和Next自动环境声明。非作者后端/目录/前台/测试维护/交付进度复核均ACCEPT，code-simplifier仅做本范围职责收敛，S.U.P.E.R十项PASS（逐项见检查README）。secrets/diff通过，原261项未跟踪产物hash全未变且不暂存，旧P3-04 HTTP证据原字节已恢复，两次新回归另存。
- 证据与复跑：`output/checks/p3-05-gift-storefront/README.md`、`validation.json`、`check-final-result.json`、`check-final-summary.txt`及独立review；`output/playwright/p3-05-gift-storefront/results.json`、attempt7、55PNG校验清单。原始日志和旧重复截图仅本地保留，结构化诊断与最终图包随检查点交付。操作手册`docs/operations/storefront.md`。
- 后续边界：正式人工译审仍DRAFT，正式素材/市场/政策、PSP、staging/生产和新真机未验收；P3-06负责SEO/OG/structured data/sitemap/hreflang/cache、读屏、运营3/5/8分钟与正式性能预算。完整购物车、加密support_intent、库存预留和支付/订单/履约属于Phase4，本轮结算入口有明确禁用说明。只本地提交，不push/merge。

## P3-04 执行登记（2026-09-07）

- Owner：Codex `/root`，Lane B 唯一 executor；开始 2026-09-06T22:30:16.916943+00:00，基线 `fc6e28e6a6ec8ef7cd3316ef901c7e104c1bb1d6`，分支 `codex/p3-04-artist-storefront`。用户明确继续下一阶段，依赖 P2-06/P3-01 已 DONE，Phase 3 ACTIVE；只领取 P3-04。
- 范围：公开 locale 路由、导航/独立语言切换、真实发布首页、艺人连续横滑与分批加载、跨名字搜索建议/稳定 ID 定位、艺人详情；服务端读取与必要 BFF，以及七语言和完整错误/空/暂停/回退状态。
- 视觉：沿用已批准 V2 原色黑金画廊；大幅双端人物海报、留白与金色操作，真实多色媒体为主。首页按海报、艺人、精选礼物、三步说明与信任、最终入口组织。仅保留已有轻量入场/菜单/焦点交互与 reduced motion；装饰动效后续打磨。
- 所有权：root 拥有 storefront 页面/视觉/路由组合、共享导出/合同/根配置/锁文件、计划进度与 Git。子代理先独立只读审计公开读取、目录交互与真实联合浏览器夹具；冻结边界并明确独占文件后才实现，不并行领取其他任务。
- 首页边界冻结：storefront_read 独占新增 storefront-homepage 合同/Port/Content/Application/PostgreSQL/HTTP 文件及主 persistence runner、API composition/bootstrap/production 接线与对应 tests；新增三个 roots，不改旧 370，不需要迁移。另独占 storefront 的 public-catalog client 与 tests，负责当前请求 locale/HTTP 响应绑定。root 独占共享 exports/registry/生成物。
- 联合验收所有权：storefront_e2e 独占 `apps/api/scripts/storefront-*.mjs` 与新证据目录；真实 PG/HTTPS S3/worker/Next/Chrome，120 个明确 TEST 身份，两组原创双端素材与三件多色礼物。源图不足时原像素嵌入中性测试画布，逐像素 hash 与几何证明，不上采样、不伪造摄影原始分辨率。
- 媒体增量：目录作者后续独占 PublishedImage 与 Next image config/tests，接官方 getImageProps、精确 origin 限制的可重建多尺寸优化图；root 继续页面/样式。保留原发布字节、衍生元数据与所有当前版权证明。
- 目录边界冻结：storefront_directory 独占 `apps/storefront/src/storefront/artist-directory*`、`artist-search*`、`artist-track*`、`directory-*`（含 tests/CSS），消费原 `IdolDirectoryResponse` 和 `GET /api/storefront/idols` 的 locale/q/anchorId/after/limit；root 提供 `./copy` 的 StorefrontCopy 和 `./published-image` 的 PublishedImage。paused 仍有详情链接，cursor 按 locale/q/limit 绑定；不引入新业务状态合同。
- 验证：先失败测试，覆盖 locale 与商业上下文隔离、SSR/公开合同、搜索 IME/竞态/定位/分页/失效游标、暂停与媒体失败。受影响 tests → format/lint/typecheck/build → 真实 PostgreSQL/API/对象媒体/Next/浏览器；全七语 390×844 与 1440×900，键盘、错误、reduced motion、320px/重排、axe 与性能记录；非作者复核、完整 check 和 S.U.P.E.R 十项。
- 边界：无硬编码正式艺人/品牌/市场；不把样板静态数据当业务源。P3-05 礼物分页筛选与政策、Phase 4 交易仍后续。正式素材/人工译审/生产市场/PSP/staging 与真机不冒充已验收。追踪 R-01/R-07/R-08/R-12/R-17。
- Git：按用户既有决定只本地提交，最终统一推送；保护本轮前全部 261 项未跟踪产物，不 push/merge。

## P3-04 验收记录（2026-09-07）

- 状态：IN_PROGRESS → REVIEW → DONE；验收时间 2026-09-07T00:16:55.385949+00:00，非作者复核 ACCEPT、全部适用门通过，Lane B释放。Phase3仍ACTIVE（4/6）；全局21 DONE /1 READY /27 PENDING，共49。只解锁P3-05，本轮不领取后续任务。
- 交付：七语言公开shell/导航与语言切换、真实发布首页、艺人连续横滑/服务器cursor分批加载、跨语言姓名别名搜索/IME/建议/稳定ID直接定位、详情与完整空/错/暂停/恢复状态。切换语言和进出详情保留艺人及商业查询上下文；沿用批准的V2原色黑金视觉，交易预留页不提供假下单。
- 读取与兼容：新增homepage聚合经Application/Port在单SERIALIZABLE事务加载当前明确引用，Hero失败封闭，其他不可用推荐不替换艺人；严格绑定当前locale/发布证明/真实媒体。旧370 roots逐项不变，新增3（373总计），无迁移，20迁移/153表。真实目录时间越界以稳定事务和必要授权/历史下限修复，实时session/MFA/到期和SQL guard不变；新10与旧258目录PG断言通过，受控证明不冒充自然墙钟观测。
- 图片与路由：双端Hero独立构图，手机按真实比例占位；卡片焦点裁切、srcset不超源宽，精确HTTPS origin/衍生路径/格式/重定向门。七语缺失艺人真实HTTP404；主页/目录只在局部提供loading，避免详情提前流出200。production界面必须通过英文源及目标实际hash/人工审核，全部DRAFT清单保留；正常动态内容七语缺失仍失败封闭。
- 最终真实协议：15,221断言、5,006 setup请求、120经正常七语审核发布的TEST艺人；真实PG/API/TLS S3/worker，当前head/handle/暂停/归档均实际验证。素材为两组原创虚构成年人物及三件多色礼物，低像素原图嵌入TEST画布且原像素不放大，不冒充正式摄影。
- UI：Next编译产物在TEST运行，七语言390×844/1440×900，共51最终截图、59案例、48重排、10 axe零violations、81真实图片候选解码、0未处理浏览器错误。198个轨道外contrast incomplete有原始targets和人工17.87/8.17对比度复核，不计作自动通过。LCP最大1028ms/CLS0仅本机未节流DPR1观察；图片bytes是在强制eager验证后采集，不是首屏预算。62533为诊断重跑累计断言，不称最终独立计数。
- 回归：P2-04（16场景/18PNG/10axe/原生200%）、P2-05（8场景/22PNG/3axe）重新通过。首个P2-05并行帧率失败保留且未改门限。正式真机本轮未重验。
- 最终全仓门为**同源分段通过**：`check.log`通过全部静态前置、合同、PG/HTTP/S3及423媒体恢复，因output一次性证明脚本bare URL在lint退出1；仅该辅助脚本修为globalThis.URL，8测试通过，1374实现输入未变。原样执行check从prettier起全部后缀，最终exit0；type58/58（58 cached）、test58/58（56 cached）、build35/35（30 cached）、31 Node出口。并行合同首测5000ms再次超时，独立314测试0-cache通过后最终复用缓存；未改断言/预算，未宣称整条pnpm check exit0或并行波动已修复。详见validation.json和check-resume-command.txt。
- 源码：1374项输入最终摘要 `49fd55e1470ce9ca5e16f5fb82cde578580f8e50bbb06237b365778e1b094d5d`，前后逐项一致；docs/output/Next生成环境声明不在源码清单。旧261项未跟踪产物hash全未变且不暂存；secrets、显式证据日志扫描及diff通过。非作者领域/传输/目录/图片/404/语言清单/依赖复核均ACCEPT，S.U.P.E.R十项PASS（`output/checks/p3-04-storefront/super-review.md`）。
- 证据：`output/checks/p3-04-storefront/README.md`、`validation.json`、`compatibility-final.json`、全部独立复核；`output/playwright/p3-04-storefront/results.json`、`http-results.json`、`accessibility.json`、截图hash。第一份独立协议失败只有工具摘录、原完整日志被覆盖，未把重跑成功称为根因修复。运营入口`docs/operations/storefront.md`。
- 后续与范围：P3-05礼物分页/筛选/价格排序/七语详情/艺人选择/政策READY；P3-06仍PENDING，正式SEO/性能/运营及测试初始化稳定性后续处理。无正式人工译审/品牌资产批准/市场配置/PSP实际支付转交/云CDN/staging/生产发布结论。按用户约定只本地提交，不push/merge。

## P3-03 执行登记（2026-09-07）

- Owner：Codex `/root`，Lane C唯一executor；开始2026-09-06T20:09:55.313873+00:00，基线本地`cdf2ab24a46eb914c4e82b456d6e630886cfed7b`，分支`codex/p3-03-gift-commerce`。用户明确继续下一阶段；依赖P2-03/P3-01完成，P3-02亦已DONE，Phase3 ACTIVE。本轮只领取P3-03；dependency-graph波次是原保守排期，当前用户与MASTER批准的独立Lane C继续顺序优先，未领取依赖P3-04的P3-05。
- 新需求：虚拟、实体、心愿、周边及其他礼物；粉丝付款后工作室准备/采购并转交艺人。礼物类型与现货/按单准备采购/预售策略独立；部分无库存可持续售卖，不能把0库存误作售罄、用虚构超大库存或把虚拟礼物当余额/自动送达。MVP继续internal_to_idol，不增粉丝地址收集或众筹。
- 输出：自研Admin礼物稳定身份/类型/状态、规格与适用艺人、受控详情块/七语言编辑审核/媒体预览发布、价格簿及不可变调价/回退、库存流水与库存策略保护；所需管理合同/Application/Port/实际PG/API/BFF一起实现。
- 边界：旧344合同roots及历史发布/订单解码保持兼容，新能力采用独立versioned扩展；当前会话/MFA/RBAC/CSRF/幂等/乐观锁/审计同事务。现有内容、媒体和发布证明复用，价格和库存不进入译文成为第二真相源。正式OIDC/人工译审/品牌素材/PSP/云/staging/生产按后续门，不在本轮宣称完成。
- 所有权：root拥有规范/ADR/任务计划/进度/Git、共享exports/registry/生成物/根锁文件以及Next UI/i18n；auth_persistence_audit先只读PG与库存价格保护；content_review_audit先只读Domain/合同/发布兼容；admin_transport先只读API/BFF/真实联合验收。合同冻结后登记独占源码和唯一迁移owner，再并行编写失败测试与最小实现。
- 验证：先失败测试，覆盖无库存按单重复可售、TRACKED零库存拒绝和并发预占保护、暂停/恢复、策略切换、幂等/版本冲突/撤权/审计回滚；有效价格唯一、调价与回退不改旧价格/订单；礼物七语言缺失/STALE/自审/媒体无权阻断。受影响tests→format/lint/typecheck/build→真实PG/HTTP/S3与完整check；390×844/1440×900全七语、键盘/错误/reduced-motion/320px/reflow；独立规范与质量复核、S.U.P.E.R十项、源码和证据冻结。
- 风险：R-06并发/错价/库存漂移、R-08内容构图、R-10权限审计、R-17语言与商业上下文隔离；新增礼物类型的履约说明也受R-13约束。
- Git：按用户既有决定只本地检查点提交，最后统一推送；不push/merge，不改254项历史/诊断未跟踪产物。

## P3-03 验收记录（2026-09-07）

- 状态：DONE，全部本地验收门通过，Lane C 释放。Phase 3 仍 ACTIVE（3/6）；全局 20 DONE / 1 READY / 28 PENDING，共 49；下一 P3-04。
- 交付：礼物身份/分类/状态、规格库存策略、适用艺人搜索及分页、受控图文块与七语言详情、履约说明、独立审核/预览/发布、完整价格簿版本/发布/历史回退、库存流水及原因审计。虚拟/实体/心愿/周边/其他与限量库存/按单准备/预售分别配置，全部由工作室转交艺人；按单准备无库存身份，可重复接单，但仍受真实发布/适用关系/价格/状态约束。
- 历史与边界：20 迁移/153 表；344 个旧 schema roots 逐项深比较不变，追加 26 个，共 370。新礼物 profile 绑定精确 revision/publication/原 manifest，显式 legacy marker 保留历史读取；新 profile 缺失不允许降级。已有库存/交易历史的策略不能原位修改；余额不得小于预占，不能编辑 reserved。回退不重写旧价格版本或倒退作者版本号。
- 后台与权限：Next → 固定 BFF → Application → Port → PostgreSQL；当前 session/MFA/RBAC/CSRF 与幂等、版本、业务写入、收据、审计在同一事务。英语详情变化后六语言 STALE；内容编辑依真实变更语言授权，礼物类型依全局 gift.manage。仅日语审核且无 commerce 权限的账号仍能读取实际英文源与自己的详情并独立批准，其他语言及商业接口继续拒绝。
- 真实数据库：新商业链 117 断言，另有 4 约束边界及 6 价格回退断言；并发改价/库存同版本仅一个成功、密封价格不可删除、故障审计全回滚并可用同键恢复。旧目录 307、旧父版本兼容 64、作者链 211、发布运行链 447、管理目录 258 断言通过。旧迁移降级实测执行到正确 SQL：20→19→18 后 18 拒绝删除发布历史；有新 profile 历史时 20 本身拒绝删除，不以错误 confirmVersion 代替历史保护。
- 时间边界：发布事件早读、preflight 早读、manual retry、正常旧未来 head 下 VALIDATE 共四类确定性 RED→GREEN，30 断言；仅保留稳定事务时间与真实历史，VALIDATE 不推进 head。新保存桥接及真实 App 的内容授权传值也精确复现后修复，保留商业 principal 和全部内容/语言检查。原实时有效期、MFA、权限、租约及既有 SQL guard 不变。早期自然 503/23514 未捕获精确触发瞬间，不将这些受控探针冒充其已确认根因。
- HTTP 与浏览器：默认协议模式 1658 断言/512 setup 请求；最终完整 UI 1703 断言/512 setup 请求（额外浏览器 BFF 请求未纳入 setup 计数），真实 PostgreSQL/TLS S3/图片 worker/Next/Chrome。七语言 390×844 与 1440×900，18 张最终 PNG（17 张稳定页面，en-created.png 为保存成功后刷新态）；4 axe 均零 violations/零 incomplete，5 项 320px/720px 重排无横向溢出，键盘焦点及 Enter 预览实际 blob 解码。实际保存发布价格、调整库存、按单准备不出现库存输入、创建礼物/规格、dirty 取消、英语独立审核及绑定当前 revision 的六 STALE、日语专属审核均通过。截图为 fullPage，底部粘性操作条按当时 viewport 显示，不把截图中覆盖的片段误作实际交互阻挡。
- 视觉与回归：保留黑金后台；统一左右字段顺序、可选英文源空槽、手机语言矩阵列宽和焦点滚动空间，关闭开发器件遮挡。root 与非作者复看中日葡页面及预览。共享 P2-04（16 场景/18 PNG/10 axe/原生 Chrome 200%）和 P2-05（8 场景/22 PNG/3 axe/正常与 reduced motion）重新运行成功。本次 Admin 的 720px 为等效重排，不冒充原生缩放；未新增真机测试。
- 独立复核：商业授权/事务、SQL价格与库存、礼物 profile/公开读取、Admin 状态和单语言审核、旧迁移兼容及最后时间补丁均非作者 ACCEPT；code-simplifier 收敛保留功能/合同。Application/scope 40 tests、Admin 68 tests 通过，最终完整门禁通过，详见下一条。
- 最终统一检查：`pnpm check` exit 0；typecheck/test 各 58/58（54 cached），build 35/35（30 cached），31 个 package 出口经 Node 实际 import；真实 PostgreSQL、HTTP、TLS S3/worker、架构/格式/lint 全部通过。secrets 通过，Next 自动环境声明经 typegen 恢复；1,219 个实现/测试/配置/迁移/合同输入在最终门禁前后逐项一致，SHA256 `d2cd9b2044a0965628e684df24df3a824a3866986dd668a089c73dda0940e320`。清单排除 docs/output 与自动生成 Next 环境声明，记录见 `implementation-source-final.json` / `validation.json`；不是零缓存验收。
- 证据：`output/checks/p3-03-gift-commerce/README.md`、`compatibility-final.json`、`independent-review.md`、`transport-README.md`、`transport-review.md`；页面与无障碍记录 `output/playwright/p3-03-gift-commerce/`。运营入口 `docs/operations/gift-commerce.md`。本轮只有 TEST 本地身份/合成素材，七份界面译文 manifest 仍 DRAFT；正式 OIDC/人工译审/资产批准、实际支付及转交、云 CDN/staging/生产均留后续门禁。

### P3-03 S.U.P.E.R 十项

| # | 检查 | 结果 |
|:--|:--|:--|
| 1 | 文件职责 | PASS：身份/profile、价格读写、库存流水、授权、传输、表单模型/展示分别负责 |
| 2 | 函数职责 | PASS：授权范围、编排、结果验证、历史时间与界面更新独立处理 |
| 3 | 单向依赖 | PASS：BFF/Route → Application → Domain/Port → Adapter，无浏览器直读数据库 |
| 4 | 无循环 | PASS：workspace/领域/adapter门与全仓类型单测预检通过 |
| 5 | 合同边界 | PASS：26 个独立 versioned roots；旧 344 定义深度相同 |
| 6 | 可序列化 | PASS：公开/私有请求、响应、receipt、profile 均经 schema；内部 adapter 回调不进入合同 |
| 7 | 配置注入 | PASS：生产来源/市场/币种外部配置；样板身份和素材仅限 TEST，样式消费现有令牌 |
| 8 | 显式依赖 | PASS：workspace 依赖与测试 i18n 入口声明，锁文件同步，无新增业务 SaaS |
| 9 | 可替换 | PASS：内容、商业、公开目录及外部存储由独立 Port 注入，无第二业务真相源 |
| 10 | 验证完成 | PASS：完整 check、真实 PG/API/S3、七语言双端浏览器、secrets/diff、1,219 输入一致与非作者复核；外部环境和缓存范围明确 |

## P3-02 执行登记（2026-09-07）

- Owner：Codex `/root`，Lane C唯一executor；开始2026-09-06T17:27:39.666642+00:00，基线本地提交 `6983e90`。用户明确要求继续下一阶段；P3-02由READY转IN_PROGRESS，依赖P2-03/P3-01均DONE，Phase 3 ACTIVE。只领取本任务。
- 输入：已批准黑金视觉、共享可访问组件、18迁移/141表、311合同roots、P3-01真实内容/媒体/审核/预览/发布与purge。先只读审计缺口再冻结新增合同，不凭UI猜测数据库权限或发布资格。
- 输出：自研Admin首页/艺人稳定身份与运营状态/媒体库及构图、英语源稿与七语矩阵/source diff/审核、受审计翻译包导入导出、双端受控预览、发布/回退/缓存失败重试；必要Application/API与真实浏览器操作一起验收。
- 边界：沿用当前不可变revision/作者和独立审核/manifest与同事务当前授权；正式OIDC发行与生产开放仍属P5-01。开发身份仅显式TEST/local组合、真实数据库session/MFA/RBAC/CSRF；不把无鉴权入口带入正常生产。P3-03商品/价格/库存运营与P3-04/05粉丝页不在本任务。
- 文件所有权：root独占共享exports/registry/生成物/锁文件、Next后台UI/i18n/配置、计划/进度/Git；auth_persistence_audit先审计艺人稳定身份/管理发现/历史与DB增量；content_review_audit先审计翻译包/source diff/预览解析；admin_transport先审计API/本地session与真实浏览器fixture。合同冻结后按明确新增文件分配，不交叉编辑。
- 视觉：深色中性工作区、金色主操作、真实人物和素材预览；列表/编辑/预览明确分区，少边框，无营销Hero或数据卡片拼盘。交互使用现有焦点管理、保存反馈、抽屉/确认与reduced-motion；不新增装饰动效框架。
- 验证：先失败测试（权限/CSRF/版本冲突/过期翻译包/草稿隔离/自审阻断/不可变历史），再最小实现；受影响tests→format/lint/typecheck/build→真实PG/HTTP/S3→七语言390×844/1440×900、键盘/错误/减少动态/320px/缩放浏览器回归→非作者规范和质量复核→全仓check/S.U.P.E.R/源码证据。失败不绕过门禁，计时/生产CDN等范围如实区分。
- Git：分支 `codex/p3-02-admin-workspace` 从6983e90继续；只本地检查点提交，最终统一推送，不push/merge，不修改历史未跟踪素材或诊断产物。

## P3-02 验收记录（2026-09-07）

- 风险追踪：R-02由私有DTO/翻译导出字段边界、内存预览与无私密素材截图覆盖；R-08由结构化字段/媒体构图/预览发布回退覆盖；R-12使用原创测试素材和当前版权状态，正式资产授权另留上线门；R-17由七语言源版本/STALE/独立审核和发布证明覆盖。下述实际数据库、协议与浏览器证据不替代正式身份、人工译审和资产批准。
- 交付：七语言自研内容后台：首页/艺人稳定身份与别名/媒体库；真实目录搜索与分页、源稿和历史 source diff、翻译矩阵、独立审核、受审计翻译包导入导出、私有图片与双端预览、发布检查/发布/历史回退/缓存状态和重试。保留既有黑金视觉，交互动效沿用已验收组件与 reduced-motion。
- 运行边界：Next → 固定同源 BFF → Application → 专属 Port → PostgreSQL/S3；会话/MFA/RBAC/语言权限/CSRF 当前检查，私有响应 no-store，预览 token 只在内存与 POST 中。真实 PostgreSQL 继续是唯一内容真相源；0019 后共19迁移/144表，新增33合同 roots与11个OpenAPI路径，原311个定义逐项深比较不变（共344）。
- 本任务新增验证：Admin44单测、i18n5单测；目录/身份/翻译/preview真实PG253断言，其中251为正常业务与触发器约束、2为隔离真实SQL的同时间戳历史排序查询；实际API+PG+TLS S3+worker+Next+Chrome默认模式957断言/306 setup API请求。完整UI模式1003断言/306 setup API请求（不含浏览器额外BFF请求计数）。
- 浏览器：全部七语言390×844与1440×900，18张最终截图（14张语言/设备、3张编辑/源改变/预览、1张审核成功后刷新中的状态）；`en-reviewer.png`不作稳定审核矩阵证据。保存后读回、独立批准、英文变更后六语言STALE、dirty导航确认、三张真实blob图片解码、修改handle后保留另一个未提交字段均通过实际断言。目录/编辑器/preview三个axe扫描均零violations、零incomplete；Tab五目标有可见焦点，Enter完成搜索/打开记录/预览/关闭。320px与720×450等效200%重排无横向溢出；等效重排不冒充原生Chrome缩放。
- 既有界面回归：共享输入变化后实际刷新P2-04（16场景/18PNG/10axe/原生200%缩放）和P2-05（8场景/22PNG/3axe/正常及减弱动态），两门通过。本轮没有新真机证据。
- 故障收敛：上传grant/PUT/登记阶段和发布validate/publish阶段均以失败测试保护恢复；成功发布后的状态读取失败只重读状态，避免再发写命令。修复rights拒绝枚举、资料刷新卸载、语言矩阵命名角色、CSS令牌与server-only配置入口。测试类型声明按现有模式补Node类型；两旧Worker组合测试移除计时区间内动态加载，保留原超时与全部业务断言，并纠正旧测试误写的异步返回类型。
- 非作者复核：目录SQL/迁移/翻译收据、translation/preview链路、会话/配置/资源清理、界面状态与最后测试修正均独立ACCEPT；相关作者归因和RED→GREEN记录见总证据README。静态预检105/105通过（101 cached），不声称零缓存。
- 依赖边界：ICU格式化库仅限i18n包许可，新增正向与真实provider/npm alias反向测试；32项通过，原有边界保留。
- 发布回归：真实事件时钟探针先在旧实现首tick复现23514/CAUSAL_VERSION，再以稳定事务事件时间修复；实际截止、租约和所有SQL guard保留，默认首claim/record两查询回归后继续真实时钟整链，11,364断言/1,450 HTTP请求通过。原自然purge UNAVAILABLE与另一次retry503未自然重现或确定归因，保留安全诊断；两次后续validate失败确认为诊断QueryConfig包装错误并已独立修复，不作生产缺陷。详见总README分项记录。
- 最终统一检查：2026-09-06T19:55:20.066988+00:00，完整 `pnpm check` exit0；19迁移/144表、全部真实PG/HTTP/S3、format/lint/typecheck/test/build/架构和构建产物门通过。最后typecheck与test各58/58（55 cached），build35/35（35 cached）；31个package出口由Node实际import。额外secrets与diff检查exit0；1,134个源码输入冻结前后逐项一致，摘要`9e7c70c6c4979d3e0ffda81850d42bec8a812655a45a5d60d8ade3591a714d8a`。非作者复核和S.U.P.E.R十项PASS，P3-02 DONE、Lane C释放；Phase3仍ACTIVE（2/6），全局19 DONE / 2 READY / 28 PENDING（49）。
- 总证据：`output/checks/p3-02-admin/README.md`、`validation.json`、`translation-handoff.md`、`transport-README.md`、`transport-review.md`；页面证据`output/playwright/p3-02-admin/`。详细日志保留在本机同目录（忽略Git），源码输入摘要在validation中。
- 尚未包含：正式OIDC/管理员发行（P5-01）、正式人工译审/品牌与资产上线批准、商品/价格/库存运营（P3-03）、粉丝正式浏览页（P3-04/05）、PSP/云CDN/staging/生产发布。七份Admin界面review manifest保持DRAFT。仅本地检查点提交，不push/merge，不暂存历史未跟踪产物。

### P3-02 S.U.P.E.R 十项

| # | 检查 | 结果 |
|:--|:--|:--|
| 1 | 文件职责 | PASS：目录查询/身份写入、翻译工作区/传输、预览授权/签名、BFF、表单状态与展示拆分 |
| 2 | 函数职责 | PASS：读取、转换、提交、阶段恢复和状态查询分别处理 |
| 3 | 单向依赖 | PASS：Route → Application → Domain/Port → Adapter，无客户端直读数据库 |
| 4 | 无循环 | PASS：workspace/领域/adapter检查与105项静态预检通过 |
| 5 | 合同边界 | PASS：33个新增versioned roots，原311定义不变 |
| 6 | 可序列化 | PASS：跨模块对象经Zod解析；React内部回调不进入业务合同 |
| 7 | 配置注入 | PASS：TEST默认禁用，仅开发loopback；无生产品牌/艺人/供应商凭证硬编码，样式消费设计令牌 |
| 8 | 显式依赖 | PASS：workspace依赖、ICU库和测试类型/浏览器依赖声明并锁定 |
| 9 | 可替换 | PASS：五个独立事务Port与配置入口，UI不拥有第二份内容数据库 |
| 10 | 验证完成 | PASS：最终完整check、真实PG/API/S3、双端七语言浏览器、secrets/diff与1,134源码指纹一致；缓存和外部环境范围如实记录 |

## P3-01 执行卡

- Owner：Codex `/root`；Lane C 唯一 executor。
- 开始：2026-09-05T07:16:03+08:00（2026-09-04T23:16:03Z）。
- 领取：Phase 1/2 CLOSED，P1-02/P1-04/P1-05/P1-06 均 DONE，P3-01 PENDING → READY → IN_PROGRESS；不领取 P3-02 至 P3-06。
- 开始时输入：现有不可变内容/翻译合同、公开投影、108 表/9 迁移、事务/outbox/media/CDN ports，以及用户新增目录和多语详情要求。检查点 2A 后为 109 表/11 迁移。
- 完整输出：真实 PostgreSQL 内容与目录查询/命令、管理授权、媒体处理、短时只读预览、七语言事务发布/回退与 locale purge 状态/重试。详细实施顺序见 `docs/plan/p3-01-content-runtime.md`。
- 首个检查点：搜索/定位/分页/排序合同与纯规则、角色媒体构图合同与不放大几何规划、可翻译受控详情块合同；先冻结兼容边界及失败测试，再接数据库与 API。此检查点通过不能把 P3-01 标为 DONE。
- 变更边界：仅 P3-01 与本轮批准/需求对应的规范和进度文档；保护现有未提交样板及证据。后续艺人浏览 UI 属 P3-04，礼物列表/详情 UI 属 P3-05；不接支付、不部署云、不写真实运营内容。
- 并行：root 独占共享 exports/artifact registry/生成产物/计划与进度；每个检查点在实施前登记子模块文件所有权，以下执行登记为准。旧媒体构图与详情规则子模块属于检查点 1。
- 验证：新行为先失败测试；输入边界、Unicode、翻页稳定性/上下文隔离、混合比例/焦点/低像素、块结构与翻译一致性；随后受影响 tests、format/lint/typecheck/build 和全仓 check。运行时检查点必须补真实 PostgreSQL/S3、权限/preview、原子发布/回退/purge 重试集成；前台接入时再做 390×844/1440×900 七语言/键盘/reduced-motion。
- 风险：R-08 内容发布/失效、R-11 异步可靠性、R-14 完整验证、R-17 语言隔离；原媒体比例校验、旧 plain-text description 与冻结 v1 数据均需兼容迁移，不静默放宽现有生产发布门。

## P3-01 检查点 4C-2 执行登记（2026-09-06）

- Owner：Codex `/root`，继续Lane C唯一executor；开始2026-09-06T10:31:06Z，基线本地提交 `6a14495`；用户明确要求继续下一阶段。
- 范围：同事务当前授权/幂等/版本控制下validate、publish和rollback，真实完整manifest与审核/媒体证明、七语言publication/head/outbox；版本化公开单对象DTO与已审别名搜索；持久缓存更新状态、worker提交/轮询/失败重试，以及本地真实API/DB/media发布到查询≤60秒。
- 边界：依据规范12.4与既有0006，回退追加新publication指向不可变历史revision，不复制/改写旧内容或订单。解除0013必须以更强的数据库与应用证据门替代，不能直接删除封锁；保留旧279合同及历史v1。价格/库存/艺人稳定身份管理及其所需Application/API/UI仍由P3-02/03负责；不选择正式身份源/素材/市场，不接PSP或云部署。
- 所有权：root负责新增共享合同/ports/exports/生成物、Application发布及purge编排、worker组合、计划/证据/Git；auth_persistence_audit负责0018与发布/缓存状态PostgreSQL仓储及真实PG测试；content_review_audit负责纯manifest/公开扩展投影与公开PG读取/别名搜索；admin_transport负责新管理/公开HTTP路由与真实HTTP联合验收。先并行只读审计，再冻结合同，各自测试先行，禁止交叉编辑。
- 验证：缺译/STALE/自审/错误或过期manifest/原图失权阻断；版本冲突/幂等重放撤权/任一步故障原子回滚；历史回退不改原记录；七语言一致与公开隐私；无关event不被内容consumer领取；purge PENDING不误报完成、网络外置、重启/重复/有限重试与可查状态；受影响tests→format/lint/typecheck/build预检→真实PG/HTTP/S3/worker及全仓check→源码冻结后双端七语言浏览器回归→非作者复核/S.U.P.E.R/本地提交。风险R-08/R-11/R-14/R-17。
- Git：延用 `codex/p3-01-content-runtime`，只提交本地检查点，不push/merge；P3-01全部退出条件通过后才DONE，不提前宣称Phase3结束。
- 合同起草转交：content_review_audit独占新增publication-manifest/published-content合同及tests，root复核冻结并负责共享exports/registry；其余所有权保持。

### 检查点 4C-2 验证与完整任务退出（2026-09-06）

- 验收时间：2026-09-06T12:12:13.280137+00:00；Lane C executor `/root` 完成并释放。状态记录：P3-01 IN_PROGRESS → REVIEW（独立规范/质量复核）→ DONE（最终全仓与源码复核通过）。本轮只完成这一任务，不领取后续任务。
- 发布闭环：五类内容validate/publish/rollback同事务重验当前session/MFA/全七locale权限、CSRF、版本和canonical内容；幂等重放也重验当前权限。成功原子提交实际审核/媒体证明、不可变manifest/收据、生命周期、head、audit及七语言Outbox/purge。并发一成功一冲突、审计失败全回滚与原key恢复通过；旧preflight报告不能授权发布。
- 合同/数据库：32个新增versioned roots，共311，旧279逐项深比较不变。0018新增5表，总18迁移/141表；新publication强制proof_version2，旧v1只由迁移标记。完整正常触发器验证真实源稿、批准/复制链、别名/详情、原图版权/加工来源、双端Hero独立来源、原始hash和head；拒绝伪证明/提前超时/历史修改与已有新历史降级。回退追加新publication，历史revision与订单不改。
- 公开与媒体：五类单对象七语言公开GET、当前发布head读取及已审名字/别名投影已接正常API组合。扩展缺失或失效不回退旧description。既有已发布父引用的有效历史metadata继续可读，新发布保持当前媒体门；manifest只收录READY衍生图。真实私有TLS S3原图、处理、metadata七语发布及同一衍生对象字节/几何/metadata核验通过，公共媒体origin仍是合成fixture。
- 缓存：内容专属持久队列只处理CONTENT_PUBLICATION_CHANGED，实际合法无关commerce outbox/dispatch不变；事务外网络、稳定提交key、短事务租约/版本fencing。SUBMITTED/PENDING不能当COMPLETED；重启恢复既有provider reference，FAILED授权重试创建新代并保留历史。使用正常worker调度（空闲1000ms、记录后10ms），实际loopback HTTP缓存通过七语言发布≤60秒；只查询STATUS观察，没有手工runOnce驱动。10分钟总截止未实际等待十分钟，证据为真实SQL尾部租约表达式、正常trigger提前超时拒绝、真实短租约到期及迟到拒收。
- 专项与全仓：真实PG441断言；独立HTTP10,448断言/1,332请求；105/105 typecheck/test/build预检（51cached），format/lint均PASS。最终 `mise exec node@24.20.0 -- corepack pnpm check` exit0，再次运行18迁移/141表、PG441、HTTP10,464断言/1,335请求、旧目录/内容/权限/API、TLS S3和媒体worker423联合断言；HTTP计数随STATUS观察次数变化。最终typecheck57/57、test57/57、build35/35均缓存命中；31个package exports经Node实际import，合同/架构/格式/lint全部通过。
- 浏览器：源码和文件清单冻结后顺序P2-04/05回归并由全仓校验新指纹。P2-04为16场景/18PNG/10axe零违规，242输入指纹 `5194a3f48da09dac4804ae4ab359421d046af1369b4383a5859b4f584fa4e597`；P2-05为8场景/22PNG/3axe，critical/serious零、既有3个heading-order moderate保留，358输入指纹 `75d54d356e504679152738f8216b657873d3f563ce1c7646e41bcb00896368df`。七语言/伪语言、390×844/1440×900、键盘、错误、reduced-motion与原生200%缩放通过；root查看实际双端Hero、手机越南语和桌面日语截图。共享组件回归没有新增真机，motion原始报告继续保留physical-device gate。
- 复核与收敛：三个子模块非作者规范/质量审查及root交叉复核ACCEPT。修复tuple顺序、UTC微秒snapshot hash、NULL证明、Hero同源、purge结果绑定/非终态超时、READY变体与已发布metadata历史读取；每项RED→GREEN，未放宽生产权限或SQL门。代码收敛保持合同/纯证明/事务/仓储/网络/transport职责。一次性探针被正式PG helper覆盖后清理，其早期lint RED保留。
- 最终证据：`output/checks/p3-01-publication-runtime/README.md`、`validation.json`、`compatibility.json`、`implementation-source.json`、`independent-review.md`、`task-exit-review.md`、`HTTP-README.md`、`transport-review.md`；完整原始日志本地保留。1018个实现/测试/迁移/配置/指导输入最终复核未变，SHA256 `2627ee26c3bceba59d96083281b4b884fe874ef5c85db77a0a7fe3af0f587b3c`；旧279合同深比较不变。secret扫描通过；最终文档与暂存diff检查的退出码见validation.json。
- 下一入口：Phase 3仍ACTIVE（1/6）；P3-02/03/04的依赖全部DONE且Lane空闲，改READY；P3-05/06仍PENDING。全局18 DONE / 3 READY / 28 PENDING，总49。优先P3-02自研管理后台，随后P3-03商品运营和P3-04/05真实前台；各任务包含其所需Application/API，不能只做UI。Phase 4至7仍LOCKED。
- 范围与Git：使用说明见 `docs/operations/content-publication.md`。管理写入仍显式TEST组合，正式身份发行、实际CloudFront/公共CDN、正式素材与市场、SEO/运营计时、PSP/staging/生产发布依后续任务验证。沿用 `codex/p3-01-content-runtime` 本地检查点提交，最终统一推送，本轮不push/merge。

### S.U.P.E.R 10项（4C-2与P3-01退出）

| # | 检查 | 结果 |
|:--|:--|:--|
| 1 | 文件职责单一 | PASS：合同/manifest/公开投影/SQL/Application/HTTP/worker分离 |
| 2 | 函数职责单一 | PASS：授权/证明/原子写入/网络/持久状态/清理各自明确 |
| 3 | 单向依赖 | PASS：Route→Application→Content/Port；SQL/provider留在adapter |
| 4 | 无循环依赖 | PASS：workspace/domain/adapter及全仓typecheck/build通过 |
| 5 | Schema定义边界 | PASS：32个新roots；旧279定义深比较不变 |
| 6 | 可序列化I/O | PASS：严格JSON、UTC微秒、结构化安全错误，无连接/provider原文跨层 |
| 7 | 无生产硬编码 | PASS：数据库/媒体origin/CDN由配置注入；实体从真实DB加载 |
| 8 | 显式依赖 | PASS：cache port/adapter及锁文件一致，不新增供应商版本 |
| 9 | 可替换实现 | PASS：PG/cache/media独立ports，内容队列不消费无关事件 |
| 10 | 验证通过 | PASS：最终全仓、真实PG/HTTP/S3、浏览器、秘密扫描、独立复核与源码指纹 |

## P3-01 检查点 4C-1 执行登记（2026-09-06）

- Owner：Codex `/root`，继续 Lane C 唯一 executor；开始 2026-09-06T09:35:57Z，基线本地提交 `be57b34`。
- 范围：五类内容的受权发布前检查，从同一 PostgreSQL 快照加载正文、七语言审核及继承、独立别名/详情审核、媒体及来源资格、关联目录资格，返回稳定字段路径与阻塞原因。只接收对象/revision/action，不接受浏览器候选、时间、审核人、资格标记或 manifest。
- 边界：本子检查点不改变生命周期或 published head，不解除0013扩展发布封锁。后续4C-2接同一校验器完成原子publish/rollback、manifest、公开扩展DTO和七语言outbox/purge；ROLLBACK遵循规范12.4与既有数据库，创建新publication事件指向历史不可变revision，不复制或重写历史。P3-01继续IN_PROGRESS，其他任务不解锁。
- 所有权：root拥有计划、共享exports/registry/生成物、port、Application、TEST组合及publication-preflight-media纯来源校验；content_review_audit拥有新preflight合同/纯规则及测试，合同冻结后auth_persistence_audit拥有只读PostgreSQL加载器/证据映射/真实PG测试，admin_transport拥有HTTP路由/测试/真实HTTP harness。每次独立模块变更先RED，再实现；不并行修改同一文件。
- 验证：五类七语言缺译/STALE/自审/复制继承、独立别名与详情审批、媒体加工/版权/来源、双端Hero来源、目录关联/价格资格、目标与当前head绑定、撤权/MFA/CSRF/无状态变更。受影响测试→format/lint/typecheck/build→实际PG/HTTP与全仓check；共享前台输入回归、非作者规范及质量复核、S.U.P.E.R与源码证据。
- Git：按用户决定本地检查点提交，最终统一推送；本轮不push/merge，不宣称云CDN、正式登录、PSP、staging或生产验收。

- 4C-1本地验收完成：2026-09-06T10:22:30.394715Z。新增一个私有POST、5个版本化root（旧274深比较不变，共279）；SERIALIZABLE同事务当前授权与canonical读取，五类七语言审核/复制/独立扩展、所有媒体原图当前版权、历史publication和微秒时间边界通过。
- 最终验证：受影响1,237 tests；format/lint与105任务typecheck/test/build预检（35缓存）；实际PG166、HTTP2,595断言/277请求；完整 `mise exec node@24.20.0 -- corepack pnpm check` exit0，typecheck56/test56/build35（全部缓存），实际17迁移/136表与31个Node exports。既有真实本地PG、TLS S3、Chrome资源接口1798断言和媒体worker423联合断言均复跑通过。
- 浏览器：P2-04 16场景/18PNG/10axe，零violations；P2-05 8场景/22PNG/3axe，critical/serious为0、保留既有3个heading-order moderate。覆盖七语言、390×844/1440×900、键盘、错误、reduced-motion，查看实际双端截图。首轮motion因新增源码导致工作区变化而拒收，冻结文件清单后重跑通过；不新增真机结论。
- 复核与归档：三路非作者规范/质量复核ACCEPT，S.U.P.E.R十项PASS，secret扫描和git diff检查通过。948个输入指纹 `ec6a81497ecf77965b38ab194d82491d0e8048854c55d007adb7aff198179a06` 在最终验收后匹配。命令、RED→GREEN、失败夹具诊断与准确范围见 `output/checks/p3-01-publication-preflight/README.md` / `validation.json` / `independent-review.md`。
- 下一入口：4C-2在实际事务重跑规则并完成validate/publish/rollback、public扩展DTO、manifest/head/别名投影、七语言outbox/purge和本地≤60秒可见性；保留0013封锁，P3-01仍IN_PROGRESS，其他任务不解锁。后台业务UI、正式登录、云CDN、PSP/staging/远端CI与生产发布尚不在本轮证据内。

## P3-01 检查点 4B 执行登记（2026-09-06）

- Owner：Codex `/root`，Lane C 唯一 executor；开始 2026-09-06T07:52:06.944936Z。4A 已验收，本轮继续媒体与政策管理入口。
- 输出：政策稳定 owner READ/REGISTER；媒体私有签名上传、服务端真实字节与完整解码后登记、受权媒体/任务状态读取、版权事件、构图任务入队及保留历史的人工重试。新原图/角色 master 的版权与七语言 metadata 仍独立审核，不自动发布。
- 合同与边界：旧 246 roots 保持；新 admin-resource 授权与可序列化命令/port，0017 增量迁移。上传预留/最终登记为短事务；签名、下载、解码不持数据库事务。登记再次校验当前 session/MFA/RBAC、固定 key/hash/size/MIME、版本/期限；不信任浏览器尺寸或“已验证”标志。失败无永久 IN_PROGRESS 幂等残留。
- 历史：人工重试创建新 generation 和父任务 FK，原 job/attempt/output 不改；普通 enqueue 保持根任务去重。版权引用另存 append-only 事件，只改当前 rights_status，不改旧不可变 rights_reference；读取资格须检查来源 provenance。政策注册写专属 UUID 审计收据，同 key 不同 kind 拒绝，后接 3B 作者 API。
- 所有权：root 独占合同/port/共享导出/生成物/根组合/计划和 Git；auth_persistence_audit 在合同冻结后独占0017、资源管理授权/仓储/真实PG及旧enqueue必要适配；content_review_audit 独占纯校验/Application与独立原图 inspection adapter；admin_transport 独占新管理route/真实HTTP/TLS S3闭环 harness。不同文件并行，非作者先规范复核再质量复核。
- 验证：先 RED；伪 MIME/损坏/多帧/EXIF/尺寸预算、去重不覆盖、跨票/撤权/到期、版权独立/来源撤权、政策首次创建、idem重放/并发/审计失败回滚、六次终止后新代重试；实际PG+TLS S3+HTTP+真实图片处理，受影响测试、全仓check、浏览器共享输入刷新及S.U.P.E.R。
- Git：已验收历史保存为本地 `1924df4`，分支 `codex/p3-01-content-runtime`；用户确认本地可独立开发时先按检查点本地提交，最终统一推送。当前不push/merge；原始真机/诊断日志与大量历史截图保留本地。发布/回退/outbox/purge仍为后续 P3-01 退出要求。

### 检查点 4B 验证记录（2026-09-06 本地验收通过）

- 交付：10 个私有管理 POST；政策稳定 owner 注册/读取，原图预约/签名上传/完整解码可信登记，媒体/任务读取，版权事件，构图入队与失败任务新代重试。政策和媒体 metadata 首次 authoring 与独立审核已覆盖七语言；本轮是接口与处理链路，不是后台业务页面或正式管理员登录。
- 合同/数据库：新增 28 roots，共 274；旧 246 定义深比较不变。0017 四张专属关系表，总计 17 迁移/136 表；不可变上传预约、版权连续版本、重试代次/前驱和精确 actor/session/audit 由正常 PostgreSQL 约束保护。
- 上传与历史：签名最多 300 秒、预约最多 900 秒且受当前会话上限约束；网络与完整解码在事务外，登记重新授权并检查固定身份/版本。只按实际验证后的 SOURCE checksum 去重，保留既有资产与最初版权证据。同 key COMPLETE 已完成重放仍先当前授权；过期/已登记 BEGIN 不再签发。FAILED 新代不改旧 job/attempt/output，普通 enqueue 只去重 generation 1。
- 版权与媒体资格：原图初始 processing/rights=PENDING，metadata 后续 authoring 创建；原图保留私有源信息，processor 才剥离 EXIF。每个公开媒体行须有明确 true 来源资格，false/null/缺失拒绝整份快照；真实 worker master 来源撤权/恢复导致资格 true→false→true，尚不代表 CDN 已刷新。
- 专项：1197 tests（contracts 238/content 149/application 264/port 4/PostgreSQL 317/API 78/image 68/S3 79），真实资源 PG 129、时序 10、nested/composition unit 41、旧目录 PG 307/旧媒体 PG 152 均 PASS。真实 Nest/Fastify+PG+TLS S3+Chrome+worker 为 1798 断言/159 请求，13 个产物实际下载核对字节/尺寸/metadata；Chrome 自动 OPTIONS/PUT 与拒绝来源无对象落库，Node 独立验证 TLS 链。
- RED→GREEN：短会话上传允许 1 秒起且固定实际 S3 signingDate；45 秒+789 微秒的票/返回 grant/签名截止均不越会话。内部 GET 的真实适配器逻辑 1ms 探针（网络 I/O stubbed）6 断言通过，内部有效期改为120秒但下载最小策略/用户权限/处理预算不变。nested 冲突不再误报503，保留409；审计故障同事务回滚且同 key 可恢复。
- 全仓中间记录：首次在旧3A review authorization 断言间歇失败，12 次自然诊断各110断言均通过，原始原因未确认。只加固旧harness：明确grant完整/时钟生效前置条件、有界等待、受控查询时钟回拨与安全诊断，112断言PASS；不改生产权限/TTL/DDL，不无条件重试授权。第二次实际PG/HTTP/S3/worker全过后在lint发现3项规范问题，已仅改2处类型写法；完整lint与typecheck/test/build预检105任务通过。两次失败日志保留；最终统一 `mise exec node@24.20.0 -- corepack pnpm check` exit 0，typecheck 56/56、test 56/56、build 35/35（最终均cached），31个package exports、format/lint/架构/合同及全部真实PG/HTTP/S3/worker（423断言）通过。
- 浏览器：P2-04为16场景/18 PNG/10 axe零违规；P2-05为8场景/22 PNG/3 axe，critical/serious零，保留3条既有heading-order moderate。覆盖七语言/伪语言、390×844/1440×900等视口、键盘/reduced-motion/错误/原生200%缩放；root实际检查双端composite与motion Hero。最后harness/type-only修正没有改变任何渲染输入。无新增真机证据，原P2-05原始报告保留physical-device gate。
- 复核/证据：三位子代理分别对非本人模块规范与质量复核 ACCEPT，追加3A fixture和两处类型修正复核ACCEPT。证据与复跑说明 `output/checks/p3-01-resource-management/README.md`、`validation.json`、`independent-review.md`、`HTTP-README.md`；913个最终实现/测试/迁移/配置/相关指导文件与确定性探针输入，SHA256 `efbc99d4266b27e32ed54cbba2ac29370d53bbbfd0446de6195bc94f1050976a`。排除docs/与验收文档，包含6个实现相关Markdown；最终913个输入匹配，secret scan与git diff --check均PASS。S.U.P.E.R：1模块单责、2函数单责、3单向依赖、4无环、5schema边界、6可序列化、7外部配置、8明确依赖、9可替换ports、10最终全仓测试均PASS，逐项依据见README。
- 边界与下一入口：私有PUT在原TTL内可能继续可用，最终登记仍拒绝撤权会话；无引用私有对象保留待可审计清理。继续运行时计划4C：完整revision验证、原子publish/rollback、公开扩展DTO/manifest/head、别名投影、七语言outbox/purge与本地≤60秒可见性。P3-01仍IN_PROGRESS，49项仍17 DONE/1 IN_PROGRESS/31 PENDING，不解锁P3-02至06；无正式素材/生产登录/云CDN/PSP/staging/远端CI或生产发布结论。按用户选择保留本地检查点提交，最后统一推送GitHub。

## P3-01 检查点 4A 执行登记（2026-09-06）

- Owner：Codex `/root`，继续 Lane C 唯一 executor；开始 2026-09-05T21:32:04Z。
- 范围：五类基础译文按语言读稿、提交与独立批准，以及五类对象/revision/locale 绑定的短时可撤销 preview。读稿保留实际英语与旧来源证据，STALE 仍能查看，提交/批准必须绑定当前来源；译文与结构作者均不能批准新稿。审核继承沿用 0015 证据，不改写历史。
- 边界：本轮为检查点 4 的 4A 可验收纵切片；完整 revision 验证、政策 owner 初始化、媒体管理 API、公开扩展 DTO、发布/回退/outbox/purge 保持后续退出要求，不提前开放发布或解锁 P3-02/03/04。
- 所有权：root 独占新合同/ports/共享 exports/生成物、事务与 TEST 组合和文档；合同冻结后 auth_persistence_audit 独占 0016、基础审核/预览 PostgreSQL 与数据库 harness，content_review_audit 独占纯投影/审核规则和 Application，admin_transport 独占新 HTTP route/tests/harness。保留旧 233 roots。
- 验证计划：先 RED，再五类七语言、单语言授权、实际英语源、STALE/self-review/继承证据、版本/hash 并发、幂等重放撤权与事务故障回滚、preview TTL/撤销/权限撤销/对象语言隔离/无秘密泄露；真实 PostgreSQL/HTTP、受影响测试、全仓 check、共享输入浏览器刷新、非作者交叉复核和 S.U.P.E.R 10 项。风险 R-08/R-10/R-11/R-14/R-17。

### 检查点 4A 验证记录

- 交付：艺人、礼物、首页、政策、媒体元数据五类基础内容的七语言 read/submit/approve，以及精确 owner/revision/locale 绑定的签发、读取和撤销 preview；5 个管理 POST 与 1 个 preview POST。新增 13 roots、旧 233 定义不变、共 246；0016 两张专属表，总计 16 迁移/132 表。
- 规则：读稿保留实际英语和旧 source lineage，STALE 可读但不能送审/批准；新审核校验正文/来源 hash、序列、实际文本 ICU 与双作者独立。复制历史审批由 0015 FK 证明，新审核只写有作者收据的 draft；授权、内容、审计和安全幂等引用同一 SERIALIZABLE 事务，重放仍检查当前权限。
- 预览：256-bit 凭证一次返回、带用途和 pepper 摘要保存；60–900 秒签发参数，实际期限受会话上限约束。撤销提交后的后续读取失效；签发者被撤去语言权限后仍可撤销自身 grant。关联引用不授予关联草稿或存储访问；统一私有响应，缺译不回退。
- 失败先行与修复：SQL 审计参数错位改为具名对象；补齐实际英语/目标译文 ICU 验证；授权 SQL 与 Application 保留完整小数秒，真实 HTTP +789 微秒会话上限 RED→GREEN；旧 3A 短预览 fixture 改为数据库时间与真实到期条件，未修改生产 TTL/约束或系统时钟。保留全部失败历史，`postgres-3a-green.log` 不代表最终通过，最终为 `postgres-3a-final-green.log`。
- 专项结果：contracts 234/content 149/application 207/port 4/PostgreSQL 299/API 67，共 960 tests PASS；真实基础内容 PG 910 断言、HTTP 3847 断言/388 请求，旧 3A/3B PG 110/211、作者 HTTP 909/114、目录 PG 307 通过。正常触发器、五类七语言、微秒/未来因果时间、幂等撤权、并发一成功一冲突及审计失败原子回滚均覆盖。
- 浏览器：冻结源码后顺序刷新 P2-04/05，16 场景/18 PNG/10 axe 和 8 场景/22 PNG/3 axe，critical/serious 0；保留 motion 页 3 条既有 heading-order moderate。390×844/1440×900、七语言/伪语言、键盘/reduced-motion、错误状态与原生 200% 缩放通过；root 实际查看手机越南语、桌面日语截图。只是既有组件回归，没有新增后台业务 UI 或真机证据。
- 最终全仓检查：`mise exec node@24.20.0 -- corepack pnpm check` exit 0；typecheck 56/56（25 cached）、test 56/56（27 cached）、build 35/35（28 cached）、31 package exports 与 format/lint/架构检查通过。重跑上述 PG/HTTP，以及旧目录 HTTP 264/43、旧 3A HTTP 434/68、媒体 PG 152、真实图片/TLS S3/worker 423 联合断言均 PASS；最后 secret scan、源码/旧合同与 diff check 通过，日志 `output/checks/p3-01-base-content/check.log`。
- 证据：`output/checks/p3-01-base-content/README.md`、`validation.json`、`independent-review.md`；重跑入口 `docs/plan/p3-01-base-content-review.md`。863 个当前工作区实现/测试/迁移/生成输入 SHA256 `818d5fb56b321cb2c304fd614aee03ed160abbd1a2b7ad176698901537b10981` 未变，含此前未提交工作，不含文档/证据。三路非作者交叉复核 ACCEPT，准确归因与修复记录已核对。
- S.U.P.E.R：1 模块单责、2 函数单责、3 单向依赖、4 无环、5 schema 边界、6 可序列化、7 外部配置、8 明确依赖、9 可替换 ports、10 最终全仓测试均 PASS。逐项依据见上述 README。
- 接续：运行时计划“4A 后续必需工作”的完整 revision 验证、政策 owner 授权初始化、媒体上传/可信登记/版权/审计重试，继而发布/回退/版本化公开扩展 DTO/manifest/head/名字别名投影/七语言 outbox/purge/≤60 秒可见性。P3-01 仍 IN_PROGRESS，49 项仍 17 DONE / 1 IN_PROGRESS / 31 PENDING；P3-02/03 包含所需管理 API，P3-04/05 负责真实前台接入，不提前解锁。本轮无正式登录、云 CDN、PSP、staging、远端 CI 或生产发布结论。

## P3-01 检查点 3B 执行登记（2026-09-06）

- Owner：Codex `/root`，Lane C 唯一 executor；开始 2026-09-05T19:39:53Z。
- 范围：五类基础内容 revision（艺人、礼物、首页、政策、媒体元数据）的受权创建、读取、复制与复制时译文编辑；复用真实平台 session/MFA/RBAC/CSRF、SERIALIZABLE、幂等安全引用和审计。艺人/礼物/媒体/政策使用已存在的稳定身份或政策键，首页为单例；不在本轮加入价格/库存/variant 或身份管理 UI。
- 复制：始终生成新 revision/translation；未变且仍有效的基础译文以明确 FK lineage 继承原作者/审核证据，变化或过期译文进入 DRAFT，英文变化保留未编辑语言的旧来源 hash 并派生 STALE。别名/详情整体复制为新 ID、当前作者和 DRAFT，禁止借用旧审批。
- 所有权：root 独占共享合同/ports/exports/生成物、组合与计划证据；auth_persistence_audit 在合同冻结后拥有 0015/authoring PostgreSQL/真实数据库 harness；content_review_audit 拥有纯作者规则与 Application；admin_transport 拥有独立 authoring HTTP route/测试/harness。旧 225 roots 深比较保持。
- 验证计划：先 RED，再合同/纯规则/权限/并发/幂等/回滚/源 hash/审核继承与复制隔离测试，真实 PostgreSQL 和 HTTP；受影响 tests、format/lint/typecheck/build、全仓 check、共享输入对应浏览器刷新、非作者评审及 S.U.P.E.R。风险 R-08/R-10/R-11/R-14/R-17。
- 发布边界：3B 作者流不切 published head；单对象扩展公开接口须和检查点 4 的完整发布证明一起验收，避免将未发布新详情当作可公开内容。P3-01 继续 IN_PROGRESS，其他任务不解锁。

### 检查点 3B 验证记录

- 实现：五类既有 owner 的 read/create/copy 管理接口；局部语言编辑、完整 READ 实际语言授权、current session/MFA/RBAC/CSRF、owner 版本与源快照并发控制、安全幂等引用和审计同事务。225 旧 roots 不变，新增 8 个，共 233；0015 新增 6 张专属收据/继承表，总计 15 迁移/130 表。
- 翻译与历史：未变且当前有效的基础文本使用精确源 translation/approval FK 保留原作者及三步审核链；显式原始 Unicode 编辑不能冒领批准，也不能被规范化请求 hash 错误重放。英语变化使未编辑基础外语译文保留旧 lineage 并派生 STALE。扩展内容新 ID/当前作者/DRAFT；详情沿用 0013 的实际英语来源约束，不新增非法 STALE 详情存储。
- 失败先行：合同/纯层/Application/PG/HTTP 均留 RED；修正版本整数边界、Hero 双端身份、焦点/政策时间精度与 UTC 年界、数据库时区摘要、来源子表封口并发、字段路径、配置类型转换及 SERIALIZABLE begin/complete 返回冲突误报 503。真实 HTTP 严格断言并发一成功一冲突且仅一新增版本。
- 最终受影响 tests：contracts 228、content 131、application 175、port 4、PostgreSQL 292、API 56，共 886 PASS。实际作者 PG 211 断言、HTTP 909 断言/114 请求通过；正常触发器、五类/七语言、未来审核 2036 与微秒精度、审计/复制证明失败回滚及同 key 恢复均覆盖。
- 全仓首次因旧目录 harness 未回退 0015 被正确拒绝；补齐最新 down/恢复断言后目录 307 PASS。补验复现旧媒体 finished_at 早于 started_at，使用受控回拨 RED 后仅增加实际完成时间的因果下限；三种终态、真实 backoff/lease 的 152 PG 断言通过。3A 到期测试改为数据库实际到期条件与单调有界等待，109 PG 断言通过，未改生产授权规则或放宽断言。
- 浏览器：源码和证据文件清单准备好后顺序执行 P2-04/05；16 场景/18 PNG/10 axe 与 8 场景/22 PNG/3 axe，critical/serious 均 0。覆盖 390×844、1440×900、七语言、键盘、reduced-motion、错误状态与原生 200% 缩放；实际查看手机越南语/桌面日语截图。前两次因执行中源码/新证据文件使工作区清单变化而被拒，保留失败日志，未放宽门禁。无新增真机证据。
- 最终全仓 `mise exec node@24.20.0 -- corepack pnpm check` exit 0：typecheck 56/56、test 56/56、build 35/35（分别 56/56/35 cached）；31 package exports、实际 PostgreSQL/HTTP/TLS S3 与媒体 worker 423 联合断言、format/lint/合同/架构检查通过。最后 secrets/diff check 通过；之前整仓通过后又补媒体修复，因此在最终冻结源码上再次完整运行。
- 证据：`output/checks/p3-01-authoring/README.md`、`validation.json`、`independent-review.md` 与相邻 Content/Application、HTTP、PG、媒体回拨目录。837 个当前工作区实现/测试/迁移/生成输入 SHA256 `c2e633e867dab434f1400c18ea96a0bee35f5f8d45e66fd4d914726d5d2de009` 最终未变化；含此前未提交工作，不包含文档/证据。S.U.P.E.R 10 项 PASS；三位非作者交叉复核 ACCEPT。
- 下一入口：运行时计划检查点 4 的基础审稿、五类短时 preview、政策 owner 初始化、媒体管理 API，之后完整 validate/publish/rollback/公开扩展 DTO/outbox/purge/≤60 秒可见性。P3-02/03 包含各自所需管理 API，不能误当作只有 UI。P3-01 继续 IN_PROGRESS，49 项仍 17 DONE / 1 IN_PROGRESS / 31 PENDING；TEST 组合不是生产登录、后台编辑界面或正式上线，云/PSP/staging/远端 CI 不在本轮结果内。

## P3-01 检查点 3A 执行登记（2026-09-06）

- Owner：Codex `/root`，Lane C 唯一 executor；开始于 2026-09-05T18:14:51Z。
- 范围：现有艺人别名/礼物详情的受权创建与读取、提交/独立审核、幂等结果引用重放、限对象/版本/语言的短时只读预览；数据库 session/MFA/RBAC/语言分配与内容操作共用 SERIALIZABLE 事务。新增 0014，旧 v1 合同与 0013 历史保持。
- 具体边界：3A 只处理已存在父草稿的扩展内容；基础内容 revision 创建/复制另由 3B 接续，发布/回退/outbox/purge 保留检查点 4。复用平台已有 session 表，本轮不选择生产 OIDC 服务商或开放匿名登录签发。测试组合使用显式 TEST 身份和真实数据库 session；生产身份接线继续 fail closed。
- 预览：凭证仅一次返回，数据库只保存摘要，最长 15 分钟，绑定签发人/会话及单个 locale，签发后可撤销；重签产生新凭证，不假称可重放丢失的明文。预览返回受控内容块，页面排版和双端链接由 P3-02/03 接入。
- 所有权：root 负责共享合同/port/exports/生成物、事务组合、预览仓储、计划/证据；auth_persistence_audit 负责 0014/权限与审核仓储及 PG 测试；content_review_audit 负责 Application 内容用例与纯规则测试；admin_transport 负责管理 HTTP transport/真实 HTTP 测试。冻结合同后开始并行实现。
- 验证：先 RED；伪造/失效/revoked session、无 MFA、权限/locale 撤销、CSRF/Origin、作者自审、结构作者自审、stale/hash/并发、幂等冲突/重放、预览隔离/过期/撤销/不泄露、故障原子回滚；真实 PostgreSQL/HTTP、受影响 tests、全仓 check、共享合同对应 P2-04/05 浏览器回归、非作者评审与 S.U.P.E.R。风险 R-08/R-10/R-11/R-14/R-17。

### 检查点 3A 验证记录

- 交付：8 个受权管理 POST 与 1 个 preview POST，225 个合同 roots（旧 206 定义深比较不变），0014/14 迁移/124 表。扩展创建/审核/审计/幂等引用与当前 session/MFA/RBAC/语言授权同一 SERIALIZABLE 事务；序列/hash/source lineage 过期拒绝；单语言审稿只读目标译文与真实英语源稿。
- 预览：256-bit 凭证按用途隔离并带 pepper 摘要保存，只签发时返回；对象/revision/locale 绑定，最长 15 分钟且不超过会话有效期，签发身份或权限撤销后即时失效。统一 private,no-store/noindex/no-referrer，不在 URL、日志或共享缓存中传播。
- 受影响测试：contracts 218、application 137、persistence-postgres 288、API 45，共 688 tests PASS。真实 PostgreSQL 108 断言、真实 HTTP 434 断言/68 请求 PASS；HTTP audit 故障后草稿/审核/audit/idempotency 均无残留，同 key 重试成功。
- 独立复核：ACCEPT，报告 `output/checks/p3-01-admin-content/independent-review.md`。发现并修复正常数据库时间推进误拒绝、preview SQL CTE 保留字、原授权人停用后无法独立撤权，以及两项 OpenAPI 只读元数据说明；保留 RED/迭代/GREEN 日志。结构作者数据库隔离测试的临时表边界见 README，不宣称完成不同作者的 revision 复制流程。
- 浏览器：顺序运行 `verify-ui-composites-browser.mjs` 与 `verify-ui-motion-browser.mjs` 均 exit 0；P2-04 16 场景/18 PNG/10 axe，P2-05 8 场景/22 PNG/3 axe，critical/serious 0。覆盖双基准视口、七语言/长文案、键盘/reduced-motion 与组合组件原生 200% zoom；没有新真机结论。
- 全仓首次失败与修复：`check-first.log` 的 503 经独立真实数据库探针捕获约 180 ms 墙钟回拨。审核事件按锁定历史计算因果时间并向上取整毫秒；Application 保留身份/权限/截止时间校验，去除墙钟单调假设；预览保留微秒精确审计，TTL 同时受事务/墙钟/会话上限限制。固定回拨 RED→GREEN、100 组七语言/1800 次真实操作通过，非作者复核 ACCEPT。没有修改系统时钟、关闭约束或增加容差/重试。
- 全仓检查：`mise exec node@24.20.0 -- corepack pnpm check` exit 0。typecheck 56/56（25 cached）、test 56/56（27 cached）、build 35/35（28 cached），31 个 package exports 导入通过。真实 PG 14 迁移/124 表、旧内容/目录/持久事件/媒体租约、当前授权/审核/HTTP及 TLS S3/媒体 worker 423 联合断言全部通过；格式/lint、contracts freshness、secret scan 与 diffcheck 通过。最终日志 `output/checks/p3-01-admin-content/check.log`；时钟修复未改渲染输入，完整 check 再次核对既有浏览器证据与当前指纹。
- 证据：`output/checks/p3-01-admin-content/README.md`、`validation.json`、相邻 Application/HTTP 分项目录。实现和共享输入 50 文件 SHA256 `ec012fd5fe0d76279e2b4da2dd9929b808a331c230a04f1abe9f44abe2cbae55`；文档/证据不进入该哈希，避免循环绑定。S.U.P.E.R 10 项全部 PASS，逐项依据见 README。
- 状态与下一入口：P3-01 IN_PROGRESS，下一项为运行时计划 3B 的基础 revision 创建/复制与作者流程，再接检查点 4 validate/publish/rollback/outbox/purge。3A 仅现有父草稿的别名/详情；新扩展发布拒绝门保留。TEST 组合不是生产登录发行，后台预览 UI/生产 OIDC/云/PSP/staging/远端 CI/发布均不在本次结果内。

## P3-01 检查点 2B 内容存储执行登记（2026-09-05）

- Owner：Codex `/root`，延续 Lane C 唯一 executor；开始于 2026-09-05T15:06:03Z。
- 范围：0013 additive migration、艺人 revision 别名集、礼物固定结构详情与专属七语言译文的真实 PostgreSQL 创建/读回、独立初始 DRAFT 审核及同事务创建审计；修正目录搜索覆盖已发布的七语言姓名，返回文案仍使用请求 locale。
- 边界：现有不可变 v1 翻译、description/hash、媒体及订单数据保持兼容；本轮存储接口仅供可信内部调用，不开放未经授权的管理 HTTP。含新扩展的 revision 在生命周期和 publication 双入口拒绝发布，待检查点 3/4 接通独立审核、完整 manifest、媒体证据和 outbox 后解除。新别名尚不进入公开搜索投影。
- 文件所有权：root 负责共享合同/port/exports/生成产物、repository/事务组合、计划/进度/证据；directory_db_audit 负责 0013 SQL 与迁移约束集成；directory_hydration 负责纯别名与草稿详情准备规则及 tests；directory_api_audit 负责七语言名字查询、相关 SQL/真实 PG/HTTP 回归。所有子模块先冻结合同，再先 RED 后实现。
- 验证计划：重复稳定 ID/未知块/HTML/错误媒体归属、源稿 hash 与译文 lineage、服务器 DRAFT/hash、revision 所有权和冻结、审计原子性/重放冲突、缺失初始审核、旧发布不变、降级保护；受影响 tests、真实 PostgreSQL、format/lint/typecheck/build、完整 check、secrets/diffcheck、独立复核与 S.U.P.E.R。共享合同变化时顺序刷新 P2-04/05 实际浏览器证据。
- 状态：实施中，P3-01 仍 IN_PROGRESS；P3-02 至 P3-06 不解锁。

## P3-01 检查点 1 验证记录（2026-09-05）

- 交付：16 个 versioned roots、目录查询/分页/筛选变更与稳定排序计划、locale/market/currency/version 哈希缓存分区、COVER/CONTAIN 构图几何、受控详情块及翻译结构/hash/review 校验。原 155 个生成合同定义深比较不变；旧 v1 description、既有发布门、数据库、API/worker 和前台业务页未修改。
- 最终受影响测试：contracts 176、catalog 8、content 84，共 268 通过。独立非作者评审发现的 Unicode 扩展、上限下一页、0×0 媒体 safeParse 问题均已 TDD 修复并复验；code-simplifier 仅收敛排序分支和测试类型包装。
- 完整检查：`mise exec node@24.20.0 -- corepack pnpm check` exit 0。format/lint/生成合同/边界通过；typecheck 51/51（30 cached）、test 51/51（23 cached）、build 34/34（23 cached）；本地真实 PostgreSQL 9 迁移/108 表/持久事件与 S3-compatible TLS 回归通过。没有把既有 adapter 回归当作新增内容 API 集成。
- 浏览器：共享合同/锁变化令渲染指纹过期后，顺序重跑 `verify-ui-composites-browser.mjs` 与 `verify-ui-motion-browser.mjs` 均 exit 0；P2-04 16 场景/18 PNG/10 axe，P2-05 8 场景/22 PNG/3 axe，critical/serious 0，覆盖双基准视口、键盘/reduced-motion/长文案及组合组件原生 200% zoom。没有新的真机结论。
- 其他检查：`mise exec node@24.20.0 -- corepack pnpm security:secrets` 与 `git diff --check` exit 0。两次完整检查失败原因与最终修复保留在证据目录，未跳过门禁。
- 证据：`output/checks/p3-01-foundation/README.md`、`check.log`、`targeted-tests.log`、`compatibility-and-progress.json`、`implementation-source.json`；实现输入 25 文件 SHA256 `a3534582adc1ff23d2efa9858671be8df3bd206d642f263f1ae0193a31267361`。仍为本地未提交工作区，无新远端 CI 或发布。

### S.U.P.E.R 10 项（本检查点范围）

| # | 检查 | 结果 |
|:--|:--|:--|
| 1 | 文件职责单一 | PASS：合同/查询计划/缓存标识/构图/详情校验分别拥有职责 |
| 2 | 函数职责单一 | PASS：解析、几何、hash 与结构校验分离，排序使用明确分支 |
| 3 | 单向依赖 | PASS：catalog/content 仅消费 contracts，不依赖 API/供应商 |
| 4 | 无循环依赖 | PASS：workspace/adapter/build 检查通过 |
| 5 | Schema 定义边界 | PASS：16 roots 同源生成并测试 |
| 6 | 可序列化 I/O | PASS：JSON roundtrip/安全数值；BigInt 仅内部几何运算 |
| 7 | 无生产硬编码 | PASS：币种/艺人/域名不进入实现；尺寸和查询限额为规范约束 |
| 8 | 显式依赖 | PASS：catalog 声明 contracts 和 Node types，锁文件无供应商新增 |
| 9 | 可替换实现 | PASS：查询计划与构图结果不含 SQL/存储/浏览器对象 |
| 10 | 验证通过 | PASS：受影响 tests、全仓 check、浏览器与独立复核通过 |

**检查点 1 当时边界**：该检查点仅完成合同和纯规则，不含运行时；后续目录响应/cursor 与 PostgreSQL/HTTP 接入结果见下方检查点 2A。P3-01 完整验收前不解锁直接依赖。

## P3-01 检查点 2A 执行登记（2026-09-05）

- Owner：Codex `/root`，延续 Lane C；范围为公开目录的真实 PostgreSQL 读取纵切片：published head/revision/七语言审核证据重建、艺人搜索与 anchor/cursor、礼物分页/价格/库存上下文、Application 与只读 HTTP API。
- 实施前边界：沿用 SERIALIZABLE 快照；只装载当前结果窗口的内容与媒体；复用现有强公开投影校验；不把 base 指针或 fixture JSON 当作发布许可。旧媒体发布要求继续生效。
- 并行文件所有权：root 拥有共享合同/port/生成文件/迁移/组合与进度；directory_db_audit 拥有目录 SQL repository 与真实 PG harness；directory_hydration 拥有 publication loader；directory_api_audit 在共享合同冻结后拥有 Application/HTTP route 与测试。
- 验证计划：先失败测试，覆盖七语言、真实 120+ 条目录分页/远端定位、草稿/暂停/回退、同价/无价/范围过滤、查询绑定及过期 cursor、数据库故障不泄露、快照一致性；受影响测试与静态检查、真实 PostgreSQL、完整 check。若公共合同导致既有浏览器证据指纹失效，实际重跑门禁。
- 该纵切片完成后仍须继续 2B 媒体处理与内容写入/授权/preview/发布 purge 检查点；不会提前标 P3-01 DONE。

## P3-01 检查点 2A 验证记录（2026-09-05）

- 交付：13 个新增 versioned roots（累计 184 个生成定义，原 155 个深比较不变）；独立内容读取事务 port、真实 SQL 目录与发布证据 loader、查询绑定/版本失效 cursor、Application 用例、两个公开 GET operation 和生产组合/资源清理。只装载当前窗口完整内容，一个 SERIALIZABLE 事务覆盖目录版本、总数、价格/库存与强公开投影。
- 数据库：0010 增加 source-hash/算法版本绑定的可重建名字搜索投影与批次重建入口；0011 修复旧价格发布 BEFORE trigger 对 generated column 的错误比较，继续禁止改金额、有效期和其他原始字段。正常触发器 seed 验证实际价格发布，不使用 replica 绕过约束。旧媒体资格、七语言终审、不可变 revision 与公开字段门保持。
- 受影响测试：`mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/contracts --filter @fan-support/catalog --filter @fan-support/persistence-port --filter @fan-support/content --filter @fan-support/application --filter @fan-support/persistence-postgres --filter @fan-support/api test` exit 0；contracts 181、catalog 12、persistence-port 4、content 84、application 63、persistence-postgres 255、api 32，共 631 通过。
- 真实集成：`mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test:postgres:catalog` 与 `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:catalog` 均 exit 0，并已纳入根 `test:postgres`/`check`。120 位艺人、120 件礼物、7 locale；287 条 PG 断言覆盖连续翻页、定位第 100 位、Unicode/字面搜索、价格/库存/资格、快照、价格随时间生效及带数据 0011/0010 down/up。真实 loopback Nest/Fastify HTTP 的 31 请求/193 断言覆盖查询、locale、分页、409 cursor 失效和实际 DB 断连安全 503→同进程恢复 200；关闭后连接数归零。
- 完整检查：`mise exec node@24.20.0 -- corepack pnpm check` exit 0。合同/架构/format/lint 通过；typecheck 53/53（23 cached）、test 53/53（25 cached）、build 34/34（26 cached）；空库 11 迁移/109 表 round-trip、既有真实 PG 约束/repository/持久事件与 TLS S3-compatible 回归通过。
- 浏览器：顺序执行 `mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs` 与 `mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs` 均 exit 0。P2-04 16 场景/18 PNG/10 axe；P2-05 8 场景/22 PNG/3 axe，critical/serious 0，覆盖双基准视口、键盘、reduced-motion 与多语言长文案。刷新的是共享依赖对应的既有界面回归，未新增前台业务页或真机验收。
- 复核与收敛：独立非作者终审 ACCEPT；修复真实 PG 的 `to_jsonb(alias.*)` 行选择、无库存行的按需采购/预售资格、API 外部参数 `idol` 与 OpenAPI 一致性、严格 JSON 可序列化输出、迁移函数 schema 资格和 Unicode 投影。复用单一搜索规范化与事务 runner，不放宽旧发布门或原始数据不可变性。初始失败日志和根因保留。
- 其他检查：`mise exec node@24.20.0 -- corepack pnpm security:secrets` exit 0；最终文档/证据收尾另运行 `git diff --check` 与源码哈希复核，结果见 `validation.json`。
- 证据：`output/checks/p3-01-directory/README.md`、`validation.json`、`check.log`、`targeted-tests-final.log`、`compatibility-and-progress.json`、`implementation-source.json`；56 个实现/测试输入的 SHA256 为 `b96c2a50a715bac41b218724653a243716504e09e8dd3d08d2197208389e1dc8`。本地未提交工作区，HEAD `674ef5b4a57a6bb9ada6be5bf63670df9105ced4`。

### S.U.P.E.R 10 项（检查点 2A）

| # | 检查 | 结果 |
|:--|:--|:--|
| 1 | 文件职责单一 | PASS：合同、cursor、SQL、hydration、搜索重建、Application、transport 与 composition 分离 |
| 2 | 函数职责单一 | PASS：query 校验、窗口读取、证据映射、公开投影和 HTTP 映射各自独立 |
| 3 | 单向依赖 | PASS：Route → Application → Catalog/Content → Port；SQL/provider 仅在 adapter |
| 4 | 无循环依赖 | PASS：workspace/adapter/build 边界全仓通过 |
| 5 | Schema 定义边界 | PASS：13 个新 versioned roots；公开 API 不导出内部 source 记录 |
| 6 | 可序列化 I/O | PASS：事务输出严格 JSON，安全数值与 canonical cursor，无数据库/HTTP 对象跨边界 |
| 7 | 无生产硬编码 | PASS：market/currency/locale 显式输入，媒体 origin 与数据库来自现有配置，实体均数据库读取 |
| 8 | 显式依赖 | PASS：声明已有 workspace 依赖与既有版本 pg 测试依赖，无新第三方版本 |
| 9 | 可替换实现 | PASS：Application 依赖独立读取 port；数据库、HTTP 和媒体 URL 配置可分别替换 |
| 10 | 验证通过 | PASS：631 tests、真实 PG/HTTP、全仓 check、浏览器与独立复核通过 |

**检查点 2A 当时状态与下一入口（当前见文末 2B）**：检查点 2A 已验证，P3-01 仍 IN_PROGRESS。下一次直接进入实施计划 **2B**：真实图片解码/EXIF 清理、构图与派生图处理，并补受审别名和七语言详情的专属存储；随后完成内容写入/授权/preview、七语言原子发布/回退与 purge worker。历史 publication 的三个汇总 hash 尚无落地算法，本轮由不可变译文和 terminal APPROVED review 重建强投影证据，后续写入链路必须实现实际 manifest/hash。目录版本当前聚合数据库标量状态，尚无超大目录压测；HTTP no-store 不等于 CDN 发布 60 秒 SLA 已验收。现有 S3 回归不代表本轮媒体字节已加工，不新增 PSP、云、staging 或正式发布结论。保持已批准视觉及 49 项计数，不提前解锁 P3-02/03/04。

## P3-01 检查点 2B 媒体处理执行登记（2026-09-05）

- Owner：Codex `/root`，延续 Lane C 唯一 executor；开始 2026-09-05T14:27:22+08:00。用户明确要求继续下一步。
- 当前范围：实际私有原图校验/解码/EXIF 方向校正与元数据剥离、角色 master 和 AVIF/WebP/JPEG 多尺寸加工、真实对象存储写入/校验、PostgreSQL 持久任务领取/重试/结果以及 worker 接线。内容别名/详情存储随后接续，当前不开放无鉴权上传/管理 API。
- 兼容策略：新角色 master 是独立不可变 PNG asset，以 provenance 绑定原始 asset/metadata/recipe；旧 asset 尺寸、变体、发布和订单快照不变。加工成功不等于肖像权/译文批准；新 asset 默认版权 PENDING，不复制批准的 metadata。相同 checksum 精确核对后去重。
- 持久任务：使用 PostgreSQL 专属任务表作为等价持久队列，原子 enqueue、SKIP LOCKED、带 fencing 的 lease、有限重试与可查终止状态；不复用会扫描无关 event type 的支付 outbox consumer。网络/图片加工均在短数据库事务之外。
- 并行所有权：root 先冻结共享合同/port、只拥有共享 exports/registry/根配置/文档；directory_hydration 负责独立图片 adapter；directory_db_audit 负责新媒体 job/provenance SQL 与 repository；directory_api_audit 负责 Application/worker 和联合集成入口。各子模块在合同冻结后开始测试与实现，迁移序号由 root 指定，互不覆盖已有改动。
- 验证计划：先失败测试；真实横/竖/方/EXIF/GPS、低像素、伪 MIME、损坏/多帧图、checksum/尺寸边界；重复请求/并发领取/lease 过期/失败恢复/部分上传后重试、不可变旧行；实际 PG + TLS S3 输出重新解码与校验。最后受影响 tests、迁移 round-trip、format/lint/typecheck/build、完整 check、共享输入导致的浏览器回归及非作者复核。

## P3-01 检查点 2B 媒体处理验证记录（2026-09-05）

- 交付：14 个内部 versioned roots，累计 198 个生成定义，原 184 个定义深比较不变；独立图片处理 port、持久任务 repository/事务、真实 Sharp adapter、Application 和生产 worker 启停接线。角色 master 和 12 个响应式 AVIF/WebP/JPEG 产物经实际字节检验后原子登记，不自动授权或发布。
- 原图保护：0012 增加 3 个媒体任务/尝试/产物表；SOURCE/PROCESSED_MASTER 在各类别按 checksum 去重，类别及原身份不可改。真实同字节 PNG 回归证明原图整行保持、新主图独立且版权 PENDING。变体 key 按 master checksum 分组，避免不同角色相同小图的唯一键冲突。决定与回退保护见 ADR-010；已有加工历史或加工主图时拒绝降级，旧数据 up/down/up 通过。
- 受影响测试：`mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/contracts --filter @fan-support/content --filter @fan-support/media-port --filter @fan-support/media-image --filter @fan-support/persistence-port --filter @fan-support/persistence-postgres --filter @fan-support/application --filter @fan-support/worker --filter @fan-support/api --filter @fan-support/media-s3 test` exit 0，共 783 tests。图片 adapter 39 tests 覆盖 8 种 EXIF 方向、四输入格式、焦点/衬底/透明、元数据、真实损坏/多帧图、请求/总预算等。
- 真实集成：PostgreSQL 媒体 harness 136 断言、正常触发器、真实租约等待/六次终止、并发、完整产物回滚、源权撤销、去重与历史保护；该 harness 的产物元数据为合成 fixture。生产 composition → Application → 图片 adapter → TLS S3 → PostgreSQL 联合 harness 423 固定断言，通过正常/503 重试/实际 DB 断连恢复/同字节 PNG/真实 lease 过期与旧 token 隔离/有序 stop；5 个任务最终尝试次数 1/2/1/1/2，4 组共 52 个对象独立下载解码并核对 hash、格式、尺寸及元数据。
- 迁移与旧目录：12 个迁移/112 表 round-trip 通过。全仓初次运行暴露旧目录 harness 把 0011 当最新 head 的假设；现显式回退无加工历史的 0012，再测试 0011/0010，最后升回当前 schema，287 目录断言通过；未绕过保护或修改旧内容。
- 浏览器：共享合同/lock 变化后，实际顺序重跑 P2-04（16 场景/18 PNG/10 axe）和 P2-05（8 场景/22 PNG/3 axe），均 exit 0，critical/serious 0。双基准视口、键盘、reduced-motion、多语长文案与组合组件原生 200% zoom 回归保留。没有新的业务前台、真机或视觉批准结论。
- 复核与收敛：两个非作者只读复核合同、事务、DDL/新身份、Application 和 worker 生命周期，解决 source/master 同字节冲突后 ACCEPT。code-simplifier 只收敛编码分支，保留图片请求/解码/预算以及 PG data/output/repository 拆分。
- 完整门禁：`mise exec node@24.20.0 -- corepack pnpm check` exit 0；合同/format/lint/架构通过，typecheck 56/56（53 cached）、test 56/56（27 cached）、build 35/35（28 cached）；31 package exports 由 Node 实际导入。该运行再次通过媒体 PG 136、联合 423、目录 PG 287/HTTP 193 断言及旧 PG/S3；联合任务实际尝试次数为 2/2/1/1/2，普通任务一次临时存储失败也自动恢复，没有要求偶发网络每次仅一次成功。`pnpm security:secrets` 与 `git diff --check` exit 0；最终退出码与缓存见 `validation.json`。
- 证据：`output/checks/p3-01-media/README.md`、`validation.json`、`implementation-source.json`、`compatibility-and-progress.json`；61 个实现/测试/ADR 输入 SHA256 `19276cab1a151fef35498cba2391be6be7721343d3c4380719eb9fb4a73eb9b7`。本地未提交工作区，不是远端 CI 或正式发布。

### S.U.P.E.R 10 项（本轮媒体处理范围）

| # | 检查 | 结果 |
|:--|:--|:--|
| 1 | 文件职责单一 | PASS：合同、receipt、transfer、codec、budget、repository、runtime/composition 分离 |
| 2 | 函数职责单一 | PASS：校验/编码/对象传输/事务/资源关闭分别实现，编码分支明确 |
| 3 | 单向依赖 | PASS：Application 只引用内层和 ports；Sharp、SQL、S3 留在 adapter/composition |
| 4 | 无循环依赖 | PASS：workspace 校验 4 apps/31 packages/35 units，无循环 |
| 5 | Schema 定义边界 | PASS：14 个内部 versioned roots，旧 184 个定义不变 |
| 6 | 可序列化 I/O | PASS：command/receipt/job/错误均 Zod JSON，二进制与签名 URL 不跨图片 port |
| 7 | 无生产硬编码 | PASS：数据库、存储和认证由现有配置注入；尺寸/编码/profile 是有版本的处理规则 |
| 8 | 显式依赖 | PASS：workspace 与 Sharp 0.35.4 显式声明，复用锁文件已有版本 |
| 9 | 可替换实现 | PASS：图片 codec、S3 和 PG 可以沿 ports 分别替换；队列不耦合支付 consumer |
| 10 | 验证通过 | PASS：783 tests、真实 PG/S3/HTTP、浏览器、完整 check 与独立复核全部通过 |

**下一入口与边界**：继续 2B-内容存储，完成艺人别名与礼物结构化详情/专属七语言译文，再接可信原图登记、授权编辑/preview、审核、七语言原子发布/回退/purge。主图仍需独立 metadata 审批；原图权利撤销须沿 provenance 进入发布资格，双端 Hero 需验证独立原始来源。终止任务人工重试和无引用半成品对象清理尚未实现。有序 composition.stop 可 drain；真实进程的既有 SIGTERM 10 秒上限可能先于图片预算强退，靠持久 lease 重领恢复，未宣称长任务均完整退出。P3-01 继续 IN_PROGRESS，49 项计数保持 17 DONE / 1 IN_PROGRESS / 31 PENDING，不解锁后续页面任务，也不新增手机、PSP、云、staging 或生产证据。

## P3-01 检查点 2B 内容存储验证记录（2026-09-06）

- Owner：Codex `/root`，Lane C；本轮验收时间 2026-09-06T00:16:51+08:00（2026-09-05T16:16:51Z）。本子检查点完成，P3-01 保持 IN_PROGRESS。
- 交付：8 个新增内部 versioned roots，198 个旧定义深比较不变；0013 的 10 张专属关系表与 SERIALIZABLE draft repository，真实源稿/七语言译文/固定结构/独立别名集合；服务端 hash、初始 DRAFT review 与精确创建 audit 同事务。原 v1 description、价格、媒体与发布历史不改。
- 查询：公开艺人搜索从仅当前 locale 扩展到当前发布版本的全部七语言姓名与 handle，按最佳匹配去重后分页，响应文案仍严格请求 locale；草稿与未审别名不入公开投影。
- 数据约束：父 revision 行锁、DRAFT 限制、复合归属 FK、不可变数量与提交完整性、六类 child 容量封闭、不可 UPDATE/DELETE/TRUNCATE；真实双向并发和旧库 up/down/up 通过，任何新扩展历史存在时拒绝降级。含扩展的 revision 在 lifecycle 和 publication 双入口拒绝验证/发布/回退，直至后续完整授权与审核证据接通。
- 性能：最大合同载荷 32 LIST 块 × 24 条目 × 7 locale（5376 个译文条目）的初版提交重复扫描导致总 19218 ms / COMMIT 17396 ms；经 RED 后将完整性延迟检查收敛到 header，child 保留父锁下容量限制，最终完整检查量测 2280 ms / COMMIT 5 ms。此为本机 fixture 结果，不是生产 SLA。
- 受影响测试：contracts 212、content 102、catalog 12、persistence-port 4、persistence-postgres 273、api 32、worker 23，共 658。真实 PostgreSQL 内容约束 103 / repository 62、目录 307 / loopback HTTP 264 断言（43 请求），13 迁移/122 表；旧媒体 PG 136 与 PG + TLS S3 联合 423 断言继续通过。
- 完整门禁：`mise exec node@24.20.0 -- corepack pnpm check` 最终 exit 0；format/lint、生成合同与边界通过，typecheck 56/56（55 cached）、test 56/56（55 cached）、build 35/35（35 cached），31 package exports 经 Node 实际 import。此前独立 `turbo run typecheck test build` 105/105（63 cached）及受影响非缓存测试也通过。
- 浏览器：P2-04 16 场景/18 PNG/10 axe，P2-05 8 场景/22 PNG/3 axe；双基准视口、七语言覆盖、键盘/reduced-motion/错误与长文案证据实际刷新，critical/serious 0。P2-04 指纹 `189b27de004752fb72802d15cd0dae39350fd4b26e100c45ad00e8100c72b544`（212 输入）；P2-05 `90e44f53bbf39bd5e93e884785d3d5021146124d4bfa9b2192d617b71f3fca90`（328 输入）。既有品牌批准及 iPhone 证据保持历史状态，无新真机结论。
- 独立复核：directory_hydration / directory_api_audit 对新仓储/事务/SQL ACCEPT；性能优化后的封闭性及受限媒体诊断再次非作者 ACCEPT。代码职责检查保留合同、纯准备、SQL 写入、读回映射与事务各自边界，没有扩大重构。
- 失败记录：初始 RED、SQL 方言/触发器绑定与 manifest 迭代、重复 locale 权威检查均保留。首次全仓检查被容量临时诊断脚本缺少 URL import 的 lint 阻断并修正；第二次出现既有媒体数据库恢复集成的间歇失败，增加子阶段/枚举状态诊断，未复现到明确源码缺陷、未改生产重试或断言。独立复验及最终全仓 423 联合断言通过；仍保留原失败证据供后续追查。
- 证据入口：`output/checks/p3-01-content-storage/README.md`、`validation.json`、`check.log`、`implementation-source.json`，并引用 `p3-01-content/` 与 `p3-01-content-drafts/` 的 RED/GREEN。实现 32 文件 SHA256 `f15247ed1d41c2dfec76be606f4d0f9f8d285598a01a4847aa9b49a6c478e5d6`；本地 HEAD `674ef5b4a57a6bb9ada6be5bf63670df9105ced4`，仍为未提交工作区。

### S.U.P.E.R 10 项（本轮内容存储范围）

| # | 检查 | 结果 |
|:--|:--|:--|
| 1 | 文件职责单一 | PASS：合同、内容准备、写入、读回、事务与迁移各自独立 |
| 2 | 函数职责单一 | PASS：验证、hash、映射、原子持久化分别收敛 |
| 3 | 单向依赖 | PASS：Application/Port/Adapter 边界未逆向依赖 |
| 4 | 无循环依赖 | PASS：无新依赖，边界/typecheck/build 通过 |
| 5 | Schema 定义边界 | PASS：8 个新 roots 同源生成，198 个旧定义不变 |
| 6 | 可序列化 I/O | PASS：严格 JSON、optional 字段省略、规范 timestamp 与 ID |
| 7 | 无生产硬编码 | PASS：七语言唯一权威来自 contracts，艺人/域名均为 fixtures |
| 8 | 显式依赖 | PASS：复用已有依赖，无新增供应商/运行包 |
| 9 | 可替换实现 | PASS：独立 repository/transaction port，不暴露 pg 对象 |
| 10 | 验证通过 | PASS：658 tests、真实 PG/S3、浏览器、全仓检查及独立复核 |

**本轮边界与下一入口**：只实现可信内部草稿持久化，不提供管理 HTTP/session/RBAC/CSRF；ACTIVE actor 与 audit 不构成完整授权。稳定 ID 重复拒绝和 request ID 冲突不代表完整幂等结果重放。新别名尚不公开检索，结构化详情暂不发布。下一步按计划检查点 3 实现授权、内容复制/提交/独立审核、短时只读 preview，再接发布/回退/outbox/purge；结构作者也必须与审核者独立，缺译不得静默回退旧 description。P3-02 至 P3-06 不提前解锁，无新 PSP、云或生产发布证据。
