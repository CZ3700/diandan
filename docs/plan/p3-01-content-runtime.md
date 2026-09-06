# P3-01 内容运行时实施计划

> Task：P3-01 / Lane C；Owner：Codex `/root`；2026-09-05
> 执行方式：合同先冻结，独立文件子模块并行，再顺序集成与复核；用户已授权进入下一阶段，无新的视觉审批等待。

**Goal:** 从现有内容领域与数据库约束接通真实内容发布和可扩展目录，支持艺人发现、混合比例媒体、礼物分页和七语言详情。

**Architecture:** Route → Application → Content/Catalog → Persistence/Media/Identity/Cache Ports → PostgreSQL/S3/CDN adapters。PostgreSQL 是唯一真相源；查询索引与缓存只做投影。

**Tech stack:** 当前锁定 TypeScript/Zod/Next/Nest/Fastify/PostgreSQL/pg-boss；不新增 SaaS、Redis 或第二动效框架。

## 检查点 1：兼容合同与可测试规则

- [x] 新建 `packages/contracts/src/catalog-discovery.ts` 及测试：严格 locale、cursor/anchor 输入、查询长度/页码边界、价格区间/币种上下文与分页元信息；完整目录响应和 cursor 编码/版本校验在检查点 2 接入真实 repository 时完成。
- [x] 新建 `packages/catalog/src/discovery.ts` 及测试：canonical 查询/翻页状态、搜索规范化、查询计划与稳定排序、缓存分区；不伪装数组 fixture 为数据库目录。
- [x] 新建 contracts/content 的 `media-framing.ts` 与测试：明确角色 master、横竖/焦点/CONTAIN、整数几何、不放大及结构化失败；保留现有发布门。
- [x] 新建 contracts/content 的 `gift-details.ts` 与测试：稳定块/条目、显式本地化结构、受控纯文本、hash/review 绑定、未知/缺失/重复结构拒绝；保留旧 description 解码。
- [x] 更新 exports/artifact registry，生成并校验 JSON Schema/OpenAPI components；这些 components 不代表 HTTP operations 已可调用。
- [x] 先记录 RED，再跑受影响 tests/typecheck；独立检查规范一致性与代码质量；最终 268 tests、完整 check 和必要浏览器刷新通过，证据见 `output/checks/p3-01-foundation/`。此检查点完成时 P3-01 仍 IN_PROGRESS。

## 检查点 2：真实持久化与媒体处理

### 2A：公开目录读取（2026-09-05 已验证）

- [x] `persistence-port` 独立内容读取事务边界；`persistence-postgres` 参数化公开目录 SQL、当前窗口 revision/七语言终审/媒体证据 loader 与 SERIALIZABLE 快照；published 响应 DTO、目录版本及绑定查询的 canonical cursor。
- [x] 0010 可重建名字搜索投影与维护命令；0011 修复旧价格发布 generated-column BEFORE trigger 比较，保留原始金额/时间等字段不可变。
- [x] Application 与 `GET /api/v1/idols`、`GET /api/v1/gifts` 的真实 Nest/Fastify 路由、配置组合与关闭；OpenAPI 参数/错误码与实现一致，响应 no-store。
- [x] 120 艺人/120 礼物/七语言真实 PostgreSQL 与 loopback HTTP；287 PG/193 HTTP 断言、631 tests、完整 check、11 迁移/109 表及既有 S3/浏览器回归通过，独立复核 ACCEPT。证据见 `output/checks/p3-01-directory/`；此项不包含图片字节加工或内容写入发布。

### 2B：媒体加工与内容存储（分两次验收）

- [x] 2B-媒体（2026-09-05 已验证）：定义独立图片处理合同、事务/repository、真实图片 adapter 与生产 worker；源码见 `media-processing` 各层与 `packages/media-image`，最终验收记录见 phase 文件。
- [x] 2B-内容存储（2026-09-06 已验证）：0013 的艺人 revision 别名、新礼物固定结构文档/专属译文、独立初始审核及审计，保留 v1 不可变与 FK 边界；额外修正七语言姓名检索。658 tests、103 SQL/62 repository/307 目录 PG/264 HTTP 断言、最大 5376 译文条目保存约 2.3 秒、13 迁移/122 表、完整 check 与浏览器回归通过。证据见 `output/checks/p3-01-content-storage/README.md`；preview grants/purge 随检查点 3/4 接入。
- [x] 媒体 worker 解码/校正 EXIF、剥离 GPS、执行合格 master 与响应式编码，绑定 checksum/recipe，失败重试；产物 READY 不授予版权或 metadata 批准，旧公开发布资格保持。
- [x] 空库与旧数据 up/down/up、已有加工历史降级保护；真实 PostgreSQL 136 / TLS S3 联合 423 断言、783 tests、12 迁移/112 表及完整 check；横/竖/方/过小/假 MIME/EXIF fixtures，旧发布及订单媒体快照不变。见 `output/checks/p3-01-media/`；下一入口是上方 2B-内容存储。

