# P4-05 安全查单非作者复核

Reviewer：`/root/access_api`。复核对象为 root 的新合同、Application、持久化端口，以及 `/root/access_postgres` 的新 PG 实现、0028 迁移和装配；不把本人编写的 API 当作非作者复核范围。

当前结论：**ACCEPT：P4-05 安全查单服务端检查点的非作者复核通过，S.U.P.E.R 10 项全部 PASS。** 当前无未解决阻断发现。40 项原门通过已有候选结果与最终窄修后的差分重跑形成完整覆盖，**不是单条完整 `pnpm check` 一次全绿，也不是所有门都在同一冻结 source 上运行**。原失败与修正均保留；本结论不代表整个 P4-05 DONE、查单 UI/邮件完成或生产发布。

## 核对结果

1. 业务合同仅接带 pepper version 的 keyed 摘要，候选数量最多四个且版本不重复；raw link/session、Cookie、地址和 CSRF 不进入业务对象。read/revoke 的公开订单 ID 只用于限定访问范围，不单独授权。
2. Application 在同一事务 callback 内验证仓储返回，未知/私密额外字段以及跨订单 read/revoke 响应必须回滚，任意基础设施异常映射为固定不可用。限流单独提交，拒绝后的授权回滚不能抹掉计数。
3. PG 先解析摘要归属，再按 cart → order → token/session 加锁；加锁后重新取得状态。未知/歧义候选、过期/未来/撤销/消费状态拒绝。exchange 的真正消费 UPDATE 再按当时 clock 判断；read 在历史投影前后检查 session。
4. 已付款 bootstrap 必须匹配 cart 摘要和具体 checkout、非过期 CONVERTED cart 以及已付款 order。root 已指出的等待锁导致旧 cart expired 布尔过时问题，现由 `confirmBootstrapCart` 在聚合锁后和 grant 返回前两次按 `clock_timestamp()` 重验，失败回滚。
5. 一次性 token 消费、独立 session 创建、旧代撤销和 audit 同事务。继续复用 0004 的不可变摘要/订单范围、一 token 一 session、每订单最多一个 ACTIVE token/session 和消费终态，不重新激活旧 token。
6. 新 issue/exchange/bootstrap 限已付款且 OPEN/CLOSED 的历史订单；read 可读已授权历史订单的后续退款/争议等事实，不推进支付或履约。消费与读取均未调用 PSP、金融入账、库存或通知 Outbox。
7. 历史读模型只选择订单/订单行不可变文本、金额和媒体对象身份及 canonical 履约状态；没有读取 live idol/gift 文案，没有 decrypt 接口。v2 规格名称来自对应 immutable checkout observation；v1 原来没有的规格名如实为 null。DAILY resolved/source locale 与严格批准/英文事故 fallback 区别保留。
8. 每个公开金额/行算术、币种、连续位置及四类历史语言请求来源由 schema 重新验证。所有字段显式 allowlist，不含 orderItemId、supportIntentId、联系人、粉丝完整显示名、objectKey 独立字段、凭证摘要或解密值。
9. 历史媒体按订单冻结的 assetId、原图 checksum 和原图 key 精确关联原资产，只返回该资产 READY、尺寸和比例匹配的公开衍生图。0002 已使资产和衍生图身份及对象 key 不可变；不查询当前 catalog/publication，不回退到私有原图。公开对象 key 经 schema 排除绝对 URL、双斜线和目录穿越，组合配置 CDN URL 后重验 origin/path；缺失衍生图即失败。第六轮真实协议已通过七语言及 DAILY 历史 S3 bytes、变更目录后的历史读取和更换媒体域名后的同原图读取。
10. 0028 只新增持久限流与 append-only scope audit。限流 UPSERT 同 key 原子累计、固定窗不因失败回滚、时间回退保守不提早重置。audit 仅 ID/操作/trace，scope 由延迟约束验证。数据存在即拒绝 down，不悄悄抹掉历史或重置限流；旧 0001–0027 未改。

`issue` 是内部可信能力，尚未暴露按订单号/邮箱签发的公网接口。恢复 GET 仍需要已知 publicOrderId + 有效订单 Cookie；本轮没有仅 Cookie 自动发现订单、真实邮件或浏览器 fragment 页面完成证据。

## S.U.P.E.R 10 项

