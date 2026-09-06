# Progress Master

> 最后更新：2026-09-06
> 当前里程碑：M3 可浏览 Beta（M1/M2 已完成）
> 当前 ACTIVE Phase：Phase 3
> 当前任务：无执行中任务；`P3-01` 全部检查点验收通过，已 DONE，Lane C 已释放
> 下一可领取任务：`P3-02`、`P3-03`、`P3-04`（READY）；优先 P3-02 自研管理后台

## 1. 开工入口

执行代理按顺序读取：

1. `docs/FAN_SUPPORT_PLATFORM_SPEC.md`
2. 本文件
3. 候选任务所在的 `ACTIVE` phase 文件（当前为 `docs/progress/phase-3-storefront.md`）
4. `docs/plan/task-breakdown.md` 中准备领取的 Task ID
5. `.agents/skills/fan-support-platform-dev/SKILL.md`

只领取位于 `ACTIVE` Phase、依赖已完成、状态为 `READY` 且对应 Lane 无 executor 的一个任务。2026-09-05 用户批准现有视觉作为开发基线并明确要求进入下一阶段；P2-06 DONE、Phase 2 CLOSED、Phase 3 ACTIVE；P3-01 经 READY 后由 Codex `/root` 领取并于2026-09-06完成全部本地运行时验收，现DONE、Lane C已释放；P3-02/03/04依赖完成并READY。正式品牌资产与译文的上线批准继续独立保留。

## 2. 总体状态

| 状态 | 数量 |
|:--|--:|
| PENDING | 28 |
| READY | 3 |
| IN_PROGRESS | 0 |
| BLOCKED | 0 |
| REVIEW | 0 |
| DONE | 18 |
| DEFERRED | 0 |
| **总计** | **49** |

## 3. Phase 索引

| Phase | 任务 | 状态 | 进度文件 | 退出门禁 |
|:--|--:|:--|:--|:--|
| 0 基线与骨架 | 5 | CLOSED | `phase-0-baseline.md` | CI、四应用骨架、preview、trace、生产基础设施选型 |
| 1 合同与领域 | 6 | CLOSED | `phase-1-contracts.md` | domain/catalog/pricing/inventory/migration/webhook |
| 2 设计系统 | 6 | CLOSED | `phase-2-design-system.md` | 品牌样板、视觉、axe、设备性能 |
| 3 自研 Admin、内容与浏览前台 | 6 | ACTIVE | `phase-3-storefront.md` | 七语言自研后台、真实内容、发布、SEO/cache、性能 |
| 4 购买闭环 | 6 | LOCKED | `phase-4-commerce.md` | 七语言测试支付、订单 locale、查单、通知 |
| 5 运营与支付 | 8 | LOCKED | `phase-5-operations-payments.md` | RBAC、退款、配置回退、重放、production-like staging |
| 6 加固与恢复 | 6 | LOCKED | `phase-6-hardening.md` | Release Gate 技术证据 |
| 7 上线与灰度 | 6 | LOCKED | `phase-7-launch.md` | 正式签署、灰度、复盘 |

`LOCKED` 表示尚未满足 Phase 依赖，不代表需求未定义。Phase 状态是硬门禁：即使任务级依赖已完成，`LOCKED` phase 中的任务也不得领取。

### Phase 解锁矩阵

| 已通过的退出门禁 | 改为 ACTIVE | 同时必须关闭 |
|:--|:--|:--|
| 初始状态 | Phase 0 | — |
| Phase 0 | Phase 1、Phase 2 | Phase 0 |
| Phase 1 与 Phase 2 | Phase 3 | Phase 1、Phase 2 |
| Phase 3 | Phase 4 | Phase 3 |
| Phase 4 | Phase 5 | Phase 4 |
| Phase 5 | Phase 6 | Phase 5 |
| Phase 6 | Phase 7 | Phase 6 |

除 Phase 1 与 Phase 2 外，不允许两个 Phase 同时为 `ACTIVE`。协调者还必须执行“每个 Lane 同时最多一个 executor”的并行门禁。

## 4. 决策状态

