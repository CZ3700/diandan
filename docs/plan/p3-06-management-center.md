# P3-06 简洁管理中心实施记录

范围由 2026-09-08 用户明确要求和 ADR-012 决定。本轮不领取新任务，不解锁 Phase 4，不推送 GitHub。

1. 冻结 daily publication 与 management operation 合同，先证明旧门禁下单操作者/单原图/原文提交失败。
2. 新迁移保存版本化真实发布来源和可恢复操作，保留原有严格证明、商品价格库存真相源与审计。
3. 服务端编排上传、图片加工、原子发布和读回；默认配置来自 PG，防止刷新、重复点击或网络错误重复上架。
4. 默认后台改成艺人/礼物/海报三个短表单和可浏览列表，海报提供历史恢复。
5. 接通匿名前台读取与媒体动态访问，确认原文语言和 SEO 语义；验证操作结果后再宣告成功。
6. 真实浏览器双视口七语言、错误/键盘/reduced motion，受影响测试和仓库必需检查，S.U.P.E.R 复核与本地提交。

Owner：root 负责文档、共享接线、运行环境与最终验证；storefront_read 负责管理 API/编排/操作持久化；storefront_directory 负责 daily publication/迁移/公开读取；storefront_e2e 负责管理中心 UI。各 agent 不改共享 exports/registry/migration manifest，避免并行覆盖。

新证据统一写 `output/checks/p3-06-management-center/`；已有 852 个非忽略未跟踪文件按 untracked-baseline.json 保留。
