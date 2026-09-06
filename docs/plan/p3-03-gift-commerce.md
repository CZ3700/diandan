# P3-03 礼物、价格与库存后台实施计划

基线 `cdf2ab2`，分支 `codex/p3-03-gift-commerce`；Phase 3 ACTIVE，Lane C `/root`。用户已授权继续并补充礼物类型与无库存重复售卖；本任务内部按依赖推进，完成全部门禁才标 DONE。

1. 冻结独立商业合同，保留旧 344 roots；礼物 revision profile 与既有发布链兼容。失败测试明确类型/策略/价格/库存和当前权限边界。
2. 唯一迁移 owner 落地增量 SQL；礼物身份、规格/适用关系、完整价格簿版本/发布回退、库存流水和策略保护分别实现。应用负责同事务授权、幂等、审计、收据；真实 PostgreSQL 验证，不以 mock 替代约束。
3. 固定 API/BFF 接口，复用安全会话与已有内容审核/媒体/预览/发布。后台增加礼物目录及基础信息、规格、履约、七语言结构化详情、价格和库存工作区。金额使用整数最小单位和独立币种；界面清楚解释现货与按单准备区别。
4. 真实 HTTP+PG+S3 联合流程验证管理变化可被公开目录观察。浏览器覆盖全七语言、390×844/1440×900、键盘、错误、reduced motion、320px及重排；原共享前端门按输入指纹更新。
5. 非作者复核、近期改动小范围收敛、完整 check、S.U.P.E.R 十项及证据指纹。只本地提交，不推送/合并；记录真实环境未覆盖范围。

## 文件所有权

- root：规范/ADR/进度/本计划、共享 exports/registry/生成合同/根锁文件、Next workspace UI/i18n 与最终 Git。
- content_review_audit：新增 gift-commerce 合同及测试；冻结后礼物身份/规格/适用关系/profile 仓储和现有 authoring/publication 的必要 profile hook，不编辑迁移。
- auth_persistence_audit：唯一 0020 SQL 迁移和相关 manifest、价格与库存仓储/真实 PG 场景、当前价格回退预检修复。
- admin_transport：Application/Port、当前商业授权与事务 composition、API/BFF transport、联合 HTTP/浏览器 harness。消费冻结合同；不改 UI 或迁移。

代理为同一 Lane C 任务的有界子模块，不领取其他 task。共享边界由 root 集成，不并发修改同一文件。准确命令、RED→GREEN 与剩余问题归档 `output/checks/p3-03-gift-commerce/`。
