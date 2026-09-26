# F1-4 送达证明照片：实现设计

> 日期：2026-09-27 · 依据：V2 方案 §4 第 6 项、`docs/plan/2026-09-26-slim-and-ux-appendix.md` 变更清单第 6 行、规范 §5.8（查单）、§9.5（媒体库）、§12.2（履约状态）、§15（隐私）、ADR-010（媒体身份）、ADR-019（虚拟礼物不走实物送达）、`docs/handoff/2026-09-26-core-features-first.md`（范围已获批准）
> 前置：F1-3 已完成（迁移头 0039）；本机便携 PostgreSQL 可验证迁移、目录快照与回滚前缀守卫；本机没有 S3 模拟

## 1. 结论一句话

运营在后台为实物礼物行上传 1–3 张送达照片。照片经服务端核验、去除全部元数据并重新编码后，存放在**私有 source 桶**的独立命名空间里，**永不进入 CDN 公开的 derivative 桶**。粉丝只能在自己的查单会话里、经 API 按会话授权逐张读取；后台经短时预签地址查看。经理可以撤回误传的照片。

## 2. 关键决策

1. **不复用内容媒体管线的存储与任务表，只复用底层零件。**
   - 内容管线的派生图一律写进 derivative 桶。这个桶由 CloudFront 整桶公开读取（`infra/opentofu/modules/edge/main.tf` 媒体分发没有路径限制），所以任何进过它的照片都会变成公开可读。
   - 内容管线按 checksum 跨公私去重，角色、画布尺寸和 13 个产物写死在 0012 的触发器里，而且要求 `content.media.*` 权限与内容元数据修订，这些都不适合订单私有照片。
   - 复用的零件：
     - `readSourceImageMetadata`：魔数、MIME、像素上限、单帧检查；
     - `decodeSourcePixels`：完整解码、自动转正、转 sRGB，只输出原始像素，EXIF/GPS/ICC 全部丢弃；
     - `createStorageTransfer`：带 checksum 的预签下载与条件上传；
     - `MediaStoragePort.createUploadGrant`/`createDownloadGrant`；
     - 后台订单模块的会话、MFA、权限、审计与操作回执机制。
2. **照片在 API 内同步处理，不进 worker 队列。**
   - 数量级：每条实物行至多 3 张，每天少量送达。一张 12MP 手机照片的解码、缩放、两次 WebP 编码约 1–2 秒。
   - 资源管理的 `completeUpload` 已经在 API 里完整解码源图，同步处理只多两次编码。
   - 省掉任务表、租约、worker 组合与前端轮询。
   - 后台 BFF 转 API 的超时是 30 秒（`admin-api-client.ts`），处理预算设为总计 25 秒；超时或存储抖动时上传保持 RESERVED，客户端用同一 uploadId 重试。
3. **上传与"标记送达"解耦：新增独立的"附加照片"动作，DELIVER 命令不变。**
   - 附加照片只允许在 PREPARING 或 DELIVERED 的实物行上执行；粉丝只在该行 DELIVERED 后看到照片。
   - 后台"标记送达"面板的顺序是：上传 → 附加 → 送达。所以粉丝看到"已送达"时照片通常已经在了。
   - DELIVER 失败时照片仍挂在 PREPARING 行上，对粉丝不可见，重试送达即可。
   - 已送达的行可以补传，满足"照片晚到"的情况。
   - 不改 DELIVER 的合同、回执与履约触发器，降低触碰严格状态机的风险。
4. **照片可选，不强制。** 附录原文是"可传 1–3 张"。有些交付场景无法拍照，强制上传会卡住粉丝的状态更新；界面默认引导上传。
5. **每行至多 3 张有效照片；经理可以撤回。**
   - 撤回是本设计对批准范围的补充：误传别的订单的照片、或照片里露出第三方人脸/地址时，必须有补救手段，否则只能直接改库。
   - 撤回需要 `orders.manage`、原因码与确认勾选；撤回后粉丝与后台都不再显示该照片。
   - 对象不删除，保留作审计证据。删除与保留期限属于隐私政策配置，列为后续。
6. **粉丝读取走 API 字节代理，不下发预签地址。**
   - 预签地址是持有即可访问的凭据，在有效期内可被转发。
   - 字节代理的访问与查单会话绑定，URL 稳定，不暴露存储端点，也不需要 CSP 放行 S3 源站。
   - 代价是 API 带宽：缩略图约 30 KB、大图约 200 KB，可以接受。
