# P4-05 安全查单真实协议记录

Owner: `/root/access_protocol`。仅测试与验收；无生产收款、邮件发送或产品订单页面结论。

## 开发验证

- `gateway-red.log`：2 个有效失败，原实现没有响应丢失网关；`gateway-green.log`：2 PASS。实际 HTTP upstream 成功后，通过真实 socket 断开分别丢失全部响应，或仅丢失 JSON body、保留真实 Cookie headers。网关不会制造付款或查单成功响应。
- `ingress-red.log`：2 个有效失败，编译入口当时没有 order-access composition。`protocol-build-first.log`：API/Worker 依赖 25/25 构建通过，16 缓存，7.778 秒。
- `ingress-first.log`：2 个实际 PostgreSQL / HTTP 短探针和 2 个真实 socket 测试共 4 PASS，3.527 秒。401/400/413/403 与持久 429、忽略伪造转发 IP 已验证；零订单 fixture。这次发生在后续 bootstrap 锁等待时钟补强之前，最终候选须复跑。
- `observer-sql-probe.log`：一次性诊断从根目录执行，Node 无法解析 API 工作区的 `pg`，没有执行数据库探针；`observer-sql-probe-green.log`：换到正确 `apps/api` 工作目录后，最新 28 schema 中真实执行 19 个业务表指纹查询，并 PREPARE 2 条测试查询，通过。

## 首次长链：保留失败

`http-first.log` / `run-2026-09-15T12-48-01.915Z/`：FAIL，5,822 断言；第一份合法已付款订单 bootstrap/read 都是 200，实际媒体探针未通过。失败 stage 精确为 `Protected order media resolves to actual historical S3 derivative bytes`。当次没有记录具体媒体 HTTP 状态，不补造 404 或其他数字。

代码定位：P4-03 历史快照固化的是 `media_assets` master 的对象 key；真实图片处理把 master 保存到私有 SOURCE。新历史读取初版直接拼这个 key 成公开 CDN URL，而实际媒体网关仅提供 `media_variants` 的 DERIVATIVE。不能放开 SOURCE 来迁就读取。PG 作者随后用有效失败测试修为按冻结 asset ID / master checksum / master key 选择历史 READY 派生产物，保留原文/alt，缺少派生产物拒绝。

第一次长链进程也早于 bootstrap 锁后时钟补强 build。它是开发诊断，不是最终候选验收。自有 fixture 的 finally 清理已执行。

## 后续开发诊断：保留失败

- `http-second.log` / `run-2026-09-15T12-52-30.807Z/`：FAIL，6,367 断言，失败在实际重复 Cookie HTTP 探针。此前七语言订单、14 次实际 S3 图片请求及中文 DAILY 订单均已通过。测试 raw HTTP helper 使用 header 数组时缺少 Host；独立最小真实 Node HTTP 测试在相同 helper 上有效失败为 400（预期 204）。补上合法 Host 与 Content-Length 后，重复 Cookie 原始排列仍保留，最小测试通过。没有修改生产重复 header guard。
- `raw-observer-red.log` → `raw-observer-green.log`：上述合法 HTTP framing 的有效 RED → GREEN。
- `ingress-second.log`：6 PASS，4.384 秒。包括 3 个实际空 PostgreSQL / HTTP 探针、2 个真实响应丢失网关和 1 个 raw header framing 测试。实际重复 Cookie / Origin / CSRF 分别拒绝为 401 / 403 / 403；不会将无效 HTTP framing 误当业务授权测试。
- `http-third.log` / `run-2026-09-15T12-56-27.662Z/`：FAIL，6,754 断言。历史目录变更前的跨单、CSRF、一次消费、代次撤销、并发、真实 token/session 过期、两类真实 socket 响应丢失和 KMS 失败关闭已越过；失败为后续礼物重新发布 preflight 的 `MEDIA_METADATA_NOT_PUBLISHABLE`。不能放宽旧发布门。新 helper 改为读真实现役礼物媒体引用及对应 metadata publication head，并要求当前 PUBLISHED；实际 28 schema 中该只读参数 SQL 已 PREPARE 通过。
- `http-fourth.log` / `run-2026-09-15T13-03-30.485Z/`：仍 FAIL，6,759 断言。安全摘要证明替换 PRIMARY 的旧引用与现役 head 均为 PUBLISHED，引用未前进；所以第三轮的“替换图 seed 引用过旧”猜测不成立，不能写为最终根因。进一步核对旧 COPY 行为：未传 changes.details 时会保留原详情 MEDIA 及其语言 metadataId，发布 preflight 会合并这些引用并按 asset ID 排序，第 0 项不一定是 PRIMARY。
- `http-fifth.log` / `run-2026-09-15T13-07-28.737Z/`：旧详情媒体通过真实已认证 read 确认 lifecycle 为 SUPERSEDED；PRIMARY 与详情图同步正常换图、七语言图注 metadataId 更新并重新审核后，发布、改价、艺人和礼物归档及全部 8 份历史 DTO 严格相等均通过。API 非作者的 `review-rose-master-probe.log` 用真实图像管线证明 legacy matte 与 DAILY 原始 Rose 产生同 master checksum/key；正常去重复用 asset，DAILY 新 metadata 发布使该 asset 的旧 metadata SUPERSEDED。发布门正确拒绝旧详情引用，不应放宽。
- 第五轮最终 FAIL，6,834 断言，错误 `EEXIST`：新第二个媒体网关在同一个 TEST 目录重复生成 `storefront-media.ext`，原 helper 的 `wx` 正确拒绝覆盖。修复位于新的 `order-access-media.mjs`，第二 origin 拥有独占临时目录并使用同 TEST CA，仅 close 自有资源；旧媒体 helper 未改。
- `media-origin-red.log` → `media-origin-green.log`：有效 RED → GREEN，独立实际 TLS 双网关、两个未发布路径 404、第二网关子目录关闭删除，1 PASS，0.279 秒。这个短探针没有请求 S3，不冒充实际图片验收。
- `ingress-final.log`：全部 7 个短测试 PASS，4.132 秒。第六轮前新协议所有源文件 scoped ESLint exit 0。第六轮补充 DAILY 历史图真实 S3 请求；最终限流场景先自然等旧 2 秒窗口结束，再用新 30 秒窗口跨两个 API 实例，避免测试恰好跨极短窗口。

