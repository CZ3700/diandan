# P3-01 / 3B 独立复核

Reviewer：admin_transport、content_review_audit、auth_persistence_audit，分别复核非本人实现的模块。

复核中发现的政策精度/UTC 年界、NFC 显式字段变更、SERIALIZABLE 并发错误映射、数据库时区与因果时间、审计字段路径、配置对象转换已由对应作者按失败测试修复。

结论：**ACCEPT（实现复核）**。作者修复后由非作者再次检查，当前无未解决阻断项；完整验收命令结果另见 validation.json。

- admin_transport 复核共享合同、端口、TEST/API 与 PostgreSQL 组合、0015 迁移、loader/writes，核对源归属、审核继承 FK、版本与子内容封口、微秒因果时间和原子审计，ACCEPT。其真实 PostgreSQL 探针首先发现 policy 时间精度与 UTC 年界，root 以失败测试修复。
- content_review_audit 复核路由、OpenAPI 和 TEST composition，发现可转换为字符串的错误配置会在验证前创建连接池。root 增加严格 typeof 前置校验；工厂零调用测试 RED→GREEN，复核者再次运行相关 11 测试通过，ACCEPT。
- auth_persistence_audit 复核 Application/Domain，发现 NFC/NFD 显式编辑虽然审核决策不同，却共享旧规范化请求摘要。新 authoring-only 命令 hash 保留原始字符串与数组顺序，只稳定对象键序；对应错误重放 RED→GREEN。复核者用当前构建独立确认原始文本变更返回 IDEMPOTENCY_CONFLICT、仅对象键序变化仍可重放，ACCEPT。
- root 交叉复核 HTTP/Domain/Application/SQL：版本安全整数、桌面/手机 Hero 来源区分、媒体焦点精度、来源子表封口并发、UTC 稳定摘要、未来审核时间、具体字段路径与原始 Unicode 编辑、权限范围及幂等重放均有对应断言。

代码收敛仅提取可复用 ICU/详情字段验证和新的作者请求摘要/差异函数，保留显式类型分支、旧合同、旧 3A 请求摘要及审核语义；未顺带重构其他内容链路。

完整检查后的补充复核：root 确认旧目录 harness 漏回退 0015，修复后 307 条真实目录断言通过；固定历史版本的其他 harness 保持原样。3A 到期测试先确认事务启动早于到期，再由实际数据库时钟和单调有界等待确认到期，最后只调用一次授权，109 断言通过。

媒体 attempt 的实际 SQLSTATE 23514 指向完成时间早于不可变开始时间；admin_transport 在原约束与正常触发器下用固定较早时间复现，生产只将完成时间改为 `GREATEST(clock_timestamp(), started_at)`。root 复核该下限不延长 lease、不改变状态或重试策略；三种终态的最终真实 PG 结果由 validation.json 记录。

交接范围独立检查还补齐了基础内容只读 preview、政策 owner 初始入口、媒体管理 API 的退出清单；艺人和商品管理任务明确包含所需 API，避免将 P3-02/03 误限定为界面工作。完整 P3-01 仍未结束。
