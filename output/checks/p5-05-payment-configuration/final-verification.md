# P5-05 本地完整验收

日期：2026-09-22。基线 `fb89c3a4029083b6c6495dd8c581c1b2e4db88aa`，分支 `codex/p5-05-payment-configuration`。本轮只领取 P5-05，root 负责合同、领域、整合和最终质量门；三位协作者分别负责持久化、应用/API/runtime、Admin/UI，并交叉复核非本人实现。

## 交付范围

- 同一管理中心新增支付设置：草稿编辑、七语言渠道名称/提示、当前权限控制、独立译文审核、实际前后差异、二次确认发布与恢复历史版本。
- PostgreSQL 保存不可变配置、审核证据、校验事实、永久幂等回执及审计。只调整规则且原文完全未变时，可以继承同账户已发布版本的真实审核链；不会要求运营无意义地重审，也不会伪造新审批。
- 发布与回退同时切换已部署账户目录和健康策略。历史支付、退款、UNKNOWN 继续绑定原账户；数据库配置不能上传代码、改变凭据或自行确认支付成功。
- 每个服务进程独立读取权威发布版本；暂时失败保留上一份完整配置，超时有界，恢复后继续同步。新渠道的托管付款响应按当前可信地址集合校验，旧渠道地址保留，未知地址拒绝。
- 七语言窄屏导航改为按可读最小宽度自动分列，修复西班牙语文字超出按钮。其余共享导航与视觉基线保持。

## 可重复命令与结果

本机命令统一使用 `mise exec node@24.20.0 --`，pnpm 为 11.25.0。日志原件在本目录；可提交文本副本与双 SHA 对应关系见 `log-transcripts.json`。

| 检查                                                 | 观察结果                                                                                                                | 证据                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `corepack pnpm check:dev`                            | exit 0；format/lint；typecheck 64/64、test 64/64、build 36/36，缓存分别 62/62/34。这里是任务图数量                      | `check-dev-final.log`                                                  |
| `corepack pnpm check:contracts`                      | exit 0；生成件与合同一致                                                                                                | `contracts-last.log`                                                   |
| contracts Vitest                                     | 89 files / 510 tests PASS                                                                                               | `contracts-final.log`                                                  |
| 新配置真实 PG runner                                 | PostgreSQL 18.6，151 checks；0036 up/down/up、catalog、并发、权限、审核复制、校验失效、历史/审计、防 SQL 绕过、超时恢复 | `storage-final.log`                                                    |
| 旧 rollback-prefix 实际 PG tests                     | 47 tests PASS，保留不可逆历史保护                                                                                       | `rollback-prefix-postgres-final.log`                                   |
| 原财务 HTTP runner                                   | 6,164 = 5,763 setup + 401 scenario；协议自身计数 399，非另一组可累加总数                                                | `legacy-finance-http.log`、`regressions/legacy-finance/`               |
| 新配置 HTTP + 浏览器                                 | 6,660 = 5,763 setup + 897 scenario；其中协议 313、浏览器 466；exit 0                                                    | `http-ui-final.log`、下方 accepted run                                 |
| adapter 边界测试/最终产物检查                        | exit 0；内部层不依赖具体 PSP，32 package exports 可被 Node 导入                                                         | `adapter-boundary-tests.log`、`adapter-last.log`、`artifacts-last.log` |
| `corepack pnpm install --offline --frozen-lockfile`  | exit 0；lock 只新增声明过的 gateway workspace 依赖                                                                      | `frozen-install-final.log`                                             |
| `corepack pnpm security:secrets`、`git diff --check` | 最终结果与退出码记录于 `final-gates.json`                                                                               | 最终秘密扫描日志及收尾记录                                             |

真实配置 PG 复验入口：

```sh
pnpm --filter @fan-support/persistence-postgres test:postgres:payment-configuration
pnpm --filter @fan-support/api test:postgres:admin-payment-configuration
pnpm --filter @fan-support/api test:browser:admin-payment-configuration
```

默认实际 PG 使用隔离 Docker。此宿主机早前 Colima guest 墙钟阶跃会影响权限时间断言，最终集成使用独立原生 PostgreSQL 18.6；API runner 接受 `ADMIN_PAYMENT_CONFIG_TEST_POSTGRES_BIN`，持久化 runner 接受 `--native-bin`。只创建自有临时集群，不连接用户已有数据库。`storage-final.log` 的 `25P04` 是故意持锁触发的事务超时，随后明确验证恢复。

没有运行整条 `pnpm check`，也没有声称重复运行全部历史独立 PG/S3/queue runner。实际 TLS S3、OIDC、Worker 与支付链路由本轮集成组合覆盖；构建和浏览器是不同的检查。

## Accepted run

`integration-2026-09-22T06-40-07.476Z/`：真实原生 PG 18.6、TLS OIDC、TLS S3、两个独立 API 子进程及独立持久 TEST PSP。`scope.json` 明确 `actualPspSandbox=false`、`realMoney=false`。

