# Phase 3 — 自研 Admin、内容与浏览前台

> 状态：ACTIVE
> 任务：6  
> 解锁条件：Phase 1 与 Phase 2 退出门禁均通过

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
| P3-06 | READY | — | P3-02/03/04/05 | 七语言 i18n/SEO/cache/运营/性能验收；Lane D空闲，尚未领取 |

## 必须证明

- 页面由真实 PostgreSQL seed/fixture 和对象存储媒体驱动，无硬编码正式偶像或礼物。
- 内容发布后 60 秒内前台可见，失败有状态和重试。
- `en/zh-CN/th/vi/ja/es/pt`、self-canonical/hreflang/x-default/locale sitemap、locale cache、图片裁切、空/错/暂停/售罄/fallback-noindex 状态完整。
- 运营达到 3/5/8 分钟更新目标。
- 七语言关键译文批准、缺失/过期为 0；语言切换保留同一实体、购物车、market、currency 和支付上下文。

## Phase 退出证据

已于 2026-09-05 依据用户明确视觉接受与继续开发指令解锁；尚未达到退出门禁。

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
