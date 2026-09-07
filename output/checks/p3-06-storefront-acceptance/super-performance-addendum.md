# P3-06 性能第二轮 S.U.P.E.R 只读补充复核

结论：**第 1–9 项在本次性能改动范围内 ACCEPT；第 10 项 PARTIAL。** 这不是 P3-06 DONE、性能通过或生产发布证明。

依据 `.agents/skills/fan-support-platform-dev/SKILL.md` 的十项清单，复审者 `/root/storefront_read`。本次只读源码、已有日志及独立评审，仅写本文，没有运行测试、构建、服务、HTTP 或浏览器。首页/艺人流式组合由本代理实现，该部分采用目录代理的非作者复审；root 礼物调度和 loading 字体、目录代理公共合同拆分由本代理独立只读核对，区分作者与复审来源。

目标源码清单：`implementation-source-performance-iteration-2-final.json`，1526 个输入，SHA-256 **`5cafc7406b4213ac07c35e2d8a5e304b5efea745dcba4d7e1f22dfa071df4b5b`**，捕获于 2026-09-07 17:46:32 UTC。本次只对 17 个相关当前文件逐项比对该清单 SHA，全部匹配；没有重新计算全仓清单。前一轮 `fe46825e…` 的 63 个性能样本不是这份新源码的通过证据。

## 十项检查

| # | 检查 | 状态 | 本轮事实与范围 |
| --- | --- | --- | --- |
| 1 | 新模块/文件职责单一（S） | ACCEPT | `gift-detail-page-reads.ts` 只组织详情所需公开读取；`HomepageDirectory` 只等待已启动目录并渲染原目录；`ArtistGiftDirectory` 只将商务 context 与礼物目录留在下屏边界。首页/艺人/礼物页面、读取、SEO、客户端选择控件保持分隔。公共 DTO 和纯 locale 值从含内部 schema 的旧模块分离，没有加入业务职责。 |
| 2 | 函数承担一个概念职责（S） | ACCEPT | `readGiftDetailPage` 将参数解析和依赖选择限定为一次详情读取计划，`Promise.all` 只启动相互独立 GET，返回结果交回工厂做既有状态判断；没有在这里计算价格、库存或发布资格。页面保留原渲染判断；两个小 server child 是必要的异步渲染边界，没有通用任务框架或可信跳过开关。 |
| 3 | 数据单向流动、无反向依赖（U） | ACCEPT | 页面工厂 → 页面读取 helper → 现有严格 HTTP reader → API。`gift-detail-page-reads.ts`、工厂、两个异步 child 与读取入口均留在服务端链，并带 `server-only` 或由其 server-only 依赖封闭。Domain/Port/PG 没有因此导入 Next/React。客户端目录收到的是解析后的公开 DTO；没有把 PG、服务端配置、原始响应或权限材料传入浏览器。 |
| 4 | 未引入循环导入（U） | ACCEPT | 新 helper 只向原 reader/纯选择器依赖，reader/选择器没有反向导入页面工厂；两个 server child 不回引父工厂。旧 locale / catalog-directory 入口单向导入并 re-export leaf，leaf 不导入旧入口。这里只确认本轮新增边，不代替最终全仓依赖检查。 |
| 5 | 接口使用已有 schema/types/contracts（P） | ACCEPT | gift handle 由 `slugSchema` 校验并使用 `StorefrontGiftReadCommand['handle']` branded 类型；market/currency/idol/variant 仍由 `parseGiftSelection` 的现有 schema 解析。只有 VALID selection 才读 scoped commerce，缺省/无效上下文不会生成报价。HTTP reader 的响应 schema、状态、locale/handle/市场/收礼人匹配仍完整。公共 DTO 拆分保持原 schema 对象同绑定、原 refinements 和所有定义，没有增加 schema root。 |
| 6 | 业务 I/O 可序列化（P） | ACCEPT | 新详情 helper 返回普通结果对象、原公开 DTO 与判别联合；市场、金额、ID、文案仍是原 JSON 合同。`Promise` 和 `ReactNode` 仅用于同一服务端渲染树的异步/组件组合，不是新业务 DTO 或网络/队列载荷；`HomepageDirectory` 在向客户端 `ArtistDirectory` 传 props 前已 await 得到公开响应。没有把函数、Zod 实例、DB client、Map 或原始 Error 加入公共数据。意外 rejection 继续中止渲染，不转成成功。 |
| 7 | 无新硬编码部署配置（E） | ACCEPT | 站点/API origin 仍来自现有校验配置；没有加入正式域名、艺人 ID、market、currency、价格、密钥或生产 locale 特判。七语值只有 contracts 里的 canonical leaf 一份，旧入口 re-export。Loading 仅取 `DESIGN_TOKEN_CONTRACT.runtimeDefaults['--font-ui']` 已有系统字体 token，没有新增字体字面量或删除正式 Noto 字形。协议路由、DOM 锚点与 TEST 夹具常量不冒充部署配置。 |
| 8 | 新依赖显式声明（E） | ACCEPT | 这组性能改动使用既有 React/Next/contracts/design-tokens；本轮比较的 source delta 未修改 package 或 lockfile。新增模块没有隐式读取未声明第三方包。字体仍通过现有字体配置加载，未引入外部字体服务。这个判断不扩大为此前 P3-06 全部依赖的供应链审计。 |
| 9 | 模块可按合同替换（R） | ACCEPT | 等待顺序和下屏渲染可以在本 app 模块内替换，业务 reader、API 与 Domain 合同无需变化。DTO leaf/locale leaf 的旧导出仍指向同一实际值，消费者无需迁移到另一个业务协议。替换不能抹掉当前发布证明、市场资格、错误或真实 404 条件。 |
| 10 | 改动后全部验证通过 | **PARTIAL** | 新最终前台测试日志为 **46 files / 316 tests PASS**，root 全前台 typecheck PASS；有首页/艺人的 RED→GREEN 及独立源码审查。**这份 5caf 源码的完整真实性能、最终全仓检查和人工验收尚未完成。** 不将旧运行、局部通过或已启动新构建视为最后通过。 |

