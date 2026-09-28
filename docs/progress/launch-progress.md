# 当前上线进度

> 当前方案：[可配置装修与完整交易上线计划](../plan/2026-09-28-flexible-storefront-launch.md)；用户于 2026-09-28 确认，见 ADR-020。
> 状态：`PENDING / READY / IN_PROGRESS / LOCAL_ACCEPTED / BLOCKED_EXTERNAL / DONE`；DONE 必须满足该项明确验收，不等于整站已上线。
> 旧成果与未完证据保留在 [v2-progress.md](v2-progress.md)，不复算旧 49 项百分比。每项结论不超过十行，详细日志在 `output/`。

| 项目 | 状态 | 当前结论与下一步 |
|:--|:--|:--|
| L0 基线对齐 | DONE | root，2026-09-28 开始并完成；同步 GitHub 55d5165b，更新 SPEC 5.0.0 / ADR-020 / 统一入口；13 份文档的 17 个相对链接及独立复核通过。现有服务器和数据未改动。 |
| L1 首页装修样板 | DONE | root 协调，2026-09-28 完整验收；管理中心排序/显隐、真实双端预览、草稿/发布/历史恢复已接通。实际 PG 35 项、44 迁移往返、七语双端、海报与布局互不覆盖、正式构建 21+107 项及重启 7 项、原交易专项 258 项、check:dev 与独立复核通过；原体验和服务器未动。详情见下方本轮验收。 |
| L2 日常装修完善 | IN_PROGRESS | L2-01 全站主题、L2-02 图片焦点与中文入口、L2-03 布局与动效已完成；下一项艺人/礼物详情模板，随后导航页脚与信息页。 |
| L2-01 全站主题 | DONE | root 协调，2026-09-28；独立主题、后台双端预览/草稿/发布/恢复与所有公开页接通。PG 41 + 旧布局35、45迁移往返、浏览器发布23/七语573/重启9、200%缩放、交易252、check:dev与独立复核通过；未改变原体验或服务器。详见下方验收。 |
| L2-02 图片焦点 | DONE | root 协调，2026-09-28；艺人/礼物/海报原图调焦、七语可见入口与中文提示完成，图片编辑保留实时售价/库存。PG18+48、实际像素12、旧图24、浏览器上传36/编辑56/七语101/重启19、交易258、check:dev与独立复核通过。使用新隔离体验；未部署服务器。详见下方验收。 |
| L2-03 布局与动效预设 | DONE | root 协调，2026-09-28；中文及七语布局/动效设置沿用主题完整闭环，旧默认和历史兼容。PG108、46迁移往返、浏览器发布恢复24/独立620/重启6、200%缩放、交易281、真实订单摘要保护、check:dev与独立复核通过；仅新隔离体验，未部署服务器。详见下方验收。 |
| L3-01 沙盒验证结果可信性 | DONE | root 协调、独立执行与复核，2026-09-28 开始并完成；零回调/错配/验签失败均不通过；配置检查不联网、秘密与付款链接不入普通输出。29 个 adapter 测试及 43 个脚本测试、check:dev、独立真实 adapter/HMAC 检查通过。 |
| L3-02 Stripe adapter 实际沙盒 | DONE | root，2026-09-28；受限本地配置 + 官方 CLI 转发 + Playwright 托管测试页：USD 25 测试付款、USD 5 部分退款、重放、查询、取消及对应验签回调通过；12 项检查全通过。仅 adapter 验收，`siteOrderFlowVerified=false`，没有真实资金交易。 |
| L3-03 本站 Stripe 接线准备 | DONE | 新隔离实例显式stripe-test、旧fake实例不可切换、Web/Worker不接收支付密钥；75项接线测试及独立复核通过。L3-04已补实际本站沙盒验证，正式生产配置仍不在本项范围。 |
| L3-04 本站 Stripe 实际沙盒 | DONE | root / stripe_preparation，2026-09-28；同一原订单USD48测试收款、USD5部分退款、验签Inbox/Worker、TEST邮件查单、原签名重放、粉丝和管理端退款回读通过；组合验收与独立审查通过，原失败报告保留。两笔未付款测试订单已正常取消，未用真实资金。 |
| L3 正式交易与运营 | IN_PROGRESS | Stripe adapter及本站实际沙盒已完成；继续正式邮件/OIDC、四类礼物与混合/异常交易、支付中断安全恢复、内容政策审校。Airwallex申请中，生产商户尚未批准。 |
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