## 授权与证据边界

最终第六轮 `http-sixth.log` / `run-2026-09-15T13-11-19.689Z/` 完整 PASS、exit 0，共 6,860 断言（setup 5,763 + 本协议 1,097），清理完成。交接详情见 `protocol-handoff.md`。原质量门由 root 冻结候选后执行。

- 所有订单来自正常 cart/checkout、独立持久 TEST PSP 托管表单、经认证 reconcile、原 Application 付款应用；没有直接 SQL UPDATE 订单/支付/库存/审核状态。
- 内部 issue 由受信测试入口持有真实内部 order ID，raw link/session 只在 callback 内存；公共 bootstrap 仍要求原 cart Cookie + CSRF + 实际 PAID。
- Cookie 已收到而 JSON 丢失时，协议已有 `publicOrderId`，验证的是这个已知非授权 ID 加有效 Cookie 的 GET 恢复。没有证明 Cookie 可以独立发现订单，也没有实现邮件 fragment 或订单 UI。全部 Cookie/JSON 丢失而没有 checkout 授权时，需要后续新链接。
- pre-COMMIT 回滚是包裹真实事务后注入异常；实际 socket 断线是响应层网关。两者分别记录，不能把事务注入说成真实数据库网络故障。
- 版本不可用的 KMS 场景验证失败关闭，不冒充“真实历史 key 轮换后仍可读”的集成证据。
- 原文/改价/换图/归档都通过现有管理业务 API/Application 发布；真实测试身份与内部原素材不构成正式译审或素材授权。
- 普通读取前后检查 19 个财务/购物车/库存/履约/通知相关表的完整指纹、独立 PSP 计数与 KMS Decrypt 计数；访问审计、session 与限流自己的必要变化单独保留。

## 原全仓检查发现的旧回滚 helper 兼容

root 的 `check-full.log` 在原 PostgreSQL catalog directory 门失败：`down migration confirmation must match the applied head`。root 随后明确分配五个旧回滚 helper 的最小兼容修复；三个 catalog/publication PG 主脚本由 PG agent 独占。

本子任务仅改 `packages/persistence-postgres/scripts/` 下 `cart-runtime-rollback-proof.mjs`、`cart-edit-rollback-proof.mjs`、`checkout-preflight-rollback-proof.mjs`、`payment-runtime-rollback-proof.mjs`、`order-payment-rollback-proof.mjs`：当前头校验为 0028，经正常 migration runner 先将空 0028 降到 0027，再原样执行 0023/0024/0025/0026/0027 的数据保护 SQL、错误码/消息和全表指纹断言，成功后恢复 0028。order-payment 在原 0027 guard 后新增恢复最新头；其余原有恢复只更新预期头。对应返回断言计数各增加 1（order-payment 增加 2）。未改任何旧 SQL、业务数据、生产 guard 或新 order-access 的 target 0027 升级边界。

