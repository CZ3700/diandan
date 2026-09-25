# P6-01 媒体准备内部事务有限重试独立复核

Reviewer `/root/regression_readiness`；2026-09-23。作者 `/root/regression_coverage_audit`。**最终源码与轻量验证限定ACCEPT，无剩余明确P1/P2。** 原publication有限重试边界保持；此结论不替代真实PG冷启动或完整回归。

## 真实失败与范围

`journey-coldstart-fixed-1/report.json`保留新fresh实例FAIL：artist已发布，gift在媒体准备阶段返回MANAGEMENT_UNAVAILABLE；安全PG诊断为STATEMENT SELECT40001，callsite为content-draft-data.js:4、daily-publication-metadata.js:30、resource-management-data.js:30。对应源码是prepareDailyMediaMetadata读取upload reservation与source asset的FOR SHARE语句。由于source准备与derived准备都会调用该方法，现有单query证据不能进一步确定是第二还是第三段事务；不推断为已执行最终publication事务。

原流程三个独立SERIALIZABLE事务分别读取当前claim/ticket、注册并保存source/jobs检查点、读取处理结果并保存preparedMedia检查点。外部inspector位于前两事务之间。createResourceRun用savepoint与trackOperation传播typed事务错误；actual40001可由原事务port证明已中止。management repositories/resources均由同一PG transaction client装配，注册/rights/enqueue/checkpoint都在该事务内，inspector不在其中。

## 已确认边界

每一内部事务固定最多3总尝试，只有typedTRANSACTION_ABORTED+RETRY_SAME_COMMAND进入自动重试；等待在锁释放后。每次重新loadClaim读取持久checkpoint，不能复用已回滚callback在内存中突变的claim；返回operationId/token/intent绑定一致。外部inspector不重复，source receipt与再次读取ticket的sameSource比较保持。未知COMMIT、完整性/非typed异常、权限/lease/目标变化仍不重放，原失败映射不扩大。

本review未启动服务/真实PG/浏览器；真实fresh冷启动与最终全套仍由root/journey执行，完整P6-01与S.U.P.E.R10持续PENDING。

## 最终源码与反例复核

- 作者按root批准抽出内部`management-transaction-retry.ts`闭包helper；publication与media仅两个调用点。保留原instanceof+code+recovery精确门和3次总尝试/port delay，不引入参数配置、公共导出、合同或依赖变更。每一个media事务独立最多3次，不重跑整个prepare方法。
- 三个callback每次都重新调用loadClaim，Zod parse产生当前持久对象再修改checkpoint。之前被回滚callback的sourceAssetId/jobId/metadataRevisionId不能存入下一次；实际事务模拟以独立draft/persisted状态验证此点。
- reload新增operationId和leaseTokenDigest响应一致性检查，保留intentHash检查；权限/lease由原fenced adapter验证。任何撤权或绑定改变在后续资源写之前失败。
- inspector仍位于事务wrapper之外，三个阶段两次COMMIT abort后成功均只inspect一次；注册阶段再次readUpload及sameSource比对仍在，上传来源变化会拒绝旧inspection。
- statement abort、三个阶段COMMIT abort、每阶段3次耗尽、派生job retry时旧jobID和retryRequested恢复、source变化、四类authority/intent/fence/operation失配、unknownCOMMIT/integrity/unexpected/plain-object异常及inspector异常均有明确反例。未知COMMIT不自动重放，也不继续后续prepare阶段；保留原MANAGEMENT_UNAVAILABLE映射。
- publication换为调用共享helper后的33条原测试未改且再次通过，包括COMMIT callback已经complete后新事务重试、唯一提交模拟和unknownCOMMIT拒绝。无跨层错误类型放宽。

独立命令：`mise exec node@24.20.0 -- pnpm --filter @fan-support/application exec vitest run --config ../../vitest.config.ts --root . src/management-center.test.ts src/management-media.test.ts`，**2文件54/54 PASS**；日志`management-media-retry-independent-final.txt`。原port59测试仍按`management-retry-port-review-node24.txt`消费，port未变，本轮未重复运行或宣称真实PG已通过。作者RED/类型检查与build为作者证据，本review不冒领其执行。

最终hash：

- center `5d013bb31c73b38c475b57f831f5e123e43ad74779e86efae72b6525b5e80274`
- media `9e42378d629edf03655dc855f825b3ace1575f6170881459dbe705da7988604a`
- shared helper `eeb7dec0dd0073d555f893ea4a41d62d2a6fccffdc5f614c48d8683c5efd9c31`
- media test `73e26fdd42b4c46fee5b6e9cd8efc29f5c18fb18741435d75aced4e6a583d98b`
- center test未变 `3432463d83a87d1a64b5b691ef593f6635f1440eabcade7057dd37112d365959`

完整P6-01、fresh真实唯一效果、五组17命令/14要求、S.U.P.E.R10继续PENDING至root给出最终同源证据。