## L2-01 本轮验收（2026-09-28）

1. 基线 `220d3bc7`，开始时远端无新提交；root 负责商城与现场验收，focal_audit 负责合同/应用/PG，theme_audit 负责后台，theme_review 独立复核。保护原实例，使用 `test-regression-theme-0928`。
2. 全站主题独立四表与 API，三套深色配色及字号/留白/圆角共54组合；任意CSS/脚本/交易字段拒绝，旧731合同根/216 OpenAPI schemas/142路径解析不变。真实 PG 41项、旧L1 35项与45迁移/211表往返通过：`output/checks/l2-theme/backend-verification.md`。
3. 正式构建真实浏览器发布23项、七语390×844/1440×900及主要公开页面573项、重启9项通过；28次axe无严重/致命问题，320/720及后台768/1024/1152、错误保稿/键盘/正常和减少动态效果通过。Chrome原生200%缩放实测通过；截图已查看，见 `output/checks/l2-theme/browser/`。
4. 恢复主题后较新的海报与布局保留；主题覆盖body和portal，预览无业务写入。公开主题失败明确503；商城最多等待1秒，以带FALLBACK/UNAVAILABLE状态的默认外观继续交易。已打开页面刷新后更新主题，详见本地runbook。
5. 同一已发布主题下新订单→付款→邮件查单→审核/准备/送达照片→退款→未支付取消→支付配置，252断言/4场景通过，零观察异常/pageerror。限定COMMERCE范围PARTIAL_PASS：`output/playwright/p5-08-local-experience/test-regression-theme-0928-1790554093742/report.json`，支付使用本地模拟PSP。
6. 修复检查发现的后台文案组织违规；重新生成既有漂移的中日字体字集，并将L1已有尺寸/层级写法接回设计令牌。原始失败日志保留。最终check:dev（69/69/38任务，含缓存）、check:contracts、57项设计基础检查、源码秘密扫描3761文件通过。
7. 独立审查无P1/P2，S.U.P.E.R十项与小范围收敛通过；完整入口 `output/checks/l2-theme/final-verification.md`。无新增第三方运行依赖，未部署服务器或使用真实资金。
8. 下一项图片焦点的媒体链路分析已完成：`output/checks/l2-theme/focal-readiness.md`；将复用原图和现有处理队列，不用CSS位移冒充已丢失像素的裁切。

## L3-04 本轮组合验收（2026-09-28）

