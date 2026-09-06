# ADR-010：原图与角色主图的独立媒体身份

> 状态：Accepted for implementation — P3-01 媒体处理的工程决定
> 日期：2026-09-05
> Owner：Codex `/root`
> 关联：规范 6.5、9.5，ADR-009，P3-01 检查点 2B

## 原因

原始媒体的 checksum、尺寸、对象 key 和授权引用不可变；角色加工也需要独立的二进制身份及审核状态。实际解码实验发现，已符合目标尺寸、无元数据的 PNG 可以与重新编码的角色主图逐字节相同。若继续跨全部媒体使用单一 checksum 唯一键，新主图会与私有原图冲突。借用原图并修改其处理状态或对象引用，又会把上传身份与加工、审核状态混在一起。

同一原图用于人物卡与手机封面时，两张主图尺寸不同，但部分较小的派生图可能逐字节相同；旧变体的 object key 全局唯一，也需要保留明确的所属主图。

## 决定

- `media_assets` 增加不可变的 `identity_kind`：旧行及上传原图默认 `SOURCE`，图片处理创建 `PROCESSED_MASTER`。checksum 在各类别内继续唯一去重，对象 key 继续全局唯一。迁移不修改旧行的既有字段、状态、版权或 metadata。
- 加工仅创建或精确复用 `PROCESSED_MASTER`，不将 `SOURCE` 当作加工主图复用。主图使用私有 `processed/v1/<checksum>.png`，默认版权 `PENDING`，不复制原图 metadata 的批准。
- AVIF/WebP/JPEG 变体使用 `processed/v1/<masterChecksum>/<variantChecksum>.<extension>`。同一主图的同字节产物可重用，不同主图仍能拥有各自完整的 12 个变体引用。旧变体 identity 和唯一约束保留。
- recipe 绑定原图 asset、metadata revision、checksum、构图用途/模式/焦点和处理 profile。结果通过完整字节验证后才在一个短事务中登记主图、全部变体、尝试和任务成功；加工和网络请求在事务外执行。
- PostgreSQL 独立持久任务表负责领取、租约、有限重试和结果，避免向现有支付事件 consumer 混入内容任务。终止任务及产物记录是业务证据，不作为可丢弃队列删除。

## 兼容与回退

新类别是数据库身份维度，不增加公开 API 字段，也不改变现有 schemaVersion 1 合同的含义。旧 SOURCE 的重复 checksum 仍被拒绝；类别不可改写；订单和发布引用仍绑定原来的 asset ID、checksum、key 与 metadata revision。

0012 可在空库和仅有旧内容的数据库中 down/up。已有加工任务、尝试、结果或加工主图时拒绝降级，保留完整历史；不能靠删除任务、重写原图或放宽旧审核来让 downgrade 通过。

## 后续门禁

接入上架前，需从可信字节解码登记原图；上传 key 由服务端分配在原图命名空间，不能占用 `processed/v1/` 保留空间。还需完成管理员权限、主图专属 metadata 与七语言审核，以及原图授权撤销沿 provenance 传播的发布校验。桌面与手机 Hero 的独立确认必须检查原始来源，不能只比较两张加工主图的不同 ID。

自动重试最多六次。终止任务的人工重试/审计接口和无引用半成品对象的回收另行实现，不能直接重置不可变任务，也不能删除仍被其他任务或历史订单引用的同 checksum 文件。当前工程验收只证明本地 PostgreSQL 与 TLS S3-compatible，云端部署和正式发布另有门禁。