7. **后台查看用短时预签 GET（至多 300 秒）。** 沿用后台私有预览的既有做法（`admin-preview-media`），按需逐张签发，不在 DETAIL 读取里批量生成。
   - 查看只开放给负责送达的人（`orders.fulfillment`）和经理（`orders.manage`）。照片可能拍到粉丝附在礼物上的留言卡，而后台读留言本身需要专门的权限与语言授权，所以只有 `orders.read` 的客服不能看照片。

## 3. 数据模型：迁移 0040 `delivery-proofs`

### 3.1 `fulfillment_proof_uploads`（上传预留与处理结果）

| 列 | 说明 |
|:--|:--|
| `id` | uploadId |
| `order_id`、`fulfillment_id` | 复合外键 `(fulfillment_id, order_id)` → `fulfillments(id, order_id)`；预留时即绑定到一条履约行 |
| `actor_id`、`session_id`、`audit_log_id` | 预留人、会话与审计（`DELIVERY_PROOF_UPLOAD_RESERVED`） |
| `source_object_key` | CHECK 等于 `fulfillment-proofs/v1/sources/<id>`，全局唯一 |
| `source_checksum_sha256`、`source_byte_size`（≤25 MiB）、`source_mime_type`（jpeg/png/webp） | 声明的源文件身份 |
| `status` | `RESERVED` → `READY`，单向一次 |
| `created_at`、`expires_at` | 预留至多 900 秒，且不超过后台会话到期 |
| `completed_at`、`completion_audit_log_id` | 完成时间与审计（`DELIVERY_PROOF_UPLOAD_COMPLETED`），必须早于 `expires_at` |
| `display_*`、`thumbnail_*` | 两个 WebP 产物的对象键、checksum、字节数、宽高；键 CHECK 以 `fulfillment-proofs/v1/renditions/<id>/` 开头 |

守卫：INSERT 必须是 RESERVED 且审计逐字段一致，行不是 VIRTUAL。UPDATE 只允许 RESERVED→READY，且只能填写完成列。不可删除或截断。权限在事件时刻重验 `orders.read` 与 `orders.fulfillment`（复用 `admin_order_authorized`）。

### 3.2 `fulfillment_proofs`（照片与履约行的关联，即附录所说的 `fulfillment_proof`）

| 列 | 说明 |
|:--|:--|
| `id` | proofId，对粉丝是不透明标识 |
| `order_id`、`fulfillment_id` | 复合外键同上 |
| `upload_id` | 唯一：一次上传只能附加一次 |
| `sequence` | 每行递增，`UNIQUE(fulfillment_id, sequence)`，决定显示顺序 |
| `attachment_id` | 一次附加操作（批量 1–3 张）的结果 ID，供操作回执引用 |
| `actor_id`、`session_id`、`audit_log_id` | 审计动作 `DELIVERY_PROOF_ATTACHED` |
| `privacy_confirmed` | CHECK 为 true：运营已确认裁掉第三方人脸与地址信息 |
| `created_at` | |

延迟约束触发器校验以下各项：
- 上传是 READY、属于同一履约行、由同一操作者上传；
- 履约行是 PREPARING 或 DELIVERED，且不是 VIRTUAL；
- 未撤回的照片不超过 3 张；
- 审计与权限逐字段一致。

表只追加。

### 3.3 `fulfillment_proof_withdrawals`（撤回）

`id`、`proof_id`（唯一）、`order_id`、`actor_id`、`session_id`、`audit_log_id`（`DELIVERY_PROOF_WITHDRAWN`）、`reason_code`、`created_at`。需要 `orders.manage`，只追加。

### 3.4 对既有对象的改动

- `admin_order_operation_receipts.action` 的 CHECK 增加 `BEGIN_PROOF_UPLOAD`、`ATTACH_PROOFS`、`WITHDRAW_PROOF`。
- `assert_admin_order_operation()` 为三个新动作增加结果表分支：分别校验上传、附加批次、撤回记录与回执逐字段一致。
- 以上两处的原文保存在 down 里，按 0031 版本恢复。

### 3.5 down 与回滚守卫

- 三张新表任一有行时拒绝回滚。照片是业务证据，与 0031、0038 的口径一致。
- 否则删除新表与函数，恢复 CHECK 与函数原文。
- `notification-rollback-prefix.mjs` 与其测试加入 `"0040"`，并对三张新表计数；未知头探针改为 `"0041"`。

## 4. 媒体处理

### 4.1 端口（`packages/media-port/src/processing.ts`）