1. 新隔离正式构建实例 `test-regression-stripe-0928`，官方CLI当前签名原样转发至正式API webhook→Inbox/Worker；API key/whsec只经受限文件和进程环境使用，未改根.env、原体验或服务器。后台内容专项39项通过。
2. 原订单在Stripe托管页实际测试付款USD48，回到同一checkout/attempt只读确认；1条付款成功回调验签、Worker匹配并单次入账，TEST邮件新浏览器查单通过。管理中心发起一次USD5部分退款，2条原退款回调验签/Worker通过；粉丝端PARTIALLY_REFUNDED、管理端SUCCEEDED/500最终回读通过。
3. 付款原签名重放1条、退款原签名重放2条，均202；始终1 capture4800、1 refund500、1退款账本、1付款通知，Inbox/履约/effect数量不增。退款回调通过canonical event关联到后台已认证成功的退款，实际只读PG正例及错订单/attempt/reference/状态等负例共20项通过。
4. 这是同一订单的组合验收：原run在已提交退款后财务刷新等待失败，其FAIL不改写；只读恢复核对原order/checkout/attempt及退款，无新付款、无再次退款。报告 `output/checks/l3-04-site-stripe/acceptance-summary.json` 为PASS、`siteOrderFlowVerified=true`，记录11个步骤与全部源报告hash；独立复核见同目录 `independent-l3-04-review.md`。
5. 两笔早期未付款测试订单先确认0收款/退款，再通过正常管理中心各取消一次；两条原Stripe expired回调均验签/Worker成功，UI CANCELED、attempt EXPIRED，无资金/通知。取消证据 `cancel-1790555317274/report.json`。
6. 原失败完整保留：填写器缺邮箱、程序化fill未形成托管页有效提交（逐键输入后成功）、中文文件路径截图错误、300秒action过期、财务刷新等待及退款callback关联口径误报。只发现hcaptcha组件不等于展示人工挑战，早先验证提示已撤回。没有修改产品TTL、付款规则或重签旧回调。
7. 可复用入口：[Stripe沙盒说明](../runbooks/stripe-sandbox.md)。本轮只补验收工具与运行证据，不改正式支付adapter或订单实现。CLI/Stripe实例完成后停止，数据库保留；恢复主题体验实例。真实邮件/OIDC、生产收单资格、真实资金与发布验收仍待后续，整个L3没有关闭。


## L2-02 本轮验收（2026-09-28）

1. root 协调，focal_backend_audit 后端、focal_ui_audit 后台、launch_gap_audit 独立复核；07:49:51Z 开始，基线639c5800，提交前远端再次核对一致。新实例 `test-regression-focal-0928`；三个原实例业务/配置/数据库/对象文件未变，Chrome缓存后台变化单独记录，未接触服务器。
2. 新图或现有图可展开调焦：艺人三种、礼物一种、海报两种预览；从已证明来源的原图重建后原子发布，文案编辑保焦点、幂等重试、历史海报恢复通过。短时原图签发前后核权，浏览器不持久化；无法证明来源要求重传。中文及七语入口完整，快速切换语言也保护内容/装修/支付草稿。
3. 关联修复：图片或文案保存不写回陈旧价格/库存；显式修改分别锁内验证原值，冲突保旧。真实PG原问题9→10库存、1500→1000售价反例已复现，修复后48项通过；来源/权限链18项通过。两专项已纳入正式 `test:postgres`，后者含人工lineage负例，不替代正常发布。
4. 正常浏览器上传36项、现图调焦/文案/海报恢复56项、七语390×844与1440×900矩阵101项通过；28次axe无严重/致命问题，点击/键盘、来源失败/重传/重试、503保稿、立即切语言取消/确认、正常与减少动态均实测。重启19项通过。实际S3原图/生成主图12个角色像素一致，旧订单24份派生图片文件校验不变，新订单绑定新图片。
5. 装修与交易：已发布主题/布局头、内容、版本数前后hash完全一致；旧订单行及24个派生记录完全一致。新完整购买→可信模拟支付回调→TEST邮件查单→审核/准备/送达照片→退款→未付款取消→支付配置，258断言/4场景通过；报告 `output/playwright/p5-08-local-experience/test-regression-focal-0928-1790584430397/report.json` 为限定COMMERCE的PARTIAL_PASS，不冒充真实PSP或整站生产验收。
6. 保留原始失败并修复：JSON字段顺序导致原图误报409、原图桶缺GET跨域权限、快速编辑后切语言的effect时序丢稿；各自失败反例与最终实际回证齐全。生产IaC仅补受限管理源GET，18项离线mock plan通过，未apply；实际TLS S3集成也通过。原格式/lint/单测fixture失败日志未覆盖。
7. 最终 `check:dev` exit0（69 typecheck /69 test /38 build任务，含缓存），合同生成、57项设计基础检查、3781源码文件秘密扫描和S.U.P.E.R十项/独立复核通过。旧70意图JSON/hash不变，740合同根仅管理范围扩展，数据库迁移及交易合同未改。完整证据 `output/checks/l2-focal/final-verification.md`。
8. [本地操作说明](../runbooks/local-experience.md)已更新。浏览器使用前台正式构建、后台本地开发服务；后台正式构建已通过但不代替线上OIDC/邮件/云权限验收。原Stripe TEST验收保留，本轮未调用PSP或使用真实资金；后续L2布局动效与L3正式登录/邮件、支付中断和四类礼物闭环仍按全局计划推进。