| 项            | 结果 | 依据                                                                                                                                                          |
| ------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 单模块职责  | PASS | credentials 不在本非作者范围；已审合同、用例、仓储读取/写入/限流职责分开                                                                                      |
| 2 单函数责任  | PASS | Application 仅命令验证/事务/结果，PG helper 各负责归属、锁、消费、历史投影或限流                                                                              |
| 3 单向依赖    | PASS | Application → port；PG 实现 port；无向 API/UI 依赖                                                                                                            |
| 4 无新增循环  | PASS | 新边界为合同与 type-only 端口引用，PG 不被 Application 导入                                                                                                   |
| 5 Schema 合同 | PASS | 命令、凭证摘要、结果、配置、历史视图均显式 schemaVersion                                                                                                      |
| 6 可序列化    | PASS | 边界仅 JSON 对象/数值/字符串；pg row/error 不作为结果穿透                                                                                                     |
| 7 环境独立    | PASS | 域名由 media 配置提供，时间由 PG clock，金额/订单从 PG 事实；无生产密钥/固定对象身份                                                                          |
| 8 依赖声明    | PASS | 复用既有 contracts/domain/port/PG 依赖，无未声明新供应商导入                                                                                                  |
| 9 可替换组件  | PASS | OrderAccessTransactionManager 独立接口；API/业务不依赖 SQL/schema 细节                                                                                        |
| 10 验证       | PASS | 非作者 Application 7 / PG 17 单测通过；原 40 门按 source-second 与 source-third 差分分段完整覆盖，最终 PG、付款/查单 HTTP、S3 和七项质量门全部 exit 0；见末节 |

## 独立运行记录

- `review-postgres-unit.log`：两文件 15 PASS，exit 0；包含过期/未来/已消费/错误归属、bootstrap 二次 clock 重验、v1/v2 原文、路径及公开投影。媒体修复后独立复跑 `review-postgres-media-unit.log`：两文件 17 PASS，包含禁止输出私有原图和缺失 READY 衍生图拒绝。
- `review-application-unit.log`：一文件 7 PASS，exit 0；包含跨订单/PII/金额/locale 错误结果事务回滚及独立限流。
- `review-legacy-unchanged.log`：保留宽 scope 的 `database/migrations packages/domain` diff，其中明确包含 manifest.json 新增 0028 条目；原先报告将它误写为 exit 0 已纠正，不能作为整个迁移目录未改的证据。随后精确执行 `git diff --exit-code ab0b137 -- ':(glob)database/migrations/*.sql' packages/domain`，`review-legacy-sql-domain.log` 无 diff、实际 exit 0，证明旧已跟踪 SQL 与 domain 未改。旧 54 份 SQL 逐字不变以最终 `compatibility-and-protection.json` 核验为准；新 0028 与 manifest 追加均为预期变更。

- `postgres-parameters-media.log`、`postgres-constraints-green.log`：已只读核对真实 PG 17 条 PREPARE / 21 断言、10 个约束及有数据拒退断言，与对应脚本实际行为一致；非本人重跑。
- `quality-second.log`：仅包级 typecheck/test/build 108/108 成功，不是完整 `pnpm check`；root 精确补充新 OpenAPI 4 路径与 2 security schemes 后，既有断言未放宽。`compatibility-and-protection.json` 报告旧 555 合同根、92 路径、171 API 组件、54 SQL 无变化。
- 已复核 `docs/operations/order-access.md`：未配置固定 503、仅已知 publicOrderId + Cookie 恢复、代理 peer 共享预算与未来 UI/邮件边界明确；提交前故障注入已明确为真实回滚，不误称数据库 COMMIT 结果未知。

## 协议非作者补充复核

只读检查协议作者的 `order-access-client/runtime/history/gateway/observers/protocol/commit-faults/media` 及对应新短测试，未修改其文件。