- `DeliveryProofProcessingPort.process(command)`：下载源图、核验、生成两个产物并上传，返回产物身份。不返回字节，也不返回签名地址。
- `DeliveryProofReadPort.read(command)`：按身份读取一个产物的字节，并核验 checksum 与长度。只在授权之后由应用层调用。

合同放在 `packages/contracts/src/delivery-proof.ts`：命令与结果 schema、产物规格常量、对象键构造函数。

### 4.2 实现（`packages/media-image/src/delivery-proof.ts`）

1. `transfer.download`：先 HEAD 核对 checksum，再预签 GET 流式下载，边下载边做 SHA-256 与长度校验。
2. `readSourceImageMetadata`：魔数必须与声明的 MIME 一致；拒绝动图；像素不超过 4000 万；短边至少 320 px，否则返回 `SOURCE_TOO_SMALL`。
3. `decodeSourcePixels`：完整解码并自动转正，转 sRGB，得到原始像素，元数据全部丢弃。
4. 从原始像素分别缩放，不放大：
   - display：长边 ≤1600，WebP q82；
   - thumbnail：长边 ≤480，WebP q76。
5. 两个产物用 `transfer.upload` 以条件 PUT 写入 SOURCE 桶。键为 `fulfillment-proofs/v1/renditions/<uploadId>/<sha256>.webp`：按内容寻址，所以重试生成不同字节也不会冲突。

预算：`ProcessingBudget` 增加可选的总时限参数（默认仍为 180 秒）。照片处理用 25 秒总时限、10 秒单请求、20 秒单编解码步骤。

## 5. 合同

| 合同 | 变更 |
|:--|:--|
| `delivery-proof.ts`（新） | `deliveryProofRenditionNameSchema = thumbnail \| display`；源与产物身份 schema；处理命令与结果；读取命令；对象键函数；规格常量 |
| `adminOrdersCommandSchema` | 追加 5 个动作（放在联合末尾，存储层按位置引用的既有下标不变）：`BEGIN_PROOF_UPLOAD`（fulfillmentId + 源文件身份）、`COMPLETE_PROOF_UPLOAD`（uploadId，按状态幂等，不带幂等键）、`ATTACH_PROOFS`（行级变更 + `uploadIds` 1–3 个且互不相同 + `privacyConfirmed: true`）、`WITHDRAW_PROOF`（行级变更 + `proofId` + `confirmed: true`）、`VIEW_PROOF`（orderId、proofId、rendition，只读） |
| `adminOrdersResponseSchema` | 新增 `PROOF_UPLOAD_GRANT`（uploadId 与预签 PUT）、`PROOF_UPLOAD`（uploadId 与处理后尺寸）、`PROOF_DOWNLOAD`（proofId、rendition、预签 GET、宽高） |
| `adminOrdersLineSchema` | `proofs`：未撤回的照片，每张含 proofId、sequence、createdAt、宽高；`proofActions`：`ATTACH`、`WITHDRAW` 的子集 |
| `adminOrdersFailureSchema` | 新增 `PROOF_INVALID`（图片被拒）、`PROOF_LIMIT_REACHED`（超过 3 张） |
| `orderAccessItemSchema` | `deliveryProofs`：0–3 个 `{proofId, width, height, thumbnailWidth, thumbnailHeight}`。只有该行 DELIVERED 且不是 VIRTUAL 时才可以非空（refine 钉死）。后台 DETAIL 内嵌同一结构，自动带上 |
| 查单照片读取 | `orderAccessProofCommandSchema`：`{publicOrderId, proofId, rendition, sessionCandidates}` |
| OpenAPI | 后台 5 条路径；粉丝 `GET /api/v1/orders/{publicOrderId}/delivery-proofs/{proofId}/{rendition}`，响应 `image/webp`，安全方案 `OrderSession` |

## 6. 后台

### 6.1 持久化与应用层

- 附加与撤回是纯数据库操作，放进 `adminOrders.execute`，复用既有的加锁顺序、回执重放与 `expectedOrderVersion` 校验：
  - 附加时锁住履约行，校验行状态与已有照片数量；按行内最大序号追加，写入审计、关联行与操作回执；
  - 撤回写入审计、撤回行与回执。
