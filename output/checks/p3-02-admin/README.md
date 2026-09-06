# P3-02 自研内容管理后台

任务由 Codex `/root` 在 `codex/p3-02-admin-workspace` 执行，基线 `6983e9051f97d7bccbd116dcc305106ecd61ffec`。2026-09-07，本地实施；最终结果以本目录 `validation.json` 和 Phase 3 验收记录为准。

## 最终本地验收 PASS

完成于 2026-09-06T19:55:20.066988+00:00。完整 `pnpm check`、`pnpm security:secrets`、`git diff --check` 均exit0；19迁移/144表、管理PG253、后台协议957/306请求、完整UI1003断言与七语言双端截图通过。最终typecheck/test各58/58（55 cached），build35/35（35 cached）；31个package出口实际由Node import。1,134个源码输入冻结摘要 `9e7c70c6c4979d3e0ffda81850d42bec8a812655a45a5d60d8ade3591a714d8a` 与最终实盘逐项一致。最终全仓发布链含首tick时钟回归：9,962断言/1,265 HTTP请求通过；轮询次数影响计数，不据此与独立轮的11,364/1,450作覆盖差异结论。

P3-02 DONE；Phase3仍ACTIVE（2/6），总任务19/49完成。下一任务P3-03。非作者复核和S.U.P.E.R十项通过；原间歇失败及实际环境范围仍按下文保留。Git按用户决定只本地检查点，不push/merge。

## 实现范围

- Next 自研后台：首页、艺人目录和稳定身份、媒体库、七语言内容编辑与翻译矩阵。列表真实搜索/分页；handle、暂停/归档与接受礼物状态单独版本化，历史 handle 保留同一艺人的跳转。
- 英文源稿与有证据的历史源差异、缺失和 STALE 状态、别名、独立审核、受审计 JSON 翻译包导入导出。导入的新译文保持 IMPORT/DRAFT，缺失语言不伪造英文回填。
- 图片原图签名上传、实际解码登记、版权状态、加工任务与失败重试；焦点裁切、完整展示、双端素材选择，能够进入派生图片的元数据编辑。图片正文和展示 metadata 继续由 PostgreSQL/对象存储持有。
- 草稿预览、发布前检查、验证/发布、不可变历史回退与缓存刷新状态。发布验证已成功、上传已完成时的重试沿用内存阶段记录和原幂等请求，不重复创建。版本冲突保留输入，艺人资料刷新保留另一个未提交字段。
- 当前会话、MFA、RBAC、localeScopes 与 CSRF 经固定同源 BFF 和真实 API 验证；私有预览凭证只在内存和 POST 中使用，图片 grant 读取后转 blob，过期/撤销清理。

依赖保持 Browser/Route → Application → Domain/Port → Adapter；新增五类专属事务入口继续使用 SERIALIZABLE。0019 增加三张专属表与身份/翻译收据约束，19 个迁移、144 张表。新增 33 个 versioned roots 和 11 条 OpenAPI 路径；原 311 个合同定义逐项深比较不变。

## 复跑入口

从仓库根目录执行：

```sh
mise exec node@24.20.0 -- corepack pnpm check
mise exec node@24.20.0 -- corepack pnpm verify:admin:browser
mise exec node@24.20.0 -- corepack pnpm security:secrets
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api preview:admin-workspace
```

`check` 已包含新增 Admin PostgreSQL 和真实 API/BFF 协议集成。浏览器命令另外覆盖七语言双视口和实际页面操作。preview 命令启动隔离 TEST 身份与独立 Chrome；普通浏览器没有该会话。工具仅回收本次创建的容器、临时文件与进程。生产 Admin 默认 DISABLED，不提供匿名登录或任意身份发行入口。

## 证据与范围

