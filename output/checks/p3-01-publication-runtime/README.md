# P3-01 4C-2 内容发布运行时

状态：PASS。专项、真实集成、浏览器与最终全仓 check 全部通过，独立复核 ACCEPT；P3-01 已完成。本地验收时间 2026-09-06T12:10:28.807641+00:00。命令与退出码见 validation.json，任务记录见 docs/progress/phase-3-storefront.md。

本轮实现五类内容的validate/publish/rollback，当前授权和幂等重放、不可变manifest/receipt、七语言公开读取、已审别名投影，以及七语言持久缓存任务/status/授权新代重试。新公开reader与缓存worker已接入正常生产组合；管理命令仍使用本地显式TEST组合。

32个新增versioned roots，共311；原279定义逐项深比较保持。0018新增5表，总18迁移/141表；新publication只能使用proof_version2，历史v1仅来自迁移。发布/回退同事务提交生命周期、实际审核/媒体证明、head、审计、七语言Outbox和purge任务；失败完整回滚。已有发布历史不允许降级抹除。

## 可重复验证

所有命令使用仓库固定Node版本：

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test:postgres:publication-runtime
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:publication-runtime
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres migrations:catalog
mise exec node@24.20.0 -- corepack pnpm turbo run typecheck test build --output-logs=errors-only
mise exec node@24.20.0 -- corepack pnpm verify:ui-composites:browser
mise exec node@24.20.0 -- corepack pnpm verify:ui-motion:browser
mise exec node@24.20.0 -- corepack pnpm check
mise exec node@24.20.0 -- corepack pnpm security:secrets
```

新PG和HTTP测试已纳入根test:postgres/check。先冻结实现及捕获期间的文件清单，再顺序刷新浏览器证据，最后运行依赖新渲染指纹的全仓check。日志保留本地，确定性harness与验收摘要随本地提交保存。

## 专项结果

- PostgreSQL 441断言：五类校验/发布、v1/v2历史回退、真实当前授权、精确审计/内容/hash/head绑定、七语言原子事件与任务、非法直接SQL拒绝、并发领取与fencing、失败/完成/attempt不可变、历史降级拒绝及17→18→17目录一致性。`postgres-final.log`。
- HTTP 10,448断言/1,332请求：真实Nest/Fastify、PostgreSQL、TLS S3、图片worker与HTTP缓存，五类×七语言发布/复制/回退，撤权后的重放拒绝、并发一成功一冲突、审计故障全回滚与同key恢复、缓存失败新代重试和重启恢复。计数包含异步STATUS观察，可随运行耗时变化。`http-final.log`；详见HTTP-README.md。
- 本地缓存：真实默认worker调度，1000ms空闲轮询、有到期任务时10ms继续；原有60秒期限通过。测试只观察STATUS，不通过轮询手工驱动worker；PENDING仍旧缓存，取得COMPLETED后才更新。无关commerce Outbox与dispatch记录不变。
- 全部静态/单元/构建预检105/105通过（51 cached）；最终完整 `pnpm check` exit 0，typecheck 57/57、test 57/57、build 35/35（最终均 cached），format/lint/合同/架构/31个Node exports通过。实际18迁移/141表、PG 441、HTTP 10,464断言/1,335请求、媒体worker与TLS S3联合423断言均在该全仓运行重新执行；HTTP计数差异来自STATUS观察。秘密扫描通过。兼容结果见compatibility.json。
- 浏览器P2-04：16场景/18PNG/10axe，阻断0；P2-05：8场景/22PNG/3axe，critical/serious 0，保留3条既有heading-order moderate。覆盖七语言/伪语言、390×844/1440×900等视口、键盘、错误状态、reduced motion和原生200%缩放。root实际检查双端Hero、手机越南语与桌面日语截图。只是共享输入对应的组件回归，没有新增真机验收。

## S.U.P.E.R 10项

| # | 检查 | 依据 |
| --- | --- | --- |
| 1 | 文件职责单一 | PASS：合同、manifest/hash、公开投影、SQL、Application、HTTP、worker各自分离 |
| 2 | 函数职责单一 | PASS：当前资格、证明生成、原子持久化、网络调用、状态提交和资源清理分层 |
| 3 | 单向依赖 | PASS：Route→Application→Content/Port；SQL/provider留在adapter/组合 |
| 4 | 无循环依赖 | PASS：workspace/domain/adapter检查与全仓typecheck/build |
| 5 | Schema边界 | PASS：新32 roots及所有公开/内部命令响应；旧279不变 |
| 6 | 可序列化 | PASS：严格JSON、UTC微秒时间、结构化安全失败，不跨层返回连接或provider原文 |
| 7 | 外部配置 | PASS：数据库、公共媒体origin、CDN参数由服务端配置注入；实体为真实数据库fixtures |
| 8 | 显式依赖 | PASS：新cache port/adapter workspace依赖与锁文件一致，无新供应商版本 |
| 9 | 可替换实现 | PASS：数据库、cache、media、HTTP独立ports；worker不耦合旧generic consumer |
| 10 | 验证通过 | PASS：最终全仓check、真实PG/HTTP/S3、浏览器、秘密扫描及非作者复核通过；validation.json保留命令和退出码 |

## 修复记录与边界

RED→GREEN覆盖固定审核字段tuple、canonical数字和raw Unicode、返回hash与存储时间表示、哈希和head篡改、NULL证据、Hero同源、purge非终态超时、历史媒体公开读取和READY衍生图。两份一次性SQL诊断探针已由正式PG helper覆盖并清理；其早期lint失败保留，未改变生产规则或eslint配置。所有实施/失败日志均保留，不把早期GREEN当最终完整验收。

10分钟绝对截止未进行真实十分钟等待；实际SQL验证尾部租约截短，完整触发器拒绝提前伪超时，真实短租约到期后拒收迟到结果。30秒provider等待截止不会取消远端请求，以稳定幂等键与数据库租约/版本fencing处理迟到。

真实媒体字节证据来自同一衍生对象的私有TLS读取；公共媒体origin为合成fixture。CloudFront真实凭据/边缘延迟、公共CDN交付、正式管理员登录、生产素材与staging仍由后续门禁验证。内容页面purge不等于媒体二进制删除。使用说明见docs/operations/content-publication.md，完整任务退出映射见task-exit-review.md。

源码证据：最终全仓运行后复核1018个输入及实现文件清单，SHA256 `2627ee26c3bceba59d96083281b4b884fe874ef5c85db77a0a7fe3af0f587b3c` 未变。docs与验收文档不计入实现指纹。

任务出口：P3-01 DONE；Phase 3仍ACTIVE（1/6），P3-02/03/04为READY。全局49项为18 DONE / 3 READY / 28 PENDING；本轮不领取第二个任务。

Git策略：按用户决定先保留本地检查点提交，最后统一推送；本轮不push/merge。