| 决策 | 状态 | 最晚门禁 | 记录 |
|:--|:--|:--|:--|
| 开发视觉基线 | ACCEPTED | Phase 2 已关闭 | ADR-008；2026-09-05 用户批准 V2 作为后续开发基础 |
| 正式品牌名/Logo/字体采用/摄影授权 | OPEN | 正式资产导入前且不晚于 P7-01/P7-02 | ADR-008/009；不阻塞内部 Phase 3 开发 |
| 生产区域/容器平台/PostgreSQL/对象存储/CDN/WAF | ACCEPTED | Phase 0 已关闭 | ADR-007：`us-east-1` AWS 单云 origin；Akamai 为未来 edge 候选 |
| 经营主体/KYC/收款账户 | OPEN | Phase 4 真实支付 | 待建运营决策 |
| 管理员 OIDC/MFA/账号恢复 | OPEN | Phase 5 UAT | 待建 ADR |
| 英文主语言与首发 locale：`en/zh-CN/th/vi/ja/es/pt` | ACCEPTED | 已冻结，Phase 0/1 起执行 | ADR-006 |
| 首发国家/币种/支付方式 | OPEN | Phase 3 路由冻结 | 待建 ADR |
| 礼物法律属性/税务/退款政策 | OPEN | Phase 4 UAT | 待建法律/运营决策 |
| 履约 SLA/客服承诺 | OPEN | Phase 3 内容冻结 | 待建运营决策 |
| 邮件、观测、备份供应商 | OPEN | Phase 4/6 | 待建 ADR |

这些 OPEN 项不阻塞当前 Phase 3 的内部开发，但执行者不得自行把 sandbox 假设写成生产结论。

## 5. 最新证据

2026-09-06 P3-01完整内容运行时已验收为DONE：4C-2接通五类七语言validate/publish/rollback、不可变manifest/实际数据库证明、公开扩展DTO与受审别名搜索，以及七语言持久purge/status/授权新代重试。新32 roots、旧279不变、共311；18迁移/141表、真实PG441断言、全仓内HTTP10,464断言/1,335请求、媒体worker/TLS S3联合423断言、完整check与双端七语言浏览器回归全部通过。真实默认worker调度通过本地HTTP缓存≤60秒门禁；三路非作者复核ACCEPT，S.U.P.E.R十项PASS，1018个源码输入最终指纹一致。证据及运行手册见 `output/checks/p3-01-publication-runtime/README.md`、`task-exit-review.md` 与 `docs/operations/content-publication.md`。Phase 3仍ACTIVE（1/6），全局18 DONE / 3 READY / 28 PENDING，总49；Lane C释放，P3-02/03/04 READY，优先P3-02管理后台。后台与真实前台业务页、正式登录/素材、实际云CDN、PSP/staging/生产发布依后续任务验证；没有新增真机或远端CI证据。按用户决定只做本地检查点提交，最后统一推送，本轮未push。

2026-09-06 P3-01 的 4C-1 发布前检查已验证：五类七语言、独立基础/扩展审核、精确复制继承、全部媒体来源当前版权、目录资格、真实历史publication和微秒时间，从同一数据库事务当前授权后读取。新增1个私有POST/5个versioned roots，旧274不变、共279；1237 tests、166 PG、2595 HTTP断言/277请求、完整check及双端七语言浏览器回归通过。三路非作者复核ACCEPT，S.U.P.E.R十项PASS，948个输入指纹匹配。证据与复跑入口见 `output/checks/p3-01-publication-preflight/README.md`。检查不写生命周期/head/publication/outbox，0013封锁保留；P3-01仍IN_PROGRESS，总49项仍17 DONE/1 IN_PROGRESS/31 PENDING。下一项为4C-2在实际发布事务重跑门禁，接发布/回退、公开扩展DTO、manifest/别名投影与七语言purge。没有新增管理业务UI、正式登录、真机、云/PSP/staging/远端CI或发布结论；按用户要求本地检查点提交，最终统一推送，本轮未push。

2026-09-06 P3-01 的 4B 媒体与政策管理已验证：10个私有管理POST，政策owner首次注册与七语言内容审核、私有图片签名上传/完整解码登记、版权连续事件、任务查询/入队/保留历史的新代重试；0017四张专属表，旧246合同不变、共274。1197 tests、资源PG129、HTTP/S3/Chrome/worker1798断言（159请求）、17迁移/136表、最终完整check与既有双端七语言浏览器回归通过。旧3A一次授权间歇失败未自然复现，保留诊断并以真实PG受控时钟边界加固fixture（112断言），未改生产权限/TTL；两处类型/lint修正通过105任务预检与再次全仓check。三路非作者复核及追加修正复核ACCEPT，S.U.P.E.R 10项PASS；913个输入最终指纹匹配。证据与复跑入口见 `output/checks/p3-01-resource-management/README.md`。P3-01仍IN_PROGRESS、49项仍17 DONE/1 IN_PROGRESS/31 PENDING；下一项是运行时计划4C完整验证/发布/回退/公开扩展DTO/manifest/head/别名投影/七语言outbox/purge。后台业务UI、无引用对象清理、正式登录/素材、云/PSP/staging/远端CI与发布仍不在本轮结论内。Git按用户选择在 `codex/p3-01-content-runtime` 保留本地检查点提交，最终统一推送，当前未push。