- `translation-handoff.md`：翻译工作区、包传输、预览媒体的初始失败、修复和独立复核。
- `transport-README.md` / `transport-review.md`：会话/BFF、实际 PostgreSQL + TLS S3 + worker + Next + Chrome 链路、复跑方法与隐私边界。
- `../../playwright/p3-02-admin/`：18张截图含七语言 390×844/1440×900、编辑/源改变/私有图片预览及审核成功后的刷新状态。`en-reviewer.png`停留在成功提示后的Loading阶段，不作为稳定审核矩阵证明；审核及矩阵结果由实际协议和浏览器断言证明。素材为正常上传处理的原创测试图；未使用用户私密留言或凭证。
- `validation.json`：最终命令退出结果、各层计数、源码与截图摘要；日志保留在本机本目录 `*.log`（git 忽略），不是依赖日志即可宣称生产验收。
- P2-04/P2-05 的既有浏览器证据在共享合同/依赖改变后重新实际生成，不复用旧指纹。

正式 OIDC/账号发行属于 P5-01，七份 Admin 界面译文 review manifest 仍是 DRAFT，真实人工译审和正式品牌/图片授权属于上线门。没有真实 PSP、云对象存储/CDN、staging、生产发布、手机真机或远端 CI 结论。礼物/价格/库存管理属于 P3-03，粉丝正式浏览页面属于 P3-04/P3-05。本轮只保留本地提交，遵照用户选择最后统一推送。

## PostgreSQL 细分证据与 UI 独立复核

`auth_persistence_audit` 完成管理目录持久化实现；`db-history-order-green.log` 记录 **253 assertions PASS**。其中 251 项使用实际 PostgreSQL 业务表与正常触发器，覆盖身份创建、改名及历史占用、三类版本绑定、暂停/归档、当前发布资格、审计原子性、伪造身份收据拒绝，以及翻译交换/受限预览集成；另外 2 项是实际 SQL 的隔离临时表查询用例，专门证明 `published_at` 相同时仍沿真实 predecessor 链计算发布历史版本，未修改生产业务表、未将临时记录视为合法发布事件。0019 和发布历史查询由非作者 `content_review_audit` 独立复核接受；完整草稿 snapshot hash 仍由规范化 Application/Repository 重算，SQL 只宣称其实际执行的 source/head/English/COPY 绑定。

对 root 的 Admin UI 进行只读交叉复核：艺人身份组件已移出内容 loading 条件分支，只在 IDOL owner 下挂载，父编辑器 key 保持稳定 owner 身份；因此刷新不会销毁 handle/acceptingGifts 的逐字段 baseline，保存一个字段时能够保留另一个未提交字段。身份命令使用当前 `baseVersion`，作者修订序号和发布 head version 各自使用独立命令字段。媒体版权撤销使用合法 `REJECTED` 状态；未保存媒体编辑时版权、加工和打开产物操作禁用。上传恢复记录保留原 ticket、PUT、COMPLETE 与资产读取阶段，412 仍交由后端完整对象校验；失败后的同一 COMPLETE 使用原幂等请求。发布恢复支持已 VALIDATED 修订直接发布，并在 VALIDATE 成功后从该阶段继续。`application/admin-catalog.test.ts` 已使用共享 `SUPPORTED_LOCALES`，未重复定义七语言数组。

本次只读复核另确认一个待收口边界：PUBLISH 已返回成功但紧随其后的 STATUS 读取失败时，当前界面仍保留可再次发布的旧 preflight；该写请求的幂等 key 已成功清除，再点击会以旧 head/hash 发起新写请求。已向 root 报告，需将成功发布与后续只读状态查询分离，或保存成功结果让恢复仅重读 STATUS；该项修复复核前不宣称 UI 全部接受。

随后 root 完成该边界的精准修复：`publication-attempt` 在确认发布成功后保存其原始/validated proof 与结果；相同 target、action、headVersion、contentHash 的恢复调用直接返回已确认结果，组件仅再次读取 STATUS，不另发 PUBLISH。`publication-status-recovery-red.log` 明确记录旧实现重复发送两次 PUBLISH（43 通过、1 失败），`publication-status-recovery-green.log` 记录修复后 Admin **44 tests PASS**。`auth_persistence_audit` 已非作者复核实际实现、组件调用顺序和这两份日志，接受本次指定的艺人身份保留、发布恢复、媒体上传恢复及编辑器操作门禁四项修复；前段待收口项至此关闭。此结论是代码与定点测试的独立复核，不替代 root 的最终浏览器、全仓检查或生产验收。

