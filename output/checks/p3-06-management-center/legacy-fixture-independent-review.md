# 旧测试夹具独立复核

复核者：`/root/storefront_directory`；只读，不重复启动服务或修改源码。结论 ACCEPT。

- 短会话只把正例准备预算从 3 秒调至 15 秒；校验 grant 与 session 的实际到期时间一致且当前有效。以 PostgreSQL 实时时钟确认已过期 250ms 后，仍执行原来的 preview 404 / session 401；20 秒内未观察到到期即失败。不改授权、不伪造到期、不重试成功响应。
- 图片只把小图加工负例明确设为 COVER 并更新标签。原 50×40 图、FAILED / SOURCE_TOO_SMALL、generation 2 / retryOf / attempt 0、重复重试 409、旧 job 逐字 JSON 不变的断言全部保留；大图 CONTAIN 不变。
- 作者真实完整 GREEN 为 436 断言 /68 HTTP 请求及 1798 断言 /159 HTTP 请求。独立复核查看源码差异与对应日志，未声称自己重新执行。生产权限、加工和 SQL 守卫没有因这两处测试修正而改变。

最新迁移头相关五个旧 PG harness 修正及有效 RED/GREEN 另见 migration22-harness-README.md；这七个 TEST 脚本是 runtime13 后仅有的实现输入差异，详见 browser-product-preservation.json。