2026-09-06 P3-01 的 4A 基础审核与受控预览已验证：五类基础内容七语言 read/submit/approve 与精确 owner/revision/locale preview，当前权限/源 hash/独立作者/幂等/审计同事务；0016 两张专属表，旧 233 合同不变。960 tests、910 PG/3847 HTTP 断言（388 请求）、16 迁移/132 表、最终完整 check 与双端七语言浏览器回归通过。真实会话上限微秒精度与旧 3A 短预览 fixture 已 RED→GREEN，未放宽 TTL/约束；三路非作者复核 ACCEPT、S.U.P.E.R 10 项 PASS。证据见 `output/checks/p3-01-base-content/README.md`，863 个工作区源码输入最终指纹未变。下一入口为运行时计划“4A 后续必需工作”：完整验证、政策 owner 初始化、媒体管理 API，随后发布/回退/公开扩展 DTO/manifest/head/名字别名投影/outbox/purge/≤60 秒可见性。P3-01 仍 IN_PROGRESS，49 项仍 17 DONE、1 IN_PROGRESS、31 PENDING；没有新增后台业务 UI、真机、正式登录、云/PSP/staging/远端 CI 或发布结论。

2026-09-06 P3-01 的 3B 基础内容作者流程已验证：五类内容 read/create/copy、局部译文编辑、精确批准继承与 STALE lineage、当前权限/并发/幂等/审计同事务；0015 作者收据封口内容与复制来源，旧 225 合同不变。886 tests、211 作者 PG/909 HTTP 断言（114 请求）、15 迁移/130 表、最终完整 check 与双端七语言浏览器回归通过。补验修正目录迁移回退顺序、媒体完成时间回拨（152 PG）及会话到期测试（109 PG）；独立复核 ACCEPT，S.U.P.E.R 10 项 PASS。证据见 `output/checks/p3-01-authoring/README.md`，837 个工作区源码输入最终指纹未变。下一入口为运行时计划检查点 4：基础审核/五类 preview、政策 owner 初始化、媒体管理 API、完整发布/回退/公开扩展 DTO/outbox/purge；艺人/商品管理任务包含所需 API。P3-01 继续 IN_PROGRESS，49 任务仍为 17 DONE、1 IN_PROGRESS、31 PENDING；无新增真机、生产登录、后台 UI、云/PSP/staging/远端 CI 或发布结论。

2026-09-06 P3-01 的 3A 内容授权/审核/只读预览已验证：8 个管理 POST 与 1 个 preview POST，session/MFA/RBAC/语言权限与内容/审核/审计/幂等同事务；单语言审稿返回目标译文与实际英语源稿，预览可撤销且最长 15 分钟。688 tests、108 PG/434 HTTP 断言（68 请求）、14 迁移/124 表、完整 check 与 P2-04/05 浏览器回归通过；新增 19 个 roots，旧 206 定义不变。全仓首次 503 已通过真实数据库探针定位墙钟回拨并修复；固定回拨/微秒精度与 100 组七语言/1800 次连续操作通过，独立复核 ACCEPT。证据见 `output/checks/p3-01-admin-content/README.md`。下一入口为运行时计划 3B：基础内容创建/复制，再接发布/回退/outbox/purge；P3-01 继续 IN_PROGRESS，49 任务仍为 17 DONE、1 IN_PROGRESS、31 PENDING。TEST 组合不代表生产登录或后台 UI 已开放，无新真机、远端 CI、PSP、云或发布结论。