- 开始上传、完成上传、查看照片需要跨事务调用存储，放在应用层新模块 `admin-order-proofs.ts`，模式与资源管理的上传一致：
  - **开始上传**：事务内授权、加锁、做回执重放检查，校验行（实物、PREPARING/DELIVERED、仍有空位），写审计、预留行与回执；提交后签发条件 PUT，有效期取 300 秒、会话到期、预留到期三者中最早的一个。
  - **完成上传**：
    1. 事务内授权，读取预留：必须是本人的；已 READY 就直接返回；RESERVED 必须未过期。
    2. 事务外调用处理端口：不可重试的错误返回 `PROOF_INVALID`，可重试的返回 `TEMPORARY_UNAVAILABLE`，源文件不存在返回 `NOT_FOUND`。
    3. 再开事务重新授权，确认预留未变且未过期，更新为 READY 并写审计。
  - **查看照片**：事务内授权（`orders.read`），读取未撤回的照片；提交后签发 SOURCE 桶预签 GET，有效期取 300 秒与会话到期中较早的一个。
- 权限：开始上传、完成上传、附加需要 `orders.fulfillment`；撤回需要 `orders.manage`；查看需要 `orders.fulfillment` 或 `orders.manage`（理由见决策 7）。全部同时要求 `orders.read`，与既有动作一致。
- 重放与过期：开始上传用同一幂等键重试时，预留仍有效就重新签发 PUT；预留已完成或过期则返回 `CONFLICT`，客户端换新键重来。只有预留时的会话能完成上传。

### 6.2 API 与 BFF

- `admin-orders-route.ts` 的路径表增加 5 行。开始上传、附加、撤回是变更请求，必须带 `Idempotency-Key`；完成上传与查看不带。
- 响应匹配校验新增三种 kind。
- `admin-operations.ts` 增加对应的 5 个操作。组合根把 `MediaStoragePort` 与照片处理器传给后台订单用例；未配置时这 5 个动作返回 `TEMPORARY_UNAVAILABLE`。

### 6.3 界面（`apps/admin/src/management-orders/`）

**"标记送达"改为面板**（新组件 `delivery-proof-panel.tsx`）：
- 显示隐私提示：只有买家本人能在查单页看到这些照片；上传前请裁掉第三方人脸、门牌、地址与快递单。
- 选择 0–3 张照片（jpeg/png/webp），显示本地预览，可以移除。
- 选了照片时必须勾选隐私确认。
- 提交时按张执行：计算 SHA-256 → 开始上传 → PUT → 完成上传；全部就绪后执行附加，最后执行送达。
- 进度与错误就地显示；重试沿用 uploadId 与同一幂等键。

**已送达或准备中的行**：
- 显示"送达照片 n/3"。
- "查看照片"按需签发预签地址，显示缩略图。
- 有空位时可以"补传照片"。
- 经理可以撤回单张照片，需要选择原因并勾选确认。

文案七语言，键集合相同（受 `views.test.tsx` 约束）。

## 7. 粉丝端

### 7.1 API（`order-access-route.ts`）

- 新增第 6 条路由 `GET /api/v1/orders/:publicOrderId/delivery-proofs/:proofId/:rendition`，继承同一组钩子：隐私头、来源与 fetch 元数据检查、禁止查询串、共用 READ 限流桶。
- 处理流程：
  1. 解析 `__Host-fan-order` cookie；
  2. 用例在事务内校验会话 ACTIVE 且属于该订单，照片属于该订单、行 DELIVERED、未撤回、上传 READY；
  3. 事务外经读取端口取回字节并核验 checksum 与长度；
  4. 以 `image/webp` 返回。
- 响应头：`Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox`、`Cross-Origin-Resource-Policy: same-origin`、`Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex`。
- 找不到照片与"不是你的照片"一律返回 401 `ACCESS_DENIED`，避免探测。失败响应仍是 JSON。
- 限流取舍：每张图片消耗一个 READ 单位。WAF 在边缘按客户端 IP 另行限流。运维文档注明 `readMax` 预算要算上图片请求。

### 7.2 BFF 与页面

- 新增路由 `apps/storefront/src/app/api/storefront/orders/[publicOrderId]/delivery-proofs/[proofId]/[rendition]/route.ts` 与 `src/server/order-proof-proxy.ts`：
  - 只接受 GET；来源与 fetch 元数据检查同 `order-proxy`；只转发 `__Host-fan-order`；
  - 响应必须是 200、`image/webp`、长度在上限内（缩略图 512 KiB，大图 4 MiB），并带隐私头；
  - 原样转出字节，附私有响应头。
