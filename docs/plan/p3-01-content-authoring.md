# P3-01 基础内容作者接口

本入口说明检查点 3B 的不可变内容版本操作。完整验收结果以 `output/checks/p3-01-authoring/README.md` 和 Phase 3 执行卡为准。

## 操作与数据所有权

| POST 接口 | 操作 | 返回 |
|:--|:--|:--|
| `/api/v1/admin/content-authoring/read` | 读取指定对象和 revision，取得当前作者版本号与内容摘要 | 完整内容、译文审核及继承来源 |
| `/api/v1/admin/content-authoring/create` | 从结构化输入创建新草稿版本 | 新 revision 的安全引用 |
| `/api/v1/admin/content-authoring/copy` | 从服务器保存的版本复制，按需替换结构、媒体、译文、别名或详情 | 新 revision 的安全引用 |

`IDOL/GIFT/MEDIA_METADATA/POLICY` 分别引用已存在的艺人、礼物、媒体资产、政策键；`HOMEPAGE` 为首页单例。稳定身份、variant、价格、库存和二进制上传不属于这三个接口。结构与译文按五种明确的 schema 和 PostgreSQL 表存储，不使用万能 JSON 内容表。

所有请求必须带 `schemaVersion: 1`。HTTP body 不接受 action、actor、会话或幂等键；路由注入动作，当前数据库会话决定操作者，写入使用 `Idempotency-Key` header。原始会话与 CSRF 凭证不进入 URL、内容表、幂等记录、日志或共享缓存。接口由显式 TEST composition 开启；没有生产登录或会话签发能力。

## 版本与冲突

`expectedVersion` 是同一内容 owner 当前最大的 revision 序号，首次为 0。保存生成下一序号和新 UUID；艺人、礼物的 draft pointer 同事务更新。published pointer 和历史内容不变。

COPY 同时绑定 `sourceRevisionId` 和 READ 返回的 `expectedSourceHash`。摘要包含内容、媒体引用、全部译文、当前审核证据和扩展内容。界面遇到 `STALE_VERSION/STALE_CONTENT` 时应重新读取并展示差异，不覆盖他人版本。相同 actor、operation、key 和请求正文返回原安全引用；重放仍检查当前权限。故障回滚后可以使用原 key 重试。

COPY 的 `changes.translations` 只替换列出的 locale。省略的结构、媒体和扩展从真实源版本复制，不能理解为删除。艺人别名可显式替换为空集合；礼物详情没有隐式删除语义。所有保存都是新 revision，已保存版本的正文和结构不提供 UPDATE 接口。

## 翻译与审核继承

- 英语是实际存在的源稿。新内容或显式修改的译文由服务器计算 hash，进入 DRAFT；机器或导入的新稿也只进入 DRAFT。
- 英语发生变化时，未重新编辑的其他语言保留旧来源 hash，因此显示 STALE，不能用旧译文冒充完成翻译。
- 未改变且仍匹配英语源稿的已批准基础译文可以继承审核。保留原编辑者、编辑时间、审核者与审核时间，使用专属 FK 证据关联源 translation 和 approval。复制操作者记录在新 revision 与复制审计中。
- 原本没有批准的逐字复制内容在新版本中重新进入 DRAFT。版本作者记录不代表重新进行了人工翻译。
- 别名与礼物详情在新 revision 中创建新集合、document、translation ID，绑定当前作者并全部重新 DRAFT；不能借用旧 description 或其他结构的批准。详情沿用 0013 的实际英语来源一致性约束，本轮不新增 STALE 详情的存储状态。

完整 READ 需要其实际内容涉及的语言权限。COPY 可以通过安全结果引用完成局部翻译修改；英语变化、结构/媒体变化，以及扩展重新署名会扩大所需语言范围。基础译文的审稿界面、按单语言读稿/提交、发布和回退继续由后续内容流程接入；已有 3A 扩展审稿接口保持独立。

## 数据库与排障

0015 的作者收据固定新版本及其复制来源的内容；关联子项和扩展头不能在收据之后追加或修改，审核事件仍可追加。五种专属翻译继承表验证原文、locale、英语来源、owner、原始三步审核链及 localized labels 完全一致。已有作者或继承历史时，down migration 拒绝删除证据，应采用向前修复。

时间来自数据库，并以锁定历史作为因果下限，不能假设连续两次墙钟读取单调递增。读稿固定 UTC 和原始微秒，避免数据库会话时区改变内容摘要。作者输入的政策生效时间最多六位小数且 UTC 年份为 0001–9999，媒体焦点最多五位小数，防止数据库静默舍入。不要通过改系统时钟、放宽历史顺序校验或重复重试来掩盖时间问题。

本轮回归也修正了媒体 attempt 的完成时间下限。到期测试应先证明事务在有效期内开始，再根据数据库时间有界等待实际到期；固定 sleep 不能证明会话或租约已经过期。确定性回拨测试在受控查询中注入较早时间，保留正常触发器和约束。

收据的 `changed_paths` 只存结构化字段路径，关联审计与结果 revision，不复制正文。SERIALIZABLE 并发冲突返回 409；只会成功创建一个对应版本，客户端应重新读取后处理冲突。

常用验证命令：

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test:postgres:content-authoring
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:content-authoring
mise exec node@24.20.0 -- corepack pnpm check
```

浏览器证据需要在源文件停止修改后，顺序运行既有 composites 和 motion browser scripts；运行中增改源码会让证据与最终代码不一致并被门禁拒绝。独立测试通过不替代完整 check、真实发布 ≤60 秒、云 CDN、生产身份或 staging 证据。

新增迁移后，还要检查回归脚本中不指定 targetVersion 的 up 与固定 confirmVersion 的 down/终点断言是否同步更新；明确测试历史版本的脚本保持其原 targetVersion。浏览器一致性门禁也比较完整 git 文件清单，因此 README/JSON 等证据文件应在执行前创建，运行时只更新已存在文件或忽略的日志。