## L2-03 本轮验收（2026-09-28）

1. 08:58:05Z 开始，基线0a4ae2d6，提交前远端无新增；root负责前台/令牌/组合验收，backend负责合同/PG，UI负责后台，gap独立复核。使用新实例 `test-regression-presets-0928`，四个原实例配置/数据库/媒体等非Chrome文件2950/3011/2982/3185摘要未变，未接触服务器。
2. 首页沉浸/图文分栏、礼物网格/大图、标准/轻柔/关闭动效与标准/快捷速度，在既有折叠面板内七语可用；复用预览、草稿、发布和追加恢复。旧五字段JSON/hash不变，新presentation严格四枚举；0046仅扩校验函数，不新增表/业务API，历史含新配置时拒绝数据库降级。
3. 合同8项（24新组合/54旧hash）、应用2项、实际PG108项及46迁移/211表往返通过；真实PG非空gift/价格2500/库存7正常写入后，主题操作不改11业务表。740合同根仅7主题根、222 OpenAPI schemas仅5主题定义、149路径仅主题draft请求改变；见 `output/checks/l2-presentation/backend/handoff.md`。
4. 实际浏览器发布/恢复24项、独立七语390×844/1440×900及动效/交互620项通过，28axe无严重/致命问题；包含320/720、触屏、键盘、503保稿、立即切语保护、预览重播与旧属性清除、系统减少动态优先。原生Chrome200%与CDP截图已核对；默认双端静态像素保持，分栏不改艺人详情，恢复主题保留较新海报和区块设置。
5. 新预设下完整本地交易281断言/4场景，零pageerror/observation；正常购买→可信模拟支付→TEST邮件查单→审核/准备/照片送达→退款→取消→支付配置。报告 `output/playwright/p5-08-local-experience/test-regression-presets-0928-1790587461730/report.json` 是限定COMMERCE的PARTIAL_PASS，不是FULL或真实PSP。主题矩阵与重启前后15组摘要相同：2订单/2订单行/1支付attempt/24媒体非空；按单采购实例库存为空，限量库存证据来自上项真实PG，不将空表当验证。
6. 正常停止并重启后，主题/布局/内容精确回读和实际界面6项通过，订单摘要仍一致。前台正式构建、后台本地开发服务；两站正式构建已通过。全仓check:dev exit0（69 typecheck/69 test/38 build任务，含缓存）、storefront851/admin311/tokens23/design57及3789源码秘密扫描通过。
7. 独立复核发现并修复NONE遗漏分类颜色过渡，实际computed style关闭确认；保留全部原失败。验收脚本修正登录骨架/stream隐藏节点/details展开、秒与毫秒等值观察、native截图裁剪和快照基线参数；不放宽产品合同/时长/数据比较。S.U.P.E.R十项和代码收敛通过；完整证据 `output/checks/l2-presentation/final-verification.md`。
8. [本地操作说明](../runbooks/local-experience.md)已更新。下一项艺人/礼物详情模板，随后导航页脚；L3真实邮件/OIDC、四类礼物与混合异常、支付中断续接和政策审校仍保留，L4尚未开始。本轮未调用Stripe、外部邮件或真实资金，不将本地验收当正式发布。
