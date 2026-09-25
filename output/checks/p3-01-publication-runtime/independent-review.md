# P3-01 4C-2 独立复核

结论：实现范围 ACCEPT；最终全仓 gate 的退出码单独记录于 validation.json。

| 非作者审核者 | 复核范围 | 结论 |
| --- | --- | --- |
| admin_transport | root 的共享运行时/缓存合同、Application授权/幂等/事务、公开读取、worker调度/启停和生产接线 | ACCEPT；独立74项相关测试；详见 transport-review.md |
| auth_persistence_audit | root Application/幂等/缓存编排；content_review_audit 的manifest/公开投影/媒体ledger/目录v1与v2分支 | ACCEPT；重放重新授权、固定证明与当前媒体资格分离、网络不占数据库事务 |
| content_review_audit | root Application冲突与STATUS绑定修复、purge结果绑定、SQL状态与attempt约束、完整任务退出范围 | ACCEPT；非终态PURGE_TIMEOUT缺口已修并有真实PG负例 |
| root | 两组新HTTP路由/组合、SQL规范证明及回退保护、公开投影/媒体来源、收据旧hash重建和UTC独立性 | ACCEPT；真实SQL/HTTP联合结果、105任务预检通过；最终全仓验收另记 |

已收敛的实际问题：

- 固定顺序的 reviewedFieldPaths 不能作为集合重排；五类及复制审批往返回归由RED转GREEN。
- VALIDATE返回hash必须与数据库重新读取完全一致；保留原snapshot算法，通过数据库实际timestamp表示计算，六位小数秒与时区边界均验证。
- 收据的两个内容hash、VALIDATE实际head及publication链版本分别由数据库真实数据绑定；同时篡改相同错误版本仍拒绝并完整回滚。
- publication manifest证明直接对应真实基础译文/终审/复制来源/扩展/媒体/加工来源；空证明、错绑定、双端同原图均不能通过。
- begin/complete返回的事务冲突保持CONFLICT；STATUS和purge结果必须绑定请求及持久任务；PENDING不得冒充完成。
- 新发布保留原媒体门；已发布父引用的有效SUPERSEDED metadata继续可读。manifest只记录READY衍生图。
- worker有到期任务时10ms继续处理，空闲或不可用时使用生产1000ms间隔；数据库决定重试时间，stop仍single-flight/drain/close once。

范围：P3-01的本地内容运行时验收。管理写接口仍为显式TEST组合，不是生产登录发行；本地HTTP缓存不是CloudFront实测；真实衍生图字节通过同对象的私有TLS读取核验，未证明部署后的公共CDN。10分钟总截止未实际等待十分钟：证明由真实SQL边界表达式、完整触发器的提前超时拒绝、真实短租约到期及late-result fencing组成。