媒体实现边界：原图须由可信解码登记，不能直接采信浏览器声称的 MIME/尺寸。原图 `SOURCE` 与角色 `PROCESSED_MASTER` 分别按 checksum 去重（ADR-010）；新主图版权 PENDING，需独立 metadata 与七语言审核。人工重试必须创建有审计关联的新任务，不能重置终止历史；未引用半成品对象回收须避免删除共享文件。未来发布要检查原图版权撤销的 lineage 和桌面/手机 Hero 的独立原始来源。

内容存储实现边界：0013 使用 10 张有明确归属的表，固定结构和译文文本分别持久化；新建文档必须含真实英语行，可携带 1 至 7 个 locale，全部从 DRAFT 开始。完整编辑流程复制新 revision/document，禁止覆盖已保存的结构、别名或译文。别名是可选专有名称集合，locale 可为空表示通用名称，独立审核整集，不能借用旧姓名译文审核。稳定 ID 重复创建会拒绝，request ID 冲突回滚，不代表已提供完整幂等结果重放。

含新扩展的 revision 暂时不能 VALIDATED/PUBLISHED，也不能插入 PUBLISH/ROLLBACK publication；旧无扩展 v1 路径保持。解除此门之前必须接通结构编辑者、独立审核人、完整七语言及媒体权限/原图 lineage 的证据校验；任何结构化详情缺译或失效不得静默回退旧 description。公开页面应另加版本化包裹 DTO，保持旧 PublishedGiftView v1 定义不变。

## 检查点 3：身份、内容命令与只读预览

### 3A：扩展内容授权、审核与预览（2026-09-06 已验证）

- [x] 现有 DRAFT 父 revision 的艺人别名/礼物详情创建、读取、提交和独立审核；服务端加载 canonical 候选与时间，序列/hash/source lineage 不匹配拒绝。结构作者和译文作者均不能批准自己的内容。
- [x] Mutation 的同事务幂等安全结果引用重放与 reason 审计；失败回滚草稿、审核、审计及幂等占位，原请求可安全重试。重放前仍复验当前授权。
- [x] PostgreSQL session/MFA/RBAC/语言权限、Origin/CSRF；授权锁与内容操作共用 SERIALIZABLE 事务。七语言详情按实际译文独立授权，单语言审稿接口返回选定译文和真实英语源稿。
- [x] 256-bit preview 凭证按用途与 pepper 摘要保存，最长 15 分钟且不超过签发会话有效期，绑定对象/revision/locale；读取重验签发人会话/MFA/权限/语言，支持撤销。原始 token 仅签发一次，不进入 URL/日志/共享缓存。
- [x] 8 个管理 POST 与 1 个 preview POST、同源生成的 OpenAPI，统一 private,no-store/noindex/no-referrer。显式 TEST 组合接真实数据库，生产登录发行与 OIDC 接线保持关闭。
- [x] 真正 PostgreSQL + HTTP：越权/CSRF/失效身份、self-review/stale/并发审核、幂等冲突与重放、预览范围/到期/撤销、注入故障后全量回滚及同 key 重试。最终命令与范围以 `output/checks/p3-01-admin-content/README.md` 为准。
- [x] 时钟回拨：审核事件在数据库锁定历史上取因果时间下限；权限判断不假设墙钟单调，预览 TTL 仍受当前墙钟与会话上限限制。真实回拨定位、固定 SQL 时钟注入、微秒精度、100 组七语言/1800 次连续操作均已覆盖；3B/4 作者与发布命令沿用这一时间策略。

### 3B：基础内容作者流程（2026-09-06 已验证）

- [x] 五类基础内容 revision 的创建/读取/复制与局部译文编辑，3 个管理 POST/OpenAPI，复用平台身份/语言权限/事务/审计/幂等边界。886 tests、211 PG/909 HTTP 断言、15 迁移/130 表、最终完整 check 与七语言浏览器回归通过；225 旧合同不变。证据见 `output/checks/p3-01-authoring/README.md`。
- [x] 新版本保留不可变历史；精确未变且当前有效的已批准基础译文使用专属 FK 继承原始编辑/审核链，其余进入 DRAFT，英语变化保留未编辑语言的旧来源 hash。别名/详情新 ID、当前作者与 DRAFT，禁止借用旧 description/结构/别名审批。并发/回滚/重放撤权、NFC 原文修改、微秒因果时间和审计路径均已验证。

3A 的授权/预览仅覆盖别名和受控礼物详情，不代表完整首页/艺人/商品/媒体/价格/库存管理已可操作。预览输出为受限内容数据，页面排版和双端预览由 P3-02/03 接入；P5-01 在同一权限体系上扩展正式运营身份 UAT。validate/publish/rollback 的 Application 用例与并发发布、回退不改历史证据统一在检查点 4 完成。

## 检查点 4：发布 outbox 与可见性

### 4A：基础审核与受控预览（2026-09-06 本地验收通过）