2026-09-06 P3-01 的 2B 内容存储已验证：0013 新增 10 张专属表，艺人别名与礼物固定结构/七语言译文由真实 PostgreSQL 保存；初始 DRAFT 审核和精确审计原子提交，新扩展暂时拒绝验证/发布/回退。公开目录已支持跨七语言姓名搜索，返回文案保持请求 locale。658 tests、103 SQL/62 repository/307 目录 PG/264 HTTP 断言、13 迁移/122 表、完整 check 与 P2-04/05 浏览器回归通过；198 个旧合同不变。最大 32×24×7 内容保存本机复验 2280 ms、COMMIT 5 ms。证据见 `output/checks/p3-01-content-storage/README.md`。一次既有媒体恢复测试间歇失败未复现到明确源码缺陷，已保留诊断，独立及最终全仓 423 联合断言通过。P3-01 继续 IN_PROGRESS，下一入口是检查点 3 的授权/内容命令/只读 preview；49 任务计数仍为 17 DONE、1 IN_PROGRESS、31 PENDING，无新真机、远端 CI 或发布结论。

2026-09-05 P3-01 的 2B 媒体子检查点已验证：真实图片解码/EXIF 清理/角色 master/12 个响应式产物、PostgreSQL 持久任务与 worker、原图和主图独立去重（ADR-010）。783 tests、136 条媒体 PG 断言、423 条真实 PG + TLS S3 联合断言、12 迁移/112 表、完整 check 与既有七语言浏览器回归通过；184 个旧合同定义不变。证据见 `output/checks/p3-01-media/README.md`。P3-01 仍 IN_PROGRESS，下一入口为实施计划 2B-内容存储（艺人别名、礼物详情/专属七语言译文），再接授权/preview/审核/发布/回退/purge；不提前解锁前台页面任务，无新的真机、云或生产发布结论。

2026-09-05 P3-01 检查点 2A 已验证：真实 PostgreSQL → Application → Nest/Fastify 公开目录，艺人名字/handle 搜索、远端定位与 cursor 连续翻页，礼物分页/筛选/可售规格最低价排序，七语言强发布投影。120 位艺人与 120 件礼物通过 287 条数据库断言和 193 条真实 HTTP 断言；受影响 631 tests、完整 check、11 迁移/109 表、既有 PG/S3 与 P2-04/05 浏览器回归通过。证据见 `output/checks/p3-01-directory/README.md`。P3-01 继续 IN_PROGRESS，下一入口为 `docs/plan/p3-01-content-runtime.md` 检查点 2B；图片处理、别名/详情写入、管理授权/preview、事务发布/回退/purge 尚未完成，前台业务页接入仍待 P3-04/05。49 项任务计数不变，无新远端 CI、真机或发布结论。

2026-09-05 用户确认现有视觉风格并授权开始下一阶段；追加艺人连续浏览/名字搜索/混合比例照片、礼物分页/筛选排序及多语言自由编辑需求，纳入规范 2.2.0、ADR-009 和 P3-01 至 P3-06。首个合同与纯规则检查点的历史验证：16 新合同、155 旧定义不变、268 tests、完整 check、本地 PG/S3 及 P2-04/05 浏览器刷新通过，见 `output/checks/p3-01-foundation/README.md`。以下历史 REVIEW/LOCKED 记录仅描述当时状态，以最新证据和上方状态表为准。

2026-09-05 P2-06 V2 已按用户反馈改为原色黑金画廊：新内部首页式样板、七张原创多色素材、七语言、艺人/礼物/详情/演示礼袋操作；24/24 cases、86 PNG、26 axe serious/critical0，22条内部说明region moderate记录保留。冷载图像恢复、语义断行与桌面完整详情图已修；Storefront119/UI94/helper11tests、P2-02/04/05浏览器刷新及最终全仓check通过。当前评审入口 `output/playwright/p2-06-brand/README.md`，源码fingerprint `aeaea1e5dec8ddafd21124eebbc3473ec608363628e83a2b7824f622a4585747`；旧手机证据明确为历史版本。P2-06 REVIEW，不代用户批准，Phase3仍LOCKED。

2026-09-05 P2-06 已提交人工评审：`output/playwright/p2-06/index.html` 提供七语言、390×844/1440×900 的28 cases/58 PNG；28份axe critical/serious为0（14个motion页heading-order moderate保留），图片/字体/布局/键盘及独立视觉复核通过。修正内部motion标签的CJK/Thai字距后已重建并刷新P2-05桌面证据；113tests、完整pnpm check及本地PG/S3集成通过，本轮保留并如实统计Turbo缓存。ADR-008为Proposed，人工批准与正式品牌资产仍OPEN，Phase3不解锁。详见新评审包README与phase执行卡。

