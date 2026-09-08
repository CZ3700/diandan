# 管理编排与当前发布读取：S.U.P.E.R 收尾复核

作者：`/root/storefront_read`。本记录针对本轮管理合同、Application、operation 持久层、私有 API、TEST 装配，以及追加的三个搜索/目录/SEO 查询模块。它是作者的有界代码复核，不等同于独立安全审计、完整 PostgreSQL/浏览器验收或阶段完成。

对 daily publication 的 Domain / PG 实现仅作非作者接口和当前证明读取核对；其完整测试与迁移由 directory/root 负责。用户明确授权的 DIRECT_OPERATOR_V1 原文策略高于旧技能中必须七译审核的流程条款；本次未伪造译文或另一审核角色。

| # | 检查 | 结论与依据 |
| --- | --- | --- |
| 1 | 模块职责单一 | PASS。合同定义输入/输出；Application 负责单次提交和持久任务编排；operation 仓储负责状态；独立 daily publication 负责业务原子发布；HTTP 仅校验与传输；TEST composition 仅装配。 |
| 2 | 函数围绕一个概念 | PASS。worker 的一次执行是 claim → media prepare → 当前 claim 重验 → 同事务 publish/complete；媒体等待与显式重试委托独立 port。搜索 writer 仅生成一条原文投影，未扩成新的工作流框架。 |
| 3 | 单向依赖 | PASS。Route → Application → Domain/Port → Adapter；Application 不导入 PG/Next。读取阶段先有界枚举，再由现有 current proof 完整投影。 |
| 4 | 无新增运行时循环 | PASS（本范围静态复读）。API runtime 对 bootstrap 的引用是 type-only；PG composition 创建 adapter；Domain 不反向依赖 adapter。未宣称跑过全仓循环检测。 |
| 5 | 接口有严格合同 | PASS。管理命令/结果和内部 claim/checkpoint 均有 Zod；请求和响应均校验。发布 receipt 必须绑定预期目标与真实 targetVersion；response 的 PUBLISHED 与 result 一致。 |
| 6 | 模块 I/O 可序列化 | PASS。命令、任务状态、checkpoint、媒体引用、receipt 均为 JSON 数据；数据库/媒体/lifecycle 函数只在进程内依赖注入。队列不持久化原始 session/CSRF/授权 token。 |
| 7 | 配置无正式硬编码 | PASS。市场、币种、库存及艺人呈现来自实际 PG 配置；媒体 origin、会话 pepper 与 TEST 资源为显式输入。固定 API 路径和协议枚举不是站点配置。 |
| 8 | 依赖显式 | PASS。复用现有 workspace 包、Node crypto、Zod 与现有 PG/media ports；无新增外部 dependency。 |
| 9 | 可替换实现 | PASS。management / media / publication 均以 port 注入；TEST composition 使用实际 adapters，并允许有界测试工厂替换连接来源。无客户端多命令业务数据库。 |
| 10 | 所有检查完成 | **PARTIAL**。本范围定向 tests、format/lint、API/PG 类型与四包构建通过；实际 PG/S3/管理浏览器、恢复故障、全仓 check 由 root 进行中。不得将它写成全部通过或 P3-06 DONE。 |

## 当前证明与兼容性

- 日常搜索只保存真实 source translation id/source hash/document hash 和一个规范化名称；没有 APPROVED 字段或七份语言副本。daily projection 对错绑或缺失保持目录不可用。
- 旧译文目录保持 proof 1/2；别名继续要求 proof 2 的实际审核与 hash。directory 的独立复审指出最初 proof 2 限制会漏掉 proof 1，已另存 2 项 RED 并修为 IN(1,2)，未放宽别名审核。
- 礼物候选维持真实身份、revision、价格簿半开时间窗、库存和艺人资格；ALL_ACTIVE_ARTISTS 是当前真实规则，不枚举或写入虚假资格行。proof 3 候选不依赖不存在的翻译记录，后续仍经真实 current proof hydration。
- SEO 的 HOME/IDOL/GIFT 枚举接受 proof 2/3，政策仍为原 proof 2。catalog version 包含实际 daily document/manifest；来源回退的语言不进入可索引 locale 集合。异常不会伪装成成功的空目录。
- 发布仓储失败会回滚其 savepoint；成功发布和 operation complete 在同一 SERIALIZABLE 事务。未知提交结果返回 UNAVAILABLE，并依赖持久状态恢复，不写“已发布”或制造重复目标。停止本地循环时等待正在执行的处理后关闭池。

## 小范围 code-simplifier 复核

未增加通用引擎或重写现有投影。新增 daily 搜索共用一个私有 document 校验/upsert 函数，维护重建另走有限 keyset；公开 writer 仍明确接实际 manifest。TDD 完成后，将测试的临时反射函数查找恢复为直接、受类型检查的导出绑定。保留显式失败分支和原有校验，不通过删除断言或重试掩盖错误。

跨作者复读发现了派生摘要按 codepoint 截断与既有 UTF-16 字段上限不一致：已交 directory，作者报告独立 1 RED→1 GREEN，正文原文不改。普通文本 `<3` 与旧 controlled HTML 的兼容边界已交 root 处理，本记录不把其后续实现或真实验收算作作者验证。

## 可追溯证据

- `daily-search-seo-red.log`：5 FAIL / 10 PASS；`search-legacy-compat-red.log`：2 项兼容回归失败。
- `search-legacy-compat-green.log`：3 文件 / 15 tests PASS；相邻 format/check/lint 日志 exit 0。
- `persistence-composition-green.log`：2 文件 / 20 tests PASS；`test-composition-first-green.log`：3 文件 / 7 tests PASS。
- `api-typecheck.log`、`postgres-typecheck-final.log`：exit 0。
- `backend-build-fourth.log`：content → Application → PG → API 顺序构建全部 exit 0。
- 管理合同、任务幂等、目标绑定、显式重试及关闭的此前日志见 `backend-orchestration-README.md`，有效 RED 不覆盖。

结论：本作者范围可交给 root 进行真实集成验证，**整体验收仍未完成**。当前没有生产发布、staging、正式资料或人工任务通过的主张。