## 最终静态检查修正的独立复核

`content_review_audit` 只读复核并接受最后三处最小修改。`packages/i18n/tsconfig.json` 显式启用已声明的 Node 类型，为使用 `node:crypto` 的译文证据测试提供类型解析，与现有 contracts 等包配置一致，不添加浏览器运行时依赖。两个 Worker composition 测试将原来测试函数内的首次动态导入移到模块收集阶段；模块加载失败仍会使测试失败，所有业务、关闭顺序和安全错误断言保持不变，未提高 5 秒超时或增加重试。`static-final.log` 保留原两项超时失败，其中 reliable-events 为 5170 毫秒；此记录证明原测试把首次模块加载计入单项预算，不据此声称已精确测得每个依赖的加载耗时。

静态导入随后暴露旧测试声明将同步 composition 工厂错误标成 Promise 返回值；`static-after-import-fix.log` 保留 TS2352 失败。最终只将该测试声明改为真实同步返回类型，未通过 `unknown` 双重断言跳过此错误。`static-final-green.log` 记录 35 个包的 typecheck/test/build **105/105 任务成功，其中 101 项命中缓存**；这是 root 的实际执行证据，本复核没有重复运行或将缓存项写成重新执行。以上三处文件均不在既有 P2-04/P2-05 渲染指纹输入集合中；最终全仓检查仍由 root 执行，本段不提前宣称其最终结果。

## ICU 依赖边界的收口

`intl-messageformat` 11.2.14 为本地 ICU 消息解析/编译/格式化工具，实际安装的依赖是 memoize 和 ICU parser，调用原生 Intl number/date/plural；没有通过此库引入内容供应商或第二内容源。沿既有 UI 包的可移植依赖模式，生产规则仅增加 `packages/i18n` 的包级许可。Root 独立复核这一行规则与三项新增测试：i18n manifest/source/dist 正向允许；domain/content 对相同库仍拒；真实 AWS SDK、通过许可库名伪装的 npm provider alias 在 i18n 中仍拒。初始31/32（正向用例准确失败三处）到最终32/32，真实仓库adapter门、定向format/lint通过，见 `adapter-icu-*.log`。未将该依赖加入全局许可集合，未删除旧断言。构建产物独立门验证31个package出口由Node实际import通过。

## 发布时钟边界与诊断记录

最终回归曾出现一次 purge worker `UNAVAILABLE`，安全诊断随后两次普通全链未复现。进一步独立的事件时钟探针确定了一个真实边界：只在旧 `purgeTime` 事件表达式中模拟先前墙钟读数高出2秒，后续UPDATE与原SQL guard继续使用真实时钟，首tick的claim稳定触发 `23514 / CAUSAL_VERSION`。`publication-purge-clock-red.log`是精确RED；较早的`publication-purge-clock-initial-probe.log`不是等价证据。

修复将事件时间限制为稳定事务时间与已锁定历史下限的最大值，10分钟截止、60秒租约、结果fence和实际时钟检查均保留。默认集成回归只覆盖首个claim/record的两次事件时间查询，然后继续真实时钟的完整发布链；可选 `PUBLICATION_PURGE_CLOCK_PROBE=1` 只用于测试脚本。非作者复核接受该最小修复和探针设计。此缺陷有确定性证据，但不据此确认最初自然UNAVAILABLE的原因。

历史日志按实际结果解释：`publication-purge-clock-green.log`虽然名含green，实际在越过首tick后于第871请求retry返回503，不是整链成功；该次尚未向runtime组合注入SQL诊断，未得到确定根因。后两轮第16请求validate失败来自新增诊断包装把Drizzle的QueryConfig误当string；修正后保留完整text/rowMode/types及values转发，这两轮不是生产缺陷。保留的失败诊断仅含固定阶段、错误码、授权时序比较布尔值，不输出SQL、参数、凭证或正文。最终全链结果见validation与下方收口记录。