- 全部付款订单通过既有 cart → checkout → 独立持久 TEST PSP → 认证证据 → canonical order apply 建立；业务 fingerprint 对比 19 个表及 PSP 调用计数，不将 access audit/rate 的合理写入混作金融副作用。没有 SQL 篡改付款状态、伪造订单或删减履约/库存守卫。
- BEFORE_COMMIT 故障在真实事务 callback 完成仓储写入后抛出，并确认 token/session/audit 全回滚；这是明确注入故障，不是数据库网络断开或 COMMIT 结果未知。两种 socket 丢响应是实际连接中断，恢复使用已知 publicOrderId + Cookie 或原 cart bootstrap，不能仅 Cookie 自动发现订单，也不能重放已消费 token。
- 第三/四轮详情图片 preflight 拒绝的根因已确认：复制旧详情保留原 metadata，而 DAILY 复用同处理后 Rose 资产后正常发布新说明，使旧说明 SUPERSEDED。独立 `review-rose-master-probe.mjs/log` 真实图像管线在 0.627 秒内证明 legacy matte 与 DAILY 原图生成相同 master checksum/key；第六轮实际认证读取日志确认旧详情 metadata 为 SUPERSEDED。当前目录换图通过正常 authoring 同时替换 PRIMARY 与详情结构、全部语言 MEDIA 引用，保留 caption，并完整重新审核/发布；旧订单原图和原文字节不变，没有绕过发布 guard。
- 第五轮第二媒体 origin 的 EEXIST 源于同目录固定证书文件的 `wx` 保护。新 helper 只创建独占 mkdtemp 子目录、复制同一隔离 TEST CA、设置 0600 并关闭后清理；旧 certificate helper 和保护未变。独立短测试证明两个不同真实 TLS origin 与 404、清理，不冒充 S3 图片验证；第六轮随后证明替换 origin 的真实历史 S3 bytes。
- EXCHANGE 的 30 秒显式测试窗口覆盖独立 API 关闭重开后同一数据库桶的 401/401/429；先等待原窗口自然到期，从不改写计数或系统时间，并验证 X-Forwarded-For 无效。真实持久额度耗尽证据限于 EXCHANGE；READ/BOOTSTRAP/REVOKE 的路由/故障边界由单测及独立故障探针支持，不把它们写成全部 scope 已做实库耗尽链路。
- 旧 v1 缺规格名返回 null 由 PG 单测支持，本次完整正常 checkout 使用 v2，不宣称实际迁移旧 v1 订单全链路；未知 pepper 的独立 TEST KMS 缺版本为 503，不伪称真实供应商旧密钥轮换。raw 请求头、token/CSRF、私密消息及联系人不进入协议报告；日志只记录固定类别、状态、code 和已筛选的生命周期。

第六轮 `http-sixth.log` / `run-2026-09-15T13-11-19.689Z/run-result.json`：PASS、6860 总断言、browserStarted=false。该轮是修复前候选的范围证据；最终差分验收见末节，不把本地证据写成真实 PSP、邮件、前台查单 UI、生产发布或完整 P4-05 DONE。

## 完整检查的迁移测试适配复核

只读核对 10 个既有测试脚本的完整 diff：`cart-edit/cart-runtime/checkout-preflight/order-payment/payment-runtime-rollback-proof.mjs` 和 `postgres-admin-catalog/catalog-directory/content-draft-repositories/publication-runtime/publication-validation-time-cases.mjs`。

新增修改仅用于当前 schema 从 0027 升至 0028 后，先准确执行空 0028 → 0027，再运行原有降级拒绝/历史保护断言，最后恢复并验证当前 0028；部分主脚本增加了额外的历史内容完全相等断言。旧拒退守卫、旧 confirmVersion、金额/库存/审计/发布快照比较全部保留，未删除失败断言或调整 timeout。断言计数只随实际新增断言增加。旧迁移 SQL 无修改；若 0028 已有访问计数/审计则仍会拒退，这些旧 fixture 尚未创建访问业务数据，因此执行空 0028 降级是预期前置，而不是清空数据绕过守卫。

第一轮完整 `pnpm check` 在该旧脚本 0027 确认版本处失败已保留；本复核接受上述适配的范围和语义，但不以包级 108/108 或静态 diff 代替完整门证据。第二轮随后在旧 webhook 保留期边界处失败；最终差分重跑已通过，见末节。

## 既有 webhook 保留期时钟边界修复复核

完整原检查继续到旧 order-payment 原始 webhook HTTP 测试后，正常验签收据在 `reliable-event:insert-webhook-payload` 被 SQLSTATE 23514 拒绝。已有 `webhook-retention-observed.log` 通过白名单仅报告 `retentionConstraint=true`，确认失败发生在 inbox/provider event 写入前。应用用 receivedAt 加七天形成绝对到期，原 0005 将 created_at 锚定为 transaction_timestamp，并要求到期大于创建时间且最多七天；应用时钟略领先 PG 时，原参数可能超出数据库上限。这是本轮完整回归暴露的既有缺陷，不是为了放宽测试而修改付款标准。

只读审查最终生产 diff，仅 `reliable-event-repositories.ts` 的一个 payload INSERT 表达式改为 `least($6::timestamptz, transaction_timestamp() + interval '7 days')`。对原严格 schema 验证通过的时间输入，此值不会晚于调用方绝对授权或原数据库七天上限；较短期限精确保留，已经到期/等于创建时间的输入仍由原下限约束拒绝。未修改原 migration/trigger、参数、created_at、inbox received_at、签名时间、事件发生时间、验签逻辑、原子收据/重放/冲突处理或加密内容，没有测试 sleep/时钟设置修改。