2026-09-05 P2-05 真机续作完成：物理 iPhone 16 Pro Max / iOS26.5.2 / Safari，440×796 CSS px、DPR3、zh-CN；普通与真实系统 reduced-motion 各8动作/40状态样本通过，并记录24个可信输入事件、图片/面板关联与实际加购/重置。两份完整录屏已解码和hash，独立终审ACCEPT。证据与复核边界见 `output/playwright/p2-05-device/README.md` / `device-results.json`；原桌面证据保持physicalDeviceEvidence=false。普通/减弱脚本序列与用户原生触摸分别记录；早期未hydration的静态页面诊断已明确排除，不宣称固定60渲染fps或field INP。

本轮全量0-cache check exit0：typecheck/test各51个Turbo tasks、build34个，真实本地PostgreSQL/S3-compatible集成、format/lint/合同/架构检查通过；设备/motion/browser-runner共58项回归通过。未修改业务UI、合同、数据库或部署；本轮不重跑fresh clone、远端CI、dependency audit或发布，历史结果仍以各phase原证据为准。

Phase0/1已CLOSED，Phase2中P2-01至P2-05均DONE；P2-06技术评审材料已完成并为REVIEW，等待人工视觉与正式品牌决定。Phase3保持LOCKED。按用户要求，AWS/Akamai、staging、production和运维继续暂缓。

