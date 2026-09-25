# P3-01 4C-2 内容发布、回退与缓存更新

Task：P3-01，唯一executor `/root`，基线6a14495。延用项目合同先行、测试先行和独立子模块实施流程。

## 目标与边界

完成实际内容发布纵切片：当前授权 → canonical验证 → 不可变manifest/发布/head/outbox原子提交 → 七语言公开读取 → 持久purge提交/轮询/重试。只读preflight结果不能充当发布授权。回退是新publication指向历史revision；本地通过不代表云CDN、正式素材、身份或上线验收。

## 执行顺序

- [x] 审计既有SQL发布门、复制审核、public v1、outbox/queue/cache ports，冻结新versioned命令、manifest、DTO与持久状态合同；旧279roots保持。
- [x] 先写失败测试，再实现最小增量0018和真实数据库证据门；validate/publish/rollback、乐观版本/幂等/审计/七locale outbox原子提交。
- [x] 实现纯manifest/hash、公开扩展DTO和当前发布读取/目录别名投影；缺失/失效扩展不回退旧description。
- [x] 实现当前授权下的管理发布/status/retry和公开单对象HTTP；严格输入、隐私、缓存与locale/market/currency隔离。
- [x] 实现只消费相关event的持久purge worker，网络在事务外，PENDING/COMPLETED区分、重启恢复/错误有限重试与受权重试。
- [x] 实际PG/HTTP/media完整发布→读取→回退、七语言缓存状态与本地≤60秒可见性；并发、撤权、故障回滚与重复处理回归。
- [x] 先受影响tests、format/lint/typecheck/build预检；全部源码/文件清单冻结后顺序浏览器回归，再运行依赖新指纹的全仓check。非作者规范/质量审查、S.U.P.E.R十项、源码指纹、进度与本地commit。
- [x] 逐条核对P3-01剩余退出条件；全部通过才标DONE，按Phase与Lane门禁解锁直接后续任务。

## 文件所有权

- root：新共享contracts/ports、registry/exports/生成物、发布Application、purge Application/worker composition、共享配置和验收文档。
- auth_persistence_audit：0018 SQL、发布/缓存状态PG repositories及真实PG harness。
- content_review_audit：独占起草新增 `publication-manifest.ts`、`published-content.ts` 合同及各自 tests；root复核冻结后继续纯manifest/公开投影与公开PG loader/目录search，不编辑共享exports/registry。
- admin_transport：管理和公开HTTP routes/tests、两份新增composition及tests、新OpenAPI path文件、六个旧API harness的17→seed→18升级及实际HTTP联合harness。

具体合同在只读审计后补充；不能通过临时GUC、跳过trigger或客户端资格标记绕过发布门。

合同冻结：新增runtime/manifest/public DTO/durable purge roots，不改旧279定义。新publication强制proof_version2与一对一manifest；存量在0018迁移时标记1，不能新插legacy。旧fixture按17正常seed后升18验当前读取。发布仅VALIDATED，回退仅历史SUPERSEDED；全七locale当前授权先于幂等。PG内容专属持久purge队列绑定七outbox事件，30秒provider超时与正常60秒lease，尾部lease受10分钟总上限截短且迟到结果拒收，6次网络失败/10分钟上限，人工重试新代。

验收：2026-09-06最终全仓check、真实PG/HTTP/TLS S3、浏览器与非作者复核全部通过；本任务DONE，证据见 `output/checks/p3-01-publication-runtime/README.md` 与 `validation.json`。Phase 3仍ACTIVE，后续P3-02/03/04为READY。