新 `postgres-webhook-retention-time.mjs` 抽取实际唯一生产 SQL marker，对完整迁移原表及全部原 trigger 执行，不复制简化表。独立读取 clean RED `postgres-webhook-retention-red-observed.log`：只有应用领先 20ms 的一例失败且精确命中原 retention constraint；GREEN 同命令五例/13 断言通过，覆盖领先时钟收紧、较短授权精确保留、精确七天、已过期和创建边界。实际存储的密文、密钥版本、payload hash 和状态同时比较；每例回滚且最终零留存。此前 probe-only 文本密钥版本误按整数比较的失败保留，不算 clean RED。该 probe 不证明 PSP 验签或并发，原 repository 九个单测和原 PG/HTTP 门继续保留。

调用图复核：生产唯一调用链为 `createReceivePaymentWebhook → verifiedWebhookReceipts.record → insertVerifiedReceipt`，HTTP 入口为 `/api/v1/webhooks/payments/:endpointId`；未发现其他生产 HTTP 路径直接执行该 payload INSERT。保留期清理消费者仍按数据库值执行，其原实现未改；完整 persistence-postgres 原套件覆盖直接仓储/应用及清理场景，原 order-payment 完整入口覆盖真实验签 HTTP。

接受 root 的差分验证范围：原完整 persistence-postgres test:postgres（追加新 probe 且保留全部原门）、原 API test:postgres:order-payment 的四个短测及长链、原 order-access 短测/长链、test:s3 和原七项质量门。此前其他 HTTP 证据仅按各自 source-second 记录复用，需由 source-third 对比明确生产变更仅本表达式及新 probe/PG 脚本链。不得声称全部 40 门在同一冻结 source 执行，也不得声称任一单条完整 pnpm check 已全部通过。修复语义和差分计划已接受；最终执行结果现已核实完成，见下节。

## 最终分段验收核实

已只读核对 `remaining-gates-result.json` 的每项命令、exitCode 与对应 `remaining-14/31–40.log` 原输出；该结果明确 `status=PASS`、`singleFullCheckPassed=false`。此前 `check-full-second-result.json` 明确保留 exit 1（1416.464 秒），而其日志中前 30 项已完成；其他未受本表达式影响的 HTTP 证据按 source-second 复用。最终 source-third 对这些原门作以下差分补验：

- 第 14 项：原完整 persistence-postgres test:postgres（含新增保留期真实 SQL probe 及所有旧 PG 守卫），376.188 秒、exit 0。
- 第 31 项：原 order-payment 完整入口，四个短测试全部通过、6827 总断言长链通过，113.724 秒、exit 0；真实 webhook/付款回归覆盖本表达式的生产 HTTP 调用。
- 第 32 项：order-access 原入口七个短测试全部通过、6860 总断言长链通过，88.017 秒、exit 0；最新运行目录为 `run-2026-09-15T14-12-44.540Z`。总断言含既有 fixture，不全是新增查单断言。
- 第 33 项：原 test:s3 全部通过，末段真实媒体 worker/PG/TLS S3 为 423 断言，73.569 秒、exit 0。
- 第 34–40 项：原格式、lint、typecheck、test、build、依赖边界、构建产物七项全部 exit 0。typecheck 61/61（58 缓存）、test 61/61（58 缓存）、build 36/36（36 缓存）；真实 Node 导入 32 个 package exports 通过。不把缓存命中写成全部重新执行。

独立重新计算 `source-third.json` 与 `source-after-check.json`：2070 个文件的集合及逐项 hash 完全相等，清单 SHA-256 同为 `9603ad3c5123470fda4b5e30440eef836a3c049698190b1aa2c772ea693b6dd4`；并实际读取当前全部 2070 份文件，字节 hash 均与最终清单相符。与 source-second 的真实差分恰为 `reliable-event-repositories.ts`、新 `postgres-webhook-retention-time.mjs` 和 PG package.json 三路径，与 `source-third-delta.json` 一致。

`compatibility-and-protection.json` 明确 PASS：555 旧合同根、92 旧 API 路径、171 旧组件、54 旧 SQL 逐字无变化，2412 份原未跟踪文件未改。新迁移清单追加与新 schema 是本轮授权范围。

`admin-next-env-restoration.json` 保留开发时 Next 生成的两条 import 差异及源码包装脚本断言失败，未掩盖 shell 在断言后继续执行的事实。只恢复该生成声明文件到原冻结字节；独立核对当前文件 hash 与 base Git、记录中的 baseline hash 相同。该恢复不属于 PG 输入，原七项质量门在恢复之后执行；最终源码清单再次完全匹配。不能把这次恢复或包装脚本失败描述为原单条全量命令通过。

基于以上源码差分、调用图、原门保留及成功结果，接受当前服务端检查点。已知范围限制继续保留：没有真实商户/生产云 KMS、邮件发送、fragment/前台查单浏览器页面、生产部署或资金操作完成证明；整个 P4-05 状态仍由后续 UI 检查点决定。