| 日期 | Task | 类型 | 证据 | 结论 |
|:--|:--|:--|:--|:--|
| 2026-09-06 | P3-01 | 完整运行时退出 / 4C-2 | `output/checks/p3-01-publication-runtime/`；PG441、HTTP10,464/1,335请求、全仓check与浏览器回归 | DONE；Phase3仍ACTIVE，P3-02/03/04 READY，全局18 DONE / 3 READY / 28 PENDING |
| 2026-09-06 | P3-01 | 发布前检查4C-1 | `output/checks/p3-01-publication-preflight/`；1237 tests、166 PG/2595 HTTP、完整check与浏览器回归 | 4C-1通过；任务IN_PROGRESS，下一步4C-2真实发布/回退/purge |
| 2026-09-06 | P3-01 | 基础内容审核/preview 4A | `output/checks/p3-01-base-content/`；960 tests、910 PG/3847 HTTP、完整 check 与浏览器回归 | 4A 通过；任务 IN_PROGRESS，下一步媒体/政策管理与完整发布链路 |
| 2026-09-06 | P3-01 | 基础内容作者流程 3B | `output/checks/p3-01-authoring/`；886 tests、211 PG/909 HTTP、媒体回拨152 PG、完整 check 与浏览器回归 | 3B 通过；任务 IN_PROGRESS，下一步检查点 4 |
| 2026-09-06 | P3-01 | 扩展内容授权/审核/preview 3A | `output/checks/p3-01-admin-content/`；688 tests、108 PG/434 HTTP、时钟回拨回归、完整 check 与浏览器回归 | 3A 通过；任务 IN_PROGRESS，下一步 3B 基础内容创建/复制 |
| 2026-09-06 | P3-01 | 内容存储子检查点 2B | `output/checks/p3-01-content-storage/`；658 tests、103/62 内容 PG、307 PG/264 HTTP、完整 check 与浏览器回归 | 内容存储通过；任务 IN_PROGRESS，下一步授权/审核/preview/发布 |
| 2026-09-05 | P3-01 | 真实媒体处理子检查点 2B | `output/checks/p3-01-media/`；783 tests、136 PG/423 联合断言、完整 check 与浏览器回归 | 媒体子项通过；任务 IN_PROGRESS，当时下一步为别名/详情存储与受权内容发布 |
| 2026-09-05 | P3-01 | 真实目录读取检查点 2A | `output/checks/p3-01-directory/`；631 tests、287 PG/193 HTTP 断言、完整 check 与浏览器回归 | 检查点通过；任务 IN_PROGRESS，媒体/内容写入/发布链路待接 |
| 2026-09-05 | P2-06 | 原色黑金 V2 | `output/playwright/p2-06-brand/`、ADR-008；24 cases/86 PNG、完整check、独立复核 | REVIEW；当前可交互候选，待用户决定 |
| 2026-09-05 | P2-06 | 首版历史评审包 | `output/playwright/p2-06/`、ADR-008；28 cases/58 PNG、完整check、独立复核 | REVIEW；待人工视觉/品牌决定，Phase3 LOCKED |
| 2026-09-05 | P2-05 | 真机补验完成 | `output/playwright/p2-05-device/`；normal/reduce录屏、可信触摸、0-cache check、独立终审 | DONE；P2-06 READY，Phase3仍LOCKED |
| 2026-09-02 | SPEC | 规划 | `docs/FAN_SUPPORT_PLATFORM_SPEC.md`、ADR-004、ADR-005、ADR-006 | 2.1.0 已锁定全源码自研、七语言 URL/内容/订单/SEO、原子购物车/intent、支付与门禁 |
| 2026-09-02 | ARCH | 可视化 | `docs/fan-support-platform-architecture.drawio` | 已同步 Storefront/Admin/API/Worker、PostgreSQL 真相源与可替换外部 Port |
| 2026-09-02 | RESEARCH | 浏览器研究 | `research/` | 只作为参考站背景，不等于本项目实现 |
| 2026-09-02 | P0-01 | 实现/测试/验收 | Git `9234e368e193e967e9e2abd39858f4f3eaf01da9`、`package.json`、`pnpm-lock.yaml`、`apps/`、`packages/`、`scripts/check-*.mjs`、`phase-0-baseline.md` | 两次真实 clean clone、frozen install、完整 check、Git 对象与凭据复扫全绿；独立评审 ACCEPT，任务 DONE |
| 2026-09-03 | P0-02 | CI/安全门禁 | Git `88efe390c86c8b8e58b371fa196a9ae62c65de99`、[PR #1](https://github.com/CZ3700/diandan/pull/1)、[run 33661119143](https://github.com/CZ3700/diandan/actions/runs/33661119143)、`.github/workflows/ci.yml`、`scripts/check-ci.mjs`、`scripts/scan-secrets.mjs` | 本地/clean clone 与 11 组对抗 fixture 通过；真实 PR 的 Quality/Security 成功；`main` 严格必需两检查、管理员受约束、禁止强推/删除；GitHub secret scanning/push protection 已开启，任务 DONE |
| 2026-09-03 | P0-03 | 配置/安全边界 | Git `ba8b8864605e7181a85f2ffc13ca52087e0726e4`、`.env.example`、`packages/config/` | 四层优先级、按 fragment 最小读取、fail-closed、公开 allowlist 与脱敏错误完成；77 tests、42 条独立攻击、0-cached clean clone 全绿，三路复核 ACCEPT，任务 DONE |
| 2026-09-03 | P0-04 | 运行时/OCI/浏览器 | Git `d4008a9ce35432d609dbfa9639b16f68ef481ed4`、[PR #2](https://github.com/CZ3700/diandan/pull/2)、[run 33672018920](https://github.com/CZ3700/diandan/actions/runs/33672018920)、`infra/`、`output/playwright/p0-04/` | Next storefront/admin、Nest+Fastify API/worker、PostgreSQL、经临时 CA 的 S3-compatible TLS preview 与四独立 OCI image 完成；真实 build/7 healthy/SigV4/browser/clean clone/Quality/Security 全绿，三路复核 ACCEPT，任务 DONE |
| 2026-09-03 | P0-05 | 可观测/故障/运维 | Git `c337db999fc45f629b5bdfc7dbd9b766ff1c0c8d`、[PR #3](https://github.com/CZ3700/diandan/pull/3)、[run 33685203128](https://github.com/CZ3700/diandan/actions/runs/33685203128)、`packages/observability/`、`output/playwright/p0-05/` | canonical request ID、W3C trace、结构化 allowlist 日志、OTel lifecycle、安全错误边界与排障 README 完成；真实 preview、clean clone 0-cache、Quality/Security 与四路复核全绿，任务 DONE；无 cloud exporter/生产发布结论 |
| 2026-09-03 | INFRA | 决策/Phase 门禁 | ADR-007、AWS/Akamai 官方能力与价格资料、`P5-08` | 选择 `us-east-1` AWS 单云 origin（ECS Fargate/RDS PostgreSQL Multi-AZ/S3/CloudFront/WAF），保留 Akamai edge 退出路径；Phase 0 CLOSED，Phase 1/2 ACTIVE；尚无 cloud apply 或恢复证据 |
| 2026-09-03 | P1-01 | v1 跨模块合同 | Git `4695a4121131f664d5b70ce9b77f21dc50bf25cf`、[PR #4](https://github.com/CZ3700/diandan/pull/4)、[run 33693878714](https://github.com/CZ3700/diandan/actions/runs/33693878714)、`packages/contracts/` | 34 个 versioned/embedded-policy 合同、JSON Schema/OpenAPI components、七语言唯一 owner、隐私/金额/早到 webhook/兼容门禁完成；clean clone 0-cache、Quality/Security 与三路复核全绿，任务 DONE；API paths 与 provider authenticity 留给对应后续任务 |
| 2026-09-03 | P1-02 | 内容/发布合同 | Git `6daea6928a69d59e999f3916c02b5e27583e2e17`、[PR #5](https://github.com/CZ3700/diandan/pull/5)、[run 33707017702](https://github.com/CZ3700/diandan/actions/runs/33707017702)、`packages/content/`、`packages/contracts/src/content.ts` | 自研内容/商品/价格/库存/媒体/政策模型、精确七语言审核与发布门、双 hero、严格公开投影和虚构 fixtures 完成；clean clone 0-cache、Quality/Security 与两路复核全绿，任务 DONE；DB/repository/真实存储与云发布不在本任务证据范围 |
| 2026-09-03 | P1-03 | 纯领域规则 | Git `49a8756852f3083a04184a1334743622ff423636`、[PR #6](https://github.com/CZ3700/diandan/pull/6)、[run 33720394020](https://github.com/CZ3700/diandan/actions/runs/33720394020)、`packages/domain/`、`packages/contracts/src/domain-rules.ts` | 32 个 internal/versioned contract roots、17 个纯 domain 入口、160 项领域测试与 96.16% branch coverage；本地/clean clone 0-cache、secret/audit、Quality/Security 与三路复核全绿，任务 DONE；数据库并发与真实 PSP/云发布证据不在本任务范围 |
| 2026-09-03 | P1-04 | PostgreSQL schema/migrations | Git `827ada4d2e7f821307c761addec65864aedf1a74`、[PR #7](https://github.com/CZ3700/diandan/pull/7)、[run 33739482625](https://github.com/CZ3700/diandan/actions/runs/33739482625)、`database/`、`packages/persistence-postgres/` | 6 个迁移/108 表、空库与带数据 up/down/up、并发/authority/隐私/webhook/append-only 对抗约束完成；clean clone 0-cache、secret/audit、Quality/Security 与两路独立终验全绿，任务 DONE；repository、真实 KMS/PSP/AWS/staging/PITR/production 不在本任务证据范围 |
| 2026-09-04 | P1-05 | Ports/repositories/adapters | Git `233d11b922df485f4e448ad71cf11612a9a1f77d`、[PR #8](https://github.com/CZ3700/diandan/pull/8)、[run 33785418111](https://github.com/CZ3700/diandan/actions/runs/33785418111)、`packages/*-port/`、`packages/persistence-postgres/`、`packages/media-s3/` | 七类 versioned port/conformance、事务/repository、真实 PG18 与 TLS S3-compatible 集成、CloudFront/KMS/TEST-only fake 完成；fresh clean clone、secret/audit、Quality/Security 与独立终审全绿，任务 DONE；真实供应商/AWS apply/staging/production 与 webhook worker 不在本任务范围 |
| 2026-09-04 | P1-06 | Webhook/inbox/outbox/worker | Git `02ee10846a3b960e6f0d7bceb0b2d269f972a0aa`、[PR #9](https://github.com/CZ3700/diandan/pull/9)、[run 33808236380](https://github.com/CZ3700/diandan/actions/runs/33808236380)、`packages/contracts/`、`packages/application/`、`packages/persistence-postgres/`、`apps/api/`、`apps/worker/` | raw-body 先验签、加密 durable receipt、inbox/outbox、pg-boss 6-attempt/DLQ、queue trace 恢复及真实 PG 原子并发/回滚完成；fresh clean clone、secret/audit、Quality/Security 与独立终审全绿，任务 DONE、Phase 1 CLOSED；真实 PSP/KMS、业务状态推进、AWS/staging/production 不在本任务范围 |
| 2026-09-04 | P2-01 | Design tokens/fonts/theme/grid | Git `f578208fc05822426bc3d83e362f35ebe29460ee`、[PR #10](https://github.com/CZ3700/diandan/pull/10)、[run 33821542072](https://github.com/CZ3700/diandan/actions/runs/33821542072)、`packages/design-tokens/`、`output/playwright/p2-01/` | schemaVersion 1 tokens/CSS、五类 locale 字体分包/OFL、对比安全 accent、preview-only specimen 与 21 项静态门禁完成；六视口/320/真实 Chrome 200% zoom/键盘/reduce、fresh clean clone、secret/audit、Quality/Security 与独立终验全绿，任务 DONE；正式品牌、axe/读屏、全脚本全条件与真实设备性能仍属后续门禁 |
| 2026-09-04 | P2-02 | UI primitives/accessibility | Git `9f33dad482798a58e108d0c8c0495a878cf375c7` + evidence `d40a79bd3fb93a884ffd8613c58f84902ae6ca41`、[PR #11](https://github.com/CZ3700/diandan/pull/11)、[run 33835758064](https://github.com/CZ3700/diandan/actions/runs/33835758064)、`packages/ui/`、`output/playwright/p2-02/` | 八类原语、server/client/CSS 边界、BigInt 金额、真实 Media fallback、键盘/RTL/reduce/48px/对比门禁完成；13 场景、6 axe、3 环境 gate、15/15 图片、真实 Chrome 200% zoom、fresh clean clone、high audit/secret、Quality/Security 与独立终验全绿，任务 DONE；无公开业务路由、overlay/composite、支付、staging/production 或正式品牌批准结论 |
| 2026-09-04 | P2-03 | Overlay/locale controls | Git `0f86e6c16e9f44bd3c9096e2d8d02a9a3e7aa1b8` + evidence `ef6e16a0870b5e230b796f9905649398bfce0859` + CI stabilization `f6e19c948e124436ec423e3607c889f7254b1c24`、[PR #12](https://github.com/CZ3700/diandan/pull/12)、[run 33874955057](https://github.com/CZ3700/diandan/actions/runs/33874955057)、`packages/ui/`、`apps/storefront/`、`output/playwright/p2-03/` | Dialog/Drawer/Menu/Toast/live region、独立 Language/Region、locale URL/cookie adapter 与 fail-closed 生命周期门禁完成；冷 CI 动态导入 flake 已以静态导入根因修复，未放宽 timeout；13/13 场景、8 axe 原始结果、15/15 图片、原生 Chrome 200% zoom、本地/fresh clone/secret/high audit/两路独立终审及真实 Quality/Security 全绿，任务 DONE；未宣称真实 staging/production、AWS apply、正式品牌或真实设备性能 |
| 2026-09-04 | P2-04 | Composite components | 本地实现、`packages/ui/`、`apps/storefront/`、`output/playwright/p2-04/`，当前 fingerprint `7baa48a87bd2c7045875d14f294b1da6b859555ea1f10267ceea3968a6e13e46` | 六组合组件与精确 server/client/CSS 边界完成；字体策略调整后 16/16 场景、10 axe、18/18 图片及原生 200% zoom 已重新通过，任务保持 DONE；未宣称真实设备、正式品牌、cloud/staging/production 或发布证据 |
| 2026-09-05 | P2-05 | Signature motion | Git `36c55fb89a572ffc24ab91605540752c9ee1fd63`、`packages/ui/src/motion*.tsx`、`packages/ui/styles/motion.css`、`apps/storefront/src/app/ui-motion-*`、`output/playwright/p2-05/`，fingerprint `3579e97760b599fdd3ed5f412e0142672db1d292b7cdfaf81f0ddd4b4b63f5cd` | Hero/偶像切换/加购/成功与 reduced-motion 完成；UI 94、Storefront 113、runner 40、checker 12 tests，8/8 场景、22/22 PNG、3 axe、242 个 optional font face、零 CLS，当前与 fresh-clone 全量 check、secret/high audit 及独立终审全绿；无物理手机可用，真机录屏/帧率未取得，任务 `REVIEW`、P2-06/Phase 3 继续等待；部署/运维按用户要求暂缓 |

## 6. 更新规则

- 开始任务：在 phase 文件填写 owner、开始时间和计划验证，把状态改为 `IN_PROGRESS`。
- 请求评审：列出所有变更、命令与证据路径，状态改为 `REVIEW`。
- 完成任务：验收通过后改为 `DONE`；只把位于 `ACTIVE` phase、全部依赖已完成且 Lane 空闲的直接依赖改为 `READY`，并同步本文件计数。
- 阻塞任务：写明阻断事实、已尝试内容、唯一解除条件和责任人；不得只写“等待”。
- Phase 完成：附退出门禁证据，按上面的解锁矩阵关闭已完成 Phase 并激活唯一允许的后继 Phase 集合；不得仅凭任务级依赖提前激活。
- 任何计数更新都必须保证状态合计仍为 49。