## 关键组合行为

- **首页与艺人主视觉仍有证明门。** 首页必须获得安全 homepage 后才输出真实 hero/preload；目录等待独立。艺人 slug/当前不存在检查仍在返回任何正文或 Suspense shell 之前完成，避免 404 被提前 flush 的 200 取代。商务 context 仅在成功的艺人子树中读取，入站 idol 参数仍被真实 artist.id 覆盖。
- **礼物并发不是放宽响应验证。** Root 的 `readGiftDetailPage` 同时发起原 published gift、有效 scope 的 commerce、艺人目录读取；页面和 context 也并行。既有严格 reader 不变，最终仍等待全部相关结果再选渲染分支；不存在/异常不返回正常详情 shell，缺少市场不凭空补价格。对于独立读取间可能发生的更新，页面优先采用完整 scoped 成功视图，不在前台拼接不同响应的价格与库存事实；此次没有建立新的跨请求一致性承诺。
- **隔离仅减少不必要的依赖与等待。** 首页静态依赖门保留，首页无需引入礼物筛选、收礼人和购买客户端入口。公共目录 schema 与纯 locale 叶子模块隔离只证明源码依赖边界；实际 bundle 字节下降仍由新构建/网络报告确定。
- **系统字体仅用于短暂 Loading。** `route-states.tsx` 的临时 `main` 设置既有 system token，子标题/状态文案继承它；正式内容、字体 profile 和按 unicode-range 的 Noto 资产未改。此举可能减少加载文案提前触发 CJK 分片，但本文没有采集新的字体请求，不能给出实际节省或字体观感通过结论。
- **仍需量测布局变化。** 下屏目录目前用简短 loading 状态，未预留全部卡片高度。目录代理已将 desktop 可视区可能出现 CLS 列为待真实观测项，不在无证据时改样式或声称没有影响。

## 已读取证据与来源

- `performance-source-storefront-tests-final.log`：root 运行完整 storefront Vitest，46 files / 316 tests PASS，2026-09-08 01:45:39 本地时间开始；本次只读日志，没有再跑。
- `performance-source-typecheck-final.log`：root 全 storefront `tsc -p tsconfig.build.json` 成功记录。本次新 helper 已使用 branded handle；此前类型失败保留在 `streaming-composition-typecheck*.log`，不抹去历史失败。
- `streaming-composition-README.md`、`streaming-composition-source.json`、`homepage-directory-streaming-red.log`、`artist-directory-streaming-red.log`、`streaming-composition-final-tests.log`：本代理实现时的有效 RED 与 55 项定向 GREEN、格式/lint 和 7 文件独立快照；目录代理非作者审阅通过。早一次夹具遗漏 aliases 的启动/校验错误另存，不当作有效功能 RED。
- `public-contract-boundary-independent-review.md`：本代理非作者复审，独立 2 files / 9 tests PASS；目录 26 项与 locale 13 项 AST 声明与正确 baseline 逐字相同，旧导出同绑定，4 个产物/index/package SHA 不变。这里复用既有证据，没有重跑。
- `lcp-readonly-diagnostic.md`：旧 63 样本中 hero 的发现等待、已有 preload 与 CJK 字体证据；只作为这轮改动依据，不是新性能结果。
- `super-review.md`、`acceptance-gates-review.md`：此前 P3-06 总体结构审查和退出门映射继续有效，本补充不改其阶段归属。

总体未发现需要在本轮继续改产品源码的架构阻断。第 10 项保留 **PARTIAL**：新构建与浏览器/Lighthouse 的实测预算、最终完整检查、真实 VoiceOver/其他要求的辅助技术体验、非开发者 3/5/8 分钟操作和真实文案审核均须各自提供证据。TEST 自动化、准备好的 UAT 材料、旧本地发布可见性，不等于这些真人结果，也不等于 staging、正式 CDN 或 RUM 通过。阶段状态和下一步调度由 root 统一维护。
