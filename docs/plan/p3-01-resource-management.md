# P3-01 Media and Policy Management Implementation Plan

> For agentic workers: use subagent-driven implementation with frozen contracts and independent spec then quality review. Root owns shared files and commits.

**Goal:** 运营通过当前会话和明确权限注册政策、上传并可信登记私有原图、记录版权、创建/查看/重试构图任务。

**Architecture:** Route → Application → Content/Ports → PostgreSQL、S3、Sharp。上传预约先提交，签名与完整图片解码在事务外，最终登记重新授权并锁定预约；幂等只保存结果引用。政策、上传、版权与任务审计使用专属关系表，不引入万能JSON业务表。

**Tech Stack:** 当前锁定 Node 24.20.0、TypeScript/Zod、PostgreSQL、Nest/Fastify、S3 adapter、Sharp；不升级依赖。

## 1. 合同与失败测试（root）

- [x] 新建 `packages/contracts/src/resource-management.ts`、`resource-management.test.ts` 和 `resource-management-openapi.ts/.test.ts`；严格 REGISTER_POLICY(kind+key)/BEGIN_UPLOAD/COMPLETE_UPLOAD/READ_UPLOAD/READ_MEDIA/SET_RIGHTS/ENQUEUE/READ_JOB/RETRY，外部请求不能注入actor/session/key/尺寸/可信receipt。
- [x] 新增 source inspection 命令/响应，不使用伪造媒体或角色调用已有 process。定义 source bytes≤25MiB、pixels≤40M、单帧、真实encoded宽高及orientation；源文件保持私有，现有角色processor剥离EXIF。
- [x] 新授权permission合同复用旧principal/session摘要语义，旧246 roots深比较不变；生成JSON Schema/OpenAPI。
- [x] `packages/persistence-port/src/resource-management.ts` 与 `packages/media-port/src/processing.ts` 明确事务与inspection边界，冻结后分发。

## 2. PostgreSQL（DB owner）

- [x] 0017 新建policy registration receipts、media upload reservations、media rights events、media processing admin receipts；命名FK、actor/session/audit、不可变历史与有数据down保护。
- [x] 普通enqueue只去重generation1；FAILED新代必须同recipe、generation+1、唯一前驱后继与审计。保留六次自动重试和旧lease fence，根任务历史合同不变。
- [x] 上传随机私有key、身份/期限不可变、仅PENDING→REGISTERED；实际验证后按SOURCE checksum去重，不覆盖旧asset、版权或metadata。已有成功票可重放，未完成票严格真实到期。
- [x] 版权事件锁asset做连续version/CAS，保存新evidenceReference但不改asset旧rights_reference；来源撤权进入processed master可用性校验。
- [x] 先失败约束/仓储测试，再真实PG并发、故障回滚、旧schema/数据迁移与普通enqueue回归。

## 3. Application 与真实inspection（Content owner）

- [x] 上传preflight当前授权后只读固定ticket；网络无DB事务。登记前再授权、幂等、FOR UPDATE/CAS、实际receipt身份相等，失败回滚。已REGISTERED同key重放无需网络，异key版本冲突。
- [x] BEGIN幂等只保存uploadId；签名URL/headers事务外生成且不持久化。签名最多5分钟、预约最多15分钟，均受签发会话上限约束。S3 URL在TTL内可能仍能PUT，撤权后最终登记拒绝，不能假称URL即时撤销。
- [x] `MediaSourceInspectionPort` 实际HEAD、有界GET、checksum/MIME/size核对与完整像素解码；拒绝损坏/多帧/伪头/像素超限，保留精确身份receipt。仅来源可控的存储grant可发起fetch，拒绝redirect。
- [x] 所有新命令当前权限先于幂等；权限与语言分配独立，素材版权不自动批准译文。审计失败不残留数据库 asset/rights/job/idempotency；已经上传的私有 S3 对象保留待后续可审计清理。
- [x] 用明确失败测试证明事务外网络、撤权重放、并发和崩溃恢复；运行真实图片fixture及既有processor回归。

## 4. HTTP 与组合（Transport owner/root）

- [x] POST管理入口复用严格Origin/CSRF/opaque Cookie/64KiB JSON/no-query/private/no-store/noindex/no-referrer；写命令显式Idempotency-Key/expectedVersion/reason。只返回受权最小状态，普通READ不返回私有原图下载URL。
- [x] 显式TEST组合注入DB、存储、inspection；关闭资源恰一次。不开生产登录、不写真实运营素材。
- [x] 真实Nest/Fastify+PG+TLS S3完成注册政策→3B首次草稿、签名PUT→可信登记→metadata→处理worker→版权/状态；覆盖存储故障、权限撤销、非法输入、终态人工重试与审计原子性。

## 5. 验收与本地提交（root）

- [x] 受影响包 `test`，生成合同与迁移catalog，再format/lint/typecheck/build。
- [x] 真实PG/HTTP/S3专项和完整 `mise exec node@24.20.0 -- corepack pnpm check`；刷新P2-04/05双端七语言、键盘/reduced-motion/错误状态浏览器证据。
- [x] 规范复核后质量复核、代码职责收敛、S.U.P.E.R10项、secret/diff/source指纹检查；证据写入phase/MASTER，P3-01保持IN_PROGRESS。
- [x] 本轮验收源码/必要证据本地commit；按用户偏好最终统一推送，当前不新增远端CI或发布结论。

完整revision验证、原子发布/回退、版本化公开扩展DTO/manifest/head、名字别名投影、七语言outbox/purge及≤60秒可见性继续沿主运行时计划实施；本轮不替代这些退出条件。无引用重复上传对象的后台清理另留有审计运行入口，不在注册失败时删除可能被共用的对象。
