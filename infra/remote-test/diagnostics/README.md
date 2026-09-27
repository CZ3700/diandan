# 远程测试环境：付款问题诊断

用于排查"付款后订单卡在付款确认中"这类问题（2026-09-27 用它查到了虚拟礼物付款被 0005 的校验拦下）。三个脚本都以运行用户 `xiadan` 在服务器上执行。数据库口令留在服务器上，脚本只输出状态列，以及 SQLSTATE、函数名、约束名，不输出口令或任何个人信息。

1. `node payment-status.cjs`（只读）：列出以下内容：
   - 近 6 小时的付款尝试，含订单、履约和购物车状态；
   - webhook 处理结果；
   - 等待入账的积压；
   - 迁移头。
2. `copy-database.sh [候选.sql ...]`：把测试库复制成临时库 `diag_payments`，只在临时库上套用候选 SQL。用完执行 `copy-database.sh --drop` 删除。
3. `DIAG_DB=diag_payments node replay-payment-application.mjs`：在临时库上按 worker 的方式重放积压的入账，报告被哪个校验拦下。
   - 默认拒绝对线上库运行；
   - 加 `--live` 才会对线上库执行，效果等于 worker 本来就要做的入账。

应用日志里只能看到 `INTERNAL_ERROR`，因为 API 和 worker 是子进程，监督进程的 SQL 诊断钩子只装在它自己身上；实例的 PostgreSQL 日志又为空。所以要靠第 3 步拿到具体原因。