- `order-detail.tsx`：DELIVERED 且有照片的行，在状态行之后显示"送达照片"。
  - 缩略图是 `Dialog` 的触发按钮，按钮里放 `<img>`，alt 为"送达照片 n / 共 m 张"；
  - 对话框里显示大图与一句说明："工作室在送达时拍摄，只有你能看到"；
  - 声明宽高，避免布局跳动；减少动态效果时沿用 `Dialog` 既有行为。
- 文案七语言，en 源先行，DRAFT，更新审校哈希。

## 8. 安全与隐私核对

| 风险 | 措施 |
|:--|:--|
| 照片进入公开 CDN | 只写 SOURCE 桶的 `fulfillment-proofs/v1/` 命名空间，从不写 derivative 桶；处理器单测断言两个产物的存储类都是 SOURCE |
| EXIF/GPS 泄露 | 从原始像素重新编码；单测用带 GPS 与机型信息的 JPEG 断言产物没有 EXIF、XMP、ICC |
| 他人读取照片 | 必须有 HttpOnly 会话 cookie，且会话属于该订单；proofId 是不透明 UUID；查不到与无权限返回相同结果；禁止查询串 |
| 预签地址泄露 | 粉丝端不下发；后台地址至多 300 秒且按需签发 |
| 误传照片 | 经理可以撤回，写审计 |
| 虚拟礼物 | 附加、上传预留与读模型三处都排除 VIRTUAL |
| 伪造回执或越权 | 延迟触发器在事件时刻重验会话、MFA、权限与审计 |
| 内容类型混淆 | 只接受 jpeg/png/webp 且魔数必须匹配；只输出 WebP；`nosniff` 加 `sandbox` CSP |

## 9. 验证计划

| 层 | 内容 |
|:--|:--|
| 合同 | 新动作与响应的接受和拒绝；照片数量与去重；`deliveryProofs` 只在 DELIVERED 且非 VIRTUAL 时非空；对象键函数；OpenAPI 重新生成 |
| 媒体 | 处理器：EXIF/GPS 去除、方向转正、缩放上限、WebP 输出、SOURCE 存储类与键前缀、MIME 不符、过小、动图、源文件变化；读取端口：checksum 与长度校验；预算总时限 |
| 持久化单测 | 附加与撤回的门控和错误码；读模型只输出已送达且未撤回的照片；SQL 参数绑定 |
| 真实 PG（本机） | 新脚本 `postgres-delivery-proofs.mjs`：键前缀、状态单向、审计与权限一致性、每行 3 张上限、VIRTUAL 拒绝、PREPARING/DELIVERED 门控、撤回、粉丝读模型、有行时拒绝回滚、空库 down/up；并入 `test:postgres`。另跑迁移往返与目录快照（40 迁移）、回滚前缀守卫（含 0040） |
| 应用与 API | 用例编排（事务外 I/O、重新授权、失败映射）；后台 5 条路由；粉丝图片路由的响应头、字节、错误与限流 |
| 前台与后台 | BFF 图片代理的校验；查单页照片区渲染；后台面板的上传顺序与错误 |
| 浏览器（本机） | 复用 `output/checks/f1-03/harness` 的假 API：查单页带照片，390×844 与 1440×900，en/zh-CN/th/vi/es/pt；对话框的键盘与焦点、减少动态效果、无横向溢出、无控制台错误 |
| CI（需要 S3） | WAF 路由与网关正则加照片路径；协议脚本：后台上传、附加、送达后粉丝读取，撤回后读取被拒；随 F1 完成后的草稿 PR 一起跑 |

## 10. 提交拆分

1. **F1-4a 后端**：迁移、合同、媒体端口与实现、持久化、应用、API 路由与组合根、真实 PG 脚本。
2. **F1-4b 后台界面**：BFF 操作、送达面板、照片列表、撤回、七语言文案。
3. **F1-4c 粉丝端**：BFF 图片代理、查单页照片区、七语言文案与审校哈希、本机浏览器验收、CI 脚本与 WAF。

每次提交都要通过 `check:dev` 后再推送。

## 11. 不做与延后

- **邮件不提照片。** 送达邮件在整单送达时发出，照片可能稍后才附加；要提及需要改快照函数与模板版本，收益低。
- **未附加上传的回收，以及撤回照片与订单照片的保留期限**，随隐私政策的保留配置另行实现。对象都在私有桶，不会外泄。
- **后台裁剪工具。** 本期只提示并要求确认。
- **图片读取单独限流桶。** 需要改迁移、合同与部署配置；等有真实流量数据后再定。
