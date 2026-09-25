# 管理中心后端编排（作者验证记录）

本文件记录 `/root/storefront_read` 的管理合同、Application、任务持久层、私有 API 与 TEST 装配。它不是 P3-06 DONE、实际 PostgreSQL 发布成功、浏览器验收或生产发布证明。单源 publication v3 / 0022 与实际内容和价格发布由 directory 实现；媒体加工准备由 root 实现，本文不把其结果算作作者独立验证。

## 已冻结的入口

- `createManagementCenterUseCases({ transactions, tokenPepper, resourceManagement })`：实际会话与 CSRF 摘要授权；单次提交使用永久的操作者与幂等键记录。原文 `sourceLocale` 不伪装成其他语言，不创建审核人。
- `createManagementCenterOperationRepository(client, scope, publicMediaBaseUrl)`：真实 PostgreSQL operation / 当前授权 / 有界管理列表。
- `createManagementCenterWorker({ transactions, media, createLeaseToken, leaseSeconds })`：媒体准备完成后，在同一事务内调用 publication 与 operation complete；不确定提交不误报成功，也不覆盖为失败。
- `ManagementCenterPublicationRepository.publish({ schemaVersion: 1, operationId, leaseTokenDigest, preparedMedia })`：发布仓储重新载入真实 grant。返回 `headVersion` 与 `targetVersion`；公开 `result.version` 使用真实目标版本，艺人/礼物为身份版本，首页为 head 版本。
- `prepareMediaMetadata({ schemaVersion: 1, operationId, leaseTokenDigest, assetId, processingJobId })`：SOURCE 使用 null job，DERIVED 使用当前操作 checkpoint 的真实成功 job。
- `createTestManagementCenterComposition({ environment: "TEST", database, tokenPepper, allowedOrigin, publicMediaBaseUrl, storage, inspector, processor, pollIntervalMs?, leaseSeconds? })`：返回 `managementCenterRoute` / `managementCenterRuntime`，借用实际媒体 ports，自有数据库及循环；停止时等待 in-flight 工作再关闭。

API 为私有 POST `/api/v1/admin/management/{context,list,uploads/prepare,submit,operations/read,operations/retry}`。外层 action / 凭据 / Idempotency-Key 由 transport 注入；查询参数、未知字段和伪造 actor 均拒绝。浏览器只准备上传、PUT 原图、提交一次、读取或主动重试；没有审核与几十个资源命令串联。

## 当前边界

- 新建艺人必须有图；编辑可保留当前图。名字上限艺人 40、礼物 100，说明 600；不静默截断。
- 礼物类型与 TRACKED / PROCURE_ON_DEMAND / PREORDER 独立。新单规格使用真实 ALL_ACTIVE_ARTISTS 规则。旧显式艺人范围或多规格记录诚实显示 `canEdit: false`，不扩大旧资格。
- 列表从当前身份与真实 revision / price / inventory 表读取，不从 operation intent 充当商品真相源。默认市场、币种及库存设置来自 PostgreSQL typed config；缺省保持 null。
- operation 对浏览器只有 PROCESSING / PUBLISHED / FAILED、版本、目标引用及安全失败码。原会话/CSRF 不存队列。内部仅存真实 actor/session ID、不可变意图与摘要、到期和租约摘要。
- `retryRequested` 只在实际操作者主动重试后为 true，媒体准备消费后恢复 false；版本冲突不宣称可盲重试。
- 海报历史的过期图片保持历史条目，图可为 null，禁止展示可恢复；真正恢复仍重验当前媒体与 publication。
- 公共素材只来自当前允许的 PROCESSED_MASTER / READY / APPROVED 变体，校验媒体来源且不返回对象 key。

## 已执行的定向证据

以下是作者运行的真实本地测试，不包含真实 PG/S3 或浏览器：

| 范围 | 最近日志 | 结果 |
| --- | --- | --- |
| 管理合同 | `contracts-final.log` | 2 文件 / 15 tests PASS |
| Application | `target-version-green.log` | 11 tests PASS |
| PG 仓储与读取单测 | `postgres-unit-final.log` | 2 文件 / 10 tests PASS |
| 私有 HTTP route | `api-final.log` | 2 tests PASS |
| 自有循环关闭 | `runtime-green.log` | 3 tests PASS |
| TEST API 装配及循环/路由 | `test-composition-first-green.log` | 3 文件 / 7 tests PASS |
| PostgreSQL 事务装配及原回归 | `persistence-composition-green.log` | 2 文件 / 20 tests PASS |
| 单源搜索、目录与 SEO | `search-legacy-compat-green.log` | 3 文件 / 15 tests PASS |
| API 类型检查 | `api-typecheck.log` | exit 0 |
| content / Application / PG / API 顺序构建 | `backend-build-fourth.log` | 4 包 exit 0 |
| 范围 ESLint | `composition-lint.log` | exit 0 |
| 范围格式化 | `composition-format.log` | exit 0 |

初始失败和有效回归失败均保留：`contracts-red.log`、`application-red.log`、`postgres-unit-red.log`、`api-red.log`、`openapi-red.log`、`runtime-red.log`；字段限长、上传重放、显式媒体重试、错误 operation/fence、发布目标、目标版本与冲突分类的 RED→GREEN 分别在对应日志中。

## 当前装配与原文搜索

`persistence-composition-red.log` 与 `test-composition-red.log` 是新装配的初始 RED。真实 `createDailyPublicationRepository` 落盘后，装配测试、旧事务回归和四包构建已通过；未使用替代业务 stub。PG 两个新 manager 均通过原 transaction runner 使用 SERIALIZABLE，同一个 client 上绑定 operation / daily publication，媒体 manager 另绑定现有 resources。TEST composition 顺序驱动实际媒体处理与管理任务，停止先等待正在执行的工作再关闭自有池。

`daily-search-seo-red.log` 为 5 项有效失败，后续 15 tests 通过。非作者复审发现旧 proof 1 迁移目录的兼容问题，另保存 `search-legacy-compat-red.log` 两项失败，再修复并保留完整 GREEN。原译文主分支保持 proof 1/2，正式别名仍只接 proof 2 的审核/hash；proof 3 单独关联 daily 原文与一条 normalized search projection。缺失或错绑 projection 仍使目录明确不可用。原文搜索投影是可重建数据，保存 source id/hash、document hash，不复制七份、不写 APPROVED。日常 IDOL 发布在同一事务内调用新 writer，维护命令另按 256 条 keyset 重建日常原文。

礼物目录使用真实当前 revision、价格簿与库存，日常发布解除对不存在译文行的依赖；ALL_ACTIVE_ARTISTS 读真实当前艺人资格。SEO 只为 HOME/IDOL/GIFT 增加 proof 3 枚举，政策仍保持 proof 2。当前 proof 投影只把真实原文 locale 放入可索引 cluster，其余原文回退不伪装成翻译。

早期构建日志包含 dist 尚未刷新及共享 legacy/v3 union 的诊断，均保留；最新构建以 `backend-build-fourth.log` 为准。全仓与真实运行验收仍须由 root 统一完成。

后续必须由 root 运行真实 0022 上下迁移、正常身份授权、实际原图对象存储/加工、单次提交与幂等恢复、内容/价格同事务可见、失败/撤权/旧商品保护，再进行管理中心浏览器矩阵。当前未启动任何 PG 服务、Next 或全仓检查。