- [x] 五类基础译文按语言 READ/SUBMIT/APPROVE，保留实际英语源及旧 translated-from hash；STALE 可查看但不可提交/批准。新批准阻止译文与结构作者自审，原样继承的历史审批保留。
- [x] 五类对象/revision/locale 绑定的短时、可撤销只读 preview；签发者当前会话/权限/MFA、会话上限/15 分钟、私有响应与无 fallback。预览为结构化数据与显式关联引用，不授予关联草稿或存储对象访问权，页面与图片解析仍由后续管理 UI/媒体 API 接入。
- [x] 新审核写入只接不可变作者收据所属 revision；历史内容可读，修改和重新送审先 COPY。专属审核收据与数据库约束保护当前英语/作者/因果时间，精确 COPY 审核继承须由 0015 FK 证明。
- [x] 真实 PostgreSQL/HTTP 七语言、并发/回滚/幂等撤权、preview 隔离/到期/撤销；全仓 check、共享输入浏览器回归、独立复核和 S.U.P.E.R。4A 通过不等于 P3-01 退出。

证据：`output/checks/p3-01-base-content/README.md`；960 tests、910 PG/3847 HTTP 断言（388 请求）、最终全仓 check 与双端七语言浏览器回归通过；完整 P3-01 仍 IN_PROGRESS。

### 4B：媒体与政策管理（2026-09-06 本地验收通过）

- [x] 政策稳定 owner READ/REGISTER 和首次七语言 authoring/review；0017 专属授权/审计收据。
- [x] 私有原图预约/签名上传/实际完整解码登记，当前会话与资源权限、会话上限、事务外网络和登记再授权；按已验证 SOURCE checksum 去重且不覆盖旧证据。
- [x] 媒体/任务受权读取、append-only 版权事件、普通 enqueue 与失败任务新 generation 有审计重试；历史和六次自动尝试/lease fence 保留。
- [x] 来源版权进入 processed master 的真实数据库资格；公开 loader 对每行必须取得明确 true 证明。版权、metadata/译文审核、处理成功与公开发布仍独立。
- [x] 最终全仓 check、S.U.P.E.R、源码指纹与本地检查点归档；专项证据见 `output/checks/p3-01-resource-management/README.md`，详细计划见 `docs/plan/p3-01-resource-management.md`。

### 4C 后续必需工作

- [ ] 完整 revision 验证：结合基础审核、别名/详情独立证据、七语言完整度和媒体资格，阻止新版本作者自审新稿或借用不相关审核；双端页面排版继续由 P3-02/03 实现。
艺人稳定身份与商品/variant/适用关系/价格簿/库存等管理能力分别由 P3-02/P3-03 连同所需 Application/API 端到端实现，不能把这些任务限定成只有 UI；4B 的政策与媒体管理接口不替代这些业务管理能力。
- [ ] 单对象公开内容接口使用版本化扩展 DTO；与真实发布证据一起验收，只读取满足完整发布证据的当前 head，缺译/失效不得静默回退旧 description（由 3B 移至本检查点）。
- [ ] 发布同一事务写 audit/publication/head 与七 locale outbox；订阅按 event type 分流，content consumer 不能把无关支付事件送入死信。
- [ ] 发布/回退事务同步维护 source-hash 绑定的名字/别名投影，并落地 publication manifest/hash 的生成与验证；2A 读取当前从不可变内容与终审记录重建，不将旧汇总 hash 的存在当作真实性证明。
- [ ] `apps/worker` 接 content purge consumer；精确 locale 路径/标签、提交/轮询完成/重试状态幂等；CloudFront PENDING 不能当作 COMPLETED。
- [ ] 本地真实 API/DB/media 发布到查询变化 ≤60 秒，失败与重试可查询；云 CDN 真验明确留给部署门，不能冒充当前结果。

## 检查点 5：任务退出

- [ ] 运行受影响 tests、format/lint/typecheck/build、全仓 `mise exec node@24.20.0 -- corepack pnpm check`，真实 PostgreSQL/S3 集成和 S.U.P.E.R 10 项。
- [ ] API/worker 新能力独立非作者复核；如有页面变化，补 390×844/1440×900 七语言、键盘、reduced-motion 与错误状态浏览器证据。
- [ ] 命令、退出码、证据、实际限制写入 phase；完整验收才 P3-01 DONE，再解锁 P3-02/03/04，MASTER 总计保持 49。

## 下一阶段页面验收矩阵

P3-04 使用至少 120 位虚构艺人覆盖末端加载/搜索第 100 位/暂停/未知 ID/IME/请求竞态；P3-05 使用至少 120 件多规格礼物覆盖同价、无可售规格、价格区间、页码越界、切筛选回首屏、语言/后退保持；两者使用真实 PostgreSQL fixtures。P3-06 覆盖七语言、320px/双基准视口、慢网、键盘/读屏和 SEO。这些是明确后续验收，不是当前样板已实现的能力。