定向可重复命令：`mise exec node@24.20.0 -- node --test output/checks/p4-05-order-access/rollback-head-probe.mjs`。

- `rollback-head-red.log`：五 helper、含 cart DYNAMIC/PENDING 六场景在实际 0028 空库全部因旧头断言失败（0028 !== 0027）。
- `rollback-head-green.log`：同一真实 PG 探针，六场景各正常降到其原 guard 所属旧头，然后因缺少原有必需业务历史而按原断言拒绝；确认边界头为 0023/24/25/26/27，并由探针恢复最新 0028。6 个子测 + 1 个父测 PASS，2.240 秒。
- 这个短探针只证明真实空 0028 降级及旧必需 fixture 断言路径，没有伪造付款/编辑数据，也不冒充六条带业务历史的完整旧协议已重新通过。完整旧协议由 root 下一次全仓 check 统一执行。
- 五 helper 和新增 output `.mjs` 探针已 Prettier；显式 ESLint 全覆盖 exit 0，见 `rollback-head-lint.log`。本节与探针证据落盘后再次 freeze。

## 第二轮原全仓检查：旧 webhook 入口保留期限失败

root 的 `check-full-second.log`（exit 1，1,416.464 秒）在旧 `apps/api/scripts/order-payment-webhook.test.mjs:207` 断言失败：完整原 payment-runtime 6,562 断言已通过，随后 order-payment 4 个短测中 3 PASS / webhook 1 FAIL，原预期 202 实际 503。该整份失败记录保留，不改写成通过。

按 root 指令仅同源码、同参数、同阈值快速复验：`mise exec node@24.20.0 -- node --test apps/api/scripts/order-payment-webhook.test.mjs`。`webhook-unchanged-recheck.log` 仍 FAIL（1.934 秒）。完整检查的 `occurred_minus_received_us=-54106`、前一次未知 endpoint 的 `wall_minus_received_us=-20936`；本次分别为 -53874 / -22212。这只能证明候选事件早于应用 receivedAt、且前一个请求观察到两个时钟不同，不能单凭这些值判为本次未来事件或瞬时时钟回退。

root 明确授权只读预加载 SQL observer 后，创建 output-only `webhook-sql-observer.mjs`，保持原 query 参数、返回值、错误和原测试不变，仅记录固定 statement tag、rowCount、SQLSTATE。命令：`mise exec node@24.20.0 -- node --import ./output/checks/p4-05-order-access/webhook-sql-observer.mjs --test apps/api/scripts/order-payment-webhook.test.mjs`。

- `webhook-observed-recheck.log` 再次 FAIL；成功验证签名并进入真实 receipt 事务，`load-provider-event` rowCount 0 后，第一条 `reliable-event:insert-webhook-payload` 报 SQLSTATE 23514。尚未执行 inbox/event 插入，因此不是 provider occurredAt 的后续插入保护或队列写入错误。
- 仅增加一个已知约束名的布尔白名单后，`webhook-retention-observed.log` 确认 `retentionConstraint:true`，精确对应 `webhook_payloads_retention_check`，仍 503。没有输出参数、SQL全文、失败行、raw body、密钥或精确时间原值。
- 只读根因链：Application 将 expiry 设为应用 `receivedAt + 7 days`；PG 插入使用默认 `created_at = transaction_timestamp()`；原 0005 guard 要求 expiry 不晚于 PG `created_at + 7 days`。同一完整 7 天上限用了两个不同钟源；已观测的应用钟领先可使 payload 的保留到期越过 PG 上限。约束失败和代码路径已确认，未记录本次 receipt 事务的精确差值，不能补造该数值，也不声称操作系统发生时钟回退。
- 原 webhook 测试、order-payment-runtime fixture、Application receiver、PG reliable-event-repositories 的 `git diff` 均为空。测试文件 SHA256：`647dca7240b9fc8180f9c03d5b2554264844e3f6c5001067d27eee5089e8469f`。
- Observer 的 Prettier 与显式 ESLint 通过（`webhook-observer-lint.log`）。本次没有改实现、fixture、时钟、timeout、7 天上限或重跑完整长链；最小生产修复交 root 分配。记录到此再次 freeze。
