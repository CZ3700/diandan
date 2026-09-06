# 内容发布与缓存恢复

适用 P3-01 4C-2。管理入口仍使用显式 TEST 组合注入本地会话；正式身份发行由后续任务接入。公开 API 已纳入正常 API 组合。本地证据见 `output/checks/p3-01-publication-runtime/`，不代表云 CDN 或生产发布验收。

## 发布顺序

1. 通过作者接口创建或复制 revision，完成真实英语源文及全部七语言的独立审核。别名与结构化礼物详情有各自审核，媒体处理、版权与 metadata 审核彼此独立。
2. 先发布引用媒体的 metadata；新内容发布须引用符合当前发布条件的版本。已发布页面固定引用的旧 metadata 后来变为 SUPERSEDED 时，只要其发布凭证、审核、当前版权和派生图仍有效，页面继续可读。预检 `POST /api/v1/admin/content/publication/preflight` 返回当前 `headVersion` 与 `contentHash`，不会授予后续发布权。
3. `POST /api/v1/admin/content/publication/validate` 提交目标、`expectedVersion`、`expectedContentHash`、`reasonCode`；`Idempotency-Key` 在请求头。仅通过本仓库作者接口创建或复制的 DRAFT 可校验；迁移前的旧 DRAFT 先 COPY 并完成审核，成功返回 VALIDATED 后的新 `contentHash`，公开 head 不变。
4. 使用新 hash 调用同前缀 `/publish`。当前授权、完整证明、生命周期、publication、head、审计、七语言 outbox 与持久缓存任务在同一事务提交。返回成功表示数据库已提交，缓存结果另查。
5. `/status` 接收 `publicationId`，返回七语言任务及所有重试代次。`SUBMITTED` 表示 CDN 已接收请求；只有 `COMPLETED` 才表示获得失效完成结果。缺译、失权、冲突或异常不会留下成功幂等占位。

所有管理读取和写入都重新检查当前会话、MFA、权限、七语言范围及 CSRF。语言与 market/currency 分离；这组公开内容 API 不接受价格上下文。不要把内部 manifest 或供应商引用送到浏览器。

## 回退和重试

- `/rollback` 指定同一 owner 的历史 SUPERSEDED revision，以及当前发布 headVersion 和该 revision 的当前 contentHash。回退追加一条新 publication 并重新检查当前资格；保留旧 revision、审核和 publication。已有 v2 历史复用并验证其不可变 manifest。旧数据的 v1 标记仅来自0018迁移，之后所有新发布一律 v2。
- `/retry` 接收 `publicationId`、失败的 `purgeJobId`、该任务 `expectedVersion`、`reasonCode` 与请求头幂等键。仅 FAILED 可创建下一代；旧任务、尝试和错误码保留。
- 网络超时上限30秒，SQL正常领取租约60秒，总任务10分钟上限可能缩短尾部租约；网络在事务外。数据库拒收已过期租约的迟到结果，客户端超时不代表已取消远端请求。重启后按租约恢复，同一代提交使用稳定幂等键。最多6次网络失败或10分钟未完成转 FAILED。持续 PENDING 轮询不会计作网络失败。
- worker生产组合会启动内容专属 PostgreSQL 持久队列。它只领取绑定 `CONTENT_PUBLICATION_CHANGED` 的任务，不使用旧 generic consumer 的全事件扫描；完成状态来自持久任务及尝试记录，不来自队列 ACK。

## 缓存范围与配置

新公开 GET 返回 `no-store`。HTML 失效路径包含对应语言的 sitemap；首页只失效该语言首页；政策只失效该政策前缀；艺人、礼物和共享媒体失效该语言首页及艺人/礼物目录前缀，因为两类详情包含相互选择入口。这是按依赖目录清理的策略，未实现逐实体 CDN 标签。无全站 `/*`，不清购物车、订单或不可变媒体二进制地址。

CloudFront worker从服务端配置读取 `FAN_SUPPORT_CACHE_PURGE_PROVIDER=cloudfront`、`FAN_SUPPORT_CACHE_PURGE_REGION`、`FAN_SUPPORT_CACHE_PURGE_DISTRIBUTION_ID`，使用环境身份。staging/production缺配置时拒绝启动；本地未配置时任务明确失败，不模拟完成。真实云失效延迟、身份、CDN路由与发布证明仍需部署门验证。

本轮不改变版权事件的外部缓存策略；版权撤销立即影响当前API资格。媒体二进制边缘撤销/清理须由后续部署与运营策略另行验证，不能把内容页面purge当作对象删除证明。
