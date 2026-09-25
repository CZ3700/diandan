# P3-01 / 3B 基础内容作者流程

状态：**3B 已通过本地验收**。P3-01 仍为 IN_PROGRESS；本文件记录本轮实现与证据，不代表完整内容发布链路或正式上线。

本轮实现五类既有内容 owner 的不可变版本创建、复制和局部译文编辑，复用当前管理员 session/MFA/RBAC/语言权限、审计及事务幂等。公开发布、基础译文审稿与后台 UI 仍是后续工作。

运行入口：`docs/plan/p3-01-content-authoring.md`。

## 实际交付

- 3 个管理 POST：read/create/copy。艺人、礼物、首页、政策和媒体说明使用独立类型与专属表；四类稳定 owner 必须已存在，首页为单例。所有编辑生成新 revision，不覆盖原有正文、结构或审核历史。
- 实际英语源稿和最多七语言，支持只替换某个 locale。英语修改后，未更新的基础外语译文保持旧来源 hash，呈 STALE；原样、当前且已批准的基础译文通过精确复制证据保留原编辑者与审核链。新稿、显式修改、机器/导入稿均重新 DRAFT。
- 别名和商品结构化详情复制为新集合/文档与新译文 ID，并重新 DRAFT。详情沿用 0013 实际英语来源一致性约束，本轮没有新增非法 STALE 详情持久化或批准继承。
- 同事务校验当前 session/MFA/RBAC/语言权限、源内容摘要、owner 版本、幂等与审计。完整 READ 授权全部实际语言；局部 COPY 的授权范围随英语、结构/媒体与扩展修改扩大。重放仍验证当前权限，返回安全 revision 引用。
- 0015 新增 6 张专属作者收据/译文继承表。收据固定新版本及其复制来源的内容，关联子表和扩展头不能在保存后偷偷追加或修改；审核事件仍允许追加。SQL 验证原始三步批准链、locale、owner、英语来源、localized labels 和审计的精确关联。已有历史时拒绝破坏性 down。
- 审计关联具体 changed_paths；只保存 schema 字段路径，不复制正文。UTC 微秒与历史因果下限稳定数据库读写；作者输入拒绝超过数据库精度的媒体焦点和政策时间。
- 新增 8 个 versioned roots，共 233 定义；原有 225 定义 deep-equal 不变。复用旧校验逻辑，未增加依赖或第三方业务 SaaS。

## 验证命令与结果

所有命令前缀均为 `mise exec node@24.20.0 --`。

| 检查 | 命令 / 证据 | 结果 |
| --- | --- | --- |
| 受影响测试 | `corepack pnpm --filter @fan-support/contracts --filter @fan-support/content --filter @fan-support/application --filter @fan-support/persistence-port --filter @fan-support/persistence-postgres --filter @fan-support/api test`；`targeted-tests.log` | 886 PASS：228 / 131 / 175 / 4 / 292 / 56 |
| 合同兼容与生成 | `corepack pnpm contracts:generate`；`compatibility.json`、`contracts-generate-final.log` | 233 定义，225 旧定义不变 |
| 数据库迁移 | `node packages/persistence-postgres/scripts/postgres-integration.mjs --write-catalog`；`catalog-write.log` | 15 迁移 / 130 表，up/down/up PASS |
| 作者真实 PostgreSQL | `node packages/persistence-postgres/scripts/postgres-content-authoring.mjs`；`../p3-01-content-authoring/postgres-green.log` | 211 断言 PASS，五类/七语言/正常触发器 |
| 作者真实 HTTP | `corepack pnpm --filter @fan-support/api test:postgres:content-authoring`；`../p3-01-content-authoring-http/postgres-http-green.log` | 909 断言 / 114 请求 PASS；完整检查中再次运行 |
| 媒体因果时间补验 | `node packages/persistence-postgres/scripts/postgres-media-processing.mjs`；`../p3-01-media-clock-rollback/postgres-green.log` | 152 断言 PASS，含三种结束状态的固定回拨、真实 lease/backoff |
| 组件浏览器 | `node scripts/verify-ui-composites-browser.mjs`；`browser-composites.log` | 16 场景 / 18 PNG / 10 axe scans，无 critical/serious；原生 Chrome 200% 缩放通过 |
| 动效浏览器 | `node scripts/verify-ui-motion-browser.mjs`；`browser-motion.log` | 8 场景 / 22 PNG / 3 axe scans，无 critical/serious；键盘与 reduced motion 通过 |
| 全仓检查 | `corepack pnpm check`；`check.log` | exit 0；typecheck 56/56、test 56/56、build 35/35（分别 56/56/35 cached）；31 package exports 与真实 PG/HTTP/TLS S3/worker 423 联合断言通过 |
| secrets / diff | `corepack pnpm security:secrets`、`git diff --check`；`secrets.log`、`diff-check.log` | exit 0 |
| 独立复核 | `independent-review.md` 与两个相邻 Application/HTTP 说明 | ACCEPT |

本轮查看了最新 390×844 越南语和 1440×900 日语组件截图，版式、文字与主图正常；浏览器产物分别在 `output/playwright/p2-04/`、`p2-05/`。它们验证已有视觉基线，不能当作新后台编辑 UI 或真机记录。