- 协议 313 项通过。观察 PID 为 89585 / 89673；后者是第二节点重启后的 PID，场景另外断言其与原 PID 不同。两个节点各有独立 pool、registry 与生命周期。
- 发布、停止新流量、回退的双节点传播为 876.594 / 924.426 / 928.637 ms。**夹具轮询为 1 秒，生产默认为 10 秒**；不能把这些测量宣传成默认环境的 1 秒保证。
- generation 2→3→4；新 B 健康策略 version 1→2→3，threshold 3→5→3；旧 A version 1 始终保留。持锁至两节点均观察到有界失败为 10.757 秒，包含调度等待；释放后自动同步。
- 旧 A 的 UNKNOWN 恢复保持原账户、原 attempt 和请求身份，A PSP 付款记录没有增加；新 B 恰好接受一笔 TEST 付款。丢失发布响应后同键重试只保留一次新发布。这证明本场景没有重复 PSP 接受，不冒称真实金融机构扣款保证。
- 浏览器 Chromium 153.0.8010.53，`en/zh-CN/th/vi/ja/es/pt`，390×844 与 1440×900。8 类交互、466 断言、65 PNG、65 axe；违规 0、incomplete 0、页面错误 0，完整截图 SHA 见 `accepted-browser-artifacts.json`。
- 覆盖设置/编辑/缺审核错误、只读权限、键盘/reduced motion/网络失败恢复、含英文的独立审核、发布/回退丢响应后刷新沿用原键、返回菜单刷新数据、仅改规则复用审批。所有捕获检查无横向溢出且每行导航文字在按钮范围内。
- 浏览器发布/回退的额外传播计时从恢复请求后等待确认开始，不能解释为完整人工操作耗时。浏览器使用 Next 开发服务器；最终 production build 是前述独立质量门。
- root 实际查看最终西语手机设置、中文手机编辑、英文桌面设置；UI 非作者复核另覆盖泰语、越南语和葡语。没有实体手机或真人读屏结论，源 UI 译文仍为 DRAFT，正式批准保留。
- runner 已 exit 0 并完成 owned teardown；`cleanup-verification.json` 记录两 API PID 已不存在，Next 自动生成文件恢复且源冻结未变化。

## 兼容、源码与原件保护

`protection-final.json`：原 5,958 未跟踪文件逐 SHA 保持；679 旧 schema roots / 113 旧 OpenAPI paths 结构相同，现共 690 / 120；原 70 SQL 字节不变，35 manifest 条目是当前 36 的原样前缀；当前 catalog 为 198 tables。

最终源输入 2,530 文件，`candidate-source-final.json` SHA-256 为 `3c48d45f95541512ad64ca5d9f1f0c2ec3cdbbf4f1fcea7968b276c93bf54233`。相对最终质量门后的源快照没有变化。较早候选与最终门之间仅有手机导航声明、浏览器文字边界断言、协议错误码期望及 TEST branded 字段修正，见 `candidate-source-delta.json`；最终门和完整浏览器已覆盖。

失败原件和修正原因见 `failure-history.md`：包含真实动态 origin 缺陷、大小写 UUID、数据库审批/文档约束、probe race、全量 diff 容量及西语导航，不把安装等待/解析失败冒充有效 RED，也不抹掉最初不通过的浏览器结果。

## 非作者复核与 S.U.P.E.R

`storage-review.md` 复核合同/应用/runtime及真实双进程协议；`runtime-independent-persistence-review.md` 复核 PG 实现；`ui-independent-review.md` 复核合同/领域/应用/API；`ui-verification.md` 复核真实界面，root 完成组合与兼容检查。没有尚未解决的本地实现发现。

| #   | 检查         | 结论与证据                                                                    |
| --- | ------------ | ----------------------------------------------------------------------------- |
| 1   | 文件单一职责 | PASS；transport、authoring/read/publication、diff/validation、UI 分别处理职责 |
| 2   | 函数单一概念 | PASS；复核后只做小范围声明/读取清理，接口与行为不变                           |
| 3   | 依赖向内     | PASS；Browser/Route → Application → Domain/Port → Adapter                     |
| 4   | 无循环依赖   | PASS；workspace/domain/adapter 边界及构建门                                   |
| 5   | 明确合同     | PASS；11 新 root、7 路径，历史合同保持                                        |
| 6   | I/O 可序列化 | PASS；strict schemaVersion DTO，凭据留在部署适配器                            |
| 7   | 环境配置外置 | PASS；运行 URL/凭据/账户由验证后的部署输入提供，TEST 配置仅存在夹具           |
| 8   | 依赖声明     | PASS；API gateway workspace 依赖、冻结安装                                    |
| 9   | 可替换端口   | PASS；管理仓储、runtime 目录、PSP adapter 通过独立边界组合                    |
| 10  | 任务要求验证 | PASS；上述本地组合门、实际集成、七语言双端及独立复核；生产门另列              |

## 状态与下一入口

本地范围验收完成；按 ADR-016，P5-05 仍为 IN_PROGRESS、释放 Lane C executor，因为正式商户能力、关键七语言文案批准和实际环境配置尚待对应经营/运营/部署负责人提供。P5-06 原直接依赖 P5-01/P1-06/P5-03 的独立就绪复核见 `next-stage-readiness.md`；本轮不领取下一任务。Phase 6/7 仍 LOCKED。

**完整永久本地体验尚未交付。** 当前检查夹具会清理数据；`preview:management-center` 也只是临时内容管理预览。下一阶段继续异常处理，随后按计划完成接入手册和统一持久环境；达到 `docs/runbooks/local-experience-readiness.md` 的完整上传→选购→托管 TEST 付款→查单→处理→退款及重启保留数据条件后，再给用户地址和启动命令，告知准备服务器。本轮不 push、merge、部署或操作真实资金。
