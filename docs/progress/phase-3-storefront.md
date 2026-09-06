# Phase 3 — 自研 Admin、内容与浏览前台

> 状态：ACTIVE
> 任务：6  
> 解锁条件：Phase 1 与 Phase 2 退出门禁均通过

## 目标

让运营通过自研 Admin 管理首页、偶像、媒体、礼物、七语言翻译、价格和库存；让粉丝以英语为主语言并可切换简体中文、泰语、越南语、日语、西班牙语和葡萄牙语完整浏览首页、偶像与礼物。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P3-01 | IN_PROGRESS | Codex `/root` | P1-02、P1-04、P1-05、P1-06 | 检查点 1、2A、2B、3A、3B、4A、4B 已验证；下一项为4C完整验证与发布/回退/purge |
| P3-02 | PENDING | — | P2-03、P3-01 | Admin 首页/偶像别名/媒体构图与预览/翻译矩阵/审核 UI |
| P3-03 | PENDING | — | P2-03、P3-01 | Admin 受控详情块/七语言礼物/价格/库存 UI |
| P3-04 | PENDING | — | P2-06、P3-01 | `/:locale` Storefront shell/语言切换/首页/艺人连续横滑/搜索定位/详情 |
| P3-05 | PENDING | — | P2-04、P3-01、P3-04 | 礼物分页/筛选/价格排序/URL恢复/七语言详情/选择偶像/政策/错误状态 |
| P3-06 | PENDING | — | P3-02/03/04/05 | 七语言 i18n/SEO/cache/运营/性能验收 |

## 必须证明

- 页面由真实 PostgreSQL seed/fixture 和对象存储媒体驱动，无硬编码正式偶像或礼物。
- 内容发布后 60 秒内前台可见，失败有状态和重试。
- `en/zh-CN/th/vi/ja/es/pt`、self-canonical/hreflang/x-default/locale sitemap、locale cache、图片裁切、空/错/暂停/售罄/fallback-noindex 状态完整。
- 运营达到 3/5/8 分钟更新目标。
- 七语言关键译文批准、缺失/过期为 0；语言切换保留同一实体、购物车、market、currency 和支付上下文。

## Phase 退出证据

已于 2026-09-05 依据用户明确视觉接受与继续开发指令解锁；尚未达到退出门禁。

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