## 已复现并修正的问题

- 合同先行 RED，以及版本安全整数、双端 Hero 不同来源、焦点五位精度、政策微秒/UTC 年界均有失败测试；对应 `*-red.log` 和最终合同 GREEN。
- 显式 NFC/NFD 字节变化不能继承旧批准，也不能被相同 key 的规范化 hash 错误重放；纯层审核与新作者命令摘要分别 RED→GREEN，旧 shared/3A hash 未修改。
- 真实并发 COPY 的幂等 begin 返回 TRANSACTION_ABORTED，旧映射误报 503。新作者 begin/complete 返回 409，真实 HTTP 严格验证一成功、一冲突且只新增一个版本；没有自动重试或放宽预期。
- 数据库会话时区改变 snapshot hash、审计缺少变更路径、字段路径 NFC 归一化遗漏真实编辑，均保存 RED 后修复。2036 年未来审核与六位微秒、来源子表等待后拒绝变更、伪造复制证明、审计失败全量回滚及同请求恢复均有真实 PG 断言。
- 可转换为字符串的错误 pepper 配置会提前创建连接池，已增加严格 typeof 前置校验；RED→GREEN 验证非法配置下工厂零调用。
- 首次完整 check 的旧目录回归仍从 0014 回退，而当前已应用 0015，保护检查正确拒绝。目录脚本新增 0015 down 并将最终恢复断言更新为 15/0015，随后 307 条真实目录断言通过；其他明确固定 targetVersion 的旧回归保持原样。失败保留在 `check-first.log`。
- 独立媒体回归复现旧 `finished_at < started_at` 的 SQLSTATE 23514。保持原约束和正常触发器，仅对结束语句注入早一秒时间得到确定性 RED；生产增加开始时间下限后，SUCCEEDED/FAILED/EXPIRED 的精确微秒值均通过，完整媒体 PG 增至 152 断言。没有改动租约、重试策略或 0012。3A 到期测试改为真实数据库到期条件和单调有界等待，授权只执行一次，109 断言通过。
- 第二次完整 check exit 0，但该执行途中补入了媒体因果时间修复；最终以源码冻结后再次执行的 `check.log` 为准，第二轮保留为 `check-second.log`。媒体与旧 harness 修改不影响浏览器渲染输入，最终全仓门禁再次验证两组浏览器指纹。
- 前两次组件浏览器执行在最终工作区一致性检查被拒绝：第一次源码仍在变更，第二次新增 `implementation-source.json` 改变完整 git 文件清单。保留 `browser-composites-first.log` / `browser-composites-second.log`；最终先创建全部证据文件并停止代码修改，再顺序运行两个脚本通过，未放宽门禁。

## S.U.P.E.R

| # | 检查 | 依据 |
| --- | --- | --- |
| 1 | 模块单一职责 | 合同、纯计划/hash、Application、幂等、SQL loader/writes/diff、route/composition 分离 |
| 2 | 函数职责明确 | 显式五类映射与审核继承步骤，复用已有 ICU/详情验证，无万能服务重构 |
| 3 | 单向依赖 | Route → Application → Domain/Port → Adapter；边界脚本验证 |
| 4 | 无循环依赖 | typecheck/build 和架构边界检查 |
| 5 | schema 边界 | 新增八个 versioned roots，所有命令和响应严格 parse |
| 6 | 可序列化 I/O | 计划、快照、端口和安全结果引用均为可序列化值 |
| 7 | 配置外置 | 数据库、Origin、pepper 注入；无正式域名、身份或支付值硬编码 |
| 8 | 依赖声明 | 无新依赖；使用已有 Node crypto、Zod 与 PostgreSQL adapter |
| 9 | 可替换模块 | Application 只依赖内容纯规则和事务/repository ports；路由可注入 useCases |
| 10 | 完整验证 | 最终 check exit 0；受影响 886 tests、实际集成、浏览器及独立复核通过 |

## 交接与限制

下一入口是 `docs/plan/p3-01-content-runtime.md` 检查点 4：基础译文按语言读稿/提交/独立审核、五类内容的短时只读 preview、政策 owner 初始入口，完整验证、发布/回退、当前 head 的版本化公开扩展 DTO、outbox 与缓存清除及本地 ≤60 秒可见性。艺人/商品管理任务继续包含自身所需 API，不局限于 UI。

当前仅显式 TEST composition；不包含稳定 owner/规格 CRUD、生产登录签发、后台编辑 UI、云 CDN、PSP、staging、远端 CI、实际发布或新的手机真机证据。新扩展发布拒绝门仍保留，P3-01 未整体完成，其他任务不解锁；49 项计数为 17 DONE / 1 IN_PROGRESS / 31 PENDING。

S.U.P.E.R 10 项全部 PASS。`implementation-source.json` 绑定 837 个工作区源码/测试/迁移/生成输入（包含此前未提交工作），排除文档与验证产物以避免循环哈希。最终指纹 `c2e633e867dab434f1400c18ea96a0bee35f5f8d45e66fd4d914726d5d2de009` 未变化，见 `source-final.log` 与 `validation.json`。最后只同步文档与证据，没有再次修改实现源码。
