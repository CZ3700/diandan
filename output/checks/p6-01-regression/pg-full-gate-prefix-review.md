# 完整质量门：旧通知回退前缀修复

作者：`/root/regression_readiness`；2026-09-23。范围仅 `packages/persistence-postgres/scripts/notification-rollback-prefix.mjs` 及其 `.test.mjs`。无迁移、产品逻辑、公共合同、依赖或超时/门槛修改。

## 真实根因

`final-5/quality-repository-check.txt:565–572` 的真实 PostgreSQL 用例失败由 `withEphemeralPostgres` 的隐私保护统一转换成 `EphemeralPostgresError`，不是数据库启动失败。新建的 owned Docker PostgreSQL 完整 migrate up 后实际 head 为 **0037**：

- 旧测试第 135 行仍断言 0036，真实错误为 `AssertionError / ERR_ASSERTION`，expected=0036、actual=0037。
- 即使越过该断言，原 helper 第 28 行仅支持 0029–0036，也会拒绝合法已知 0037。
- 安全诊断只保存 head、错误类型/code、允许的断言值和栈文件/行；没有数据库连接、SQL 行或凭据。证据 `pg-full-gate-diagnostic.json` / `.txt`，结束 cleanup=true；诊断脚本在同目录保留。

首个一次性诊断因 output 目录无法直接解析 scoped `pg` 依赖，在导入阶段出现 ERR_MODULE_NOT_FOUND，未启动 PG；改用 persistence-postgres package.json 的 createRequire 解析后取得上述真实证据。没有调整产品依赖或 PostgreSQL 去敏 helper。

## 最小修复与失败测试

- helper 显式加入 **0037**，仍拒绝所有未知版本。按不可变的 `0037_admin-exceptions.down.sql` 原保护语义，在任何一次 down 之前新增 `admin_exception_operations`、`admin_exception_receipts` 和 `audit_logs WHERE action LIKE 'EXCEPTION_%'` 的零历史联合预检。
- 保留所有旧历史检查、原 runMigrations、逐步 confirmVersion / checksum / advisory-lock / 事务 / 原 down 的表锁与最终历史 guard；没有直接 DROP、自行改迁移清单或跳过存量保护。
- 测试把最新明确已知 head 作为头断言，未知未来版本改为 0038；补三类 retained exception 历史和四种真实 EXCEPTION_ action 的新库事务反例。
- 初次完整 RED：`pg-full-gate-prefix-red.txt`，确认新 0037 契约仍被旧白名单拒绝。
- 第二组专门 RED：仅加入已知 0037、尚未加入历史预检时，三种新增 retained history 均触发 **Missing expected rejection**；`pg-full-gate-exception-guards-red.txt` 为 0/3 PASS。这证明不能靠只更新版本号通过。
- 添加三项预检后，`pg-full-gate-prefix-green.txt` 为 **51/51 PASS**，包含真实 Docker PostgreSQL 用例 2701.396 ms，总计 3014.079 ms。真实用例覆盖 0029–0037 九个已知 head 的原正常回退至0028、登录与审计历史拒绝及恢复；mock retained tests 还断言任意历史存在时 migrations 数组为空。

命令：`mise exec node@24.20.0 -- node --test packages/persistence-postgres/scripts/notification-rollback-prefix.test.mjs`。原 helper 创建全新随机容器并只按精确 harness/run-id 标签清理；没有连接用户实例或执行任意容器清理。

`prettier --check` 与 `eslint --max-warnings=0` 对两文件均通过，日志为 `pg-full-gate-format.txt`、`pg-full-gate-lint.txt`。第一次格式检查要求收拢一条对象属性换行，已仅格式化；行为 GREEN 在该格式化之前执行，没有把格式化伪称另一次 PG 运行。

## 影响范围与接续

原八个 consumer 为 catalog-directory、publication-runtime、admin-catalog，以及 cart-runtime、cart-edit、checkout-preflight、payment-runtime、order-payment 的 rollback proof。它们复用同一显式空前缀 guard，并已保存进入时的 head/迁移清单来恢复；本次未发现这些调用点另有写死0036的断言，无需修改它们。定点 targetVersion=0036 的 payment-configuration 原迁移用例属于有意验证历史迁移，不应机械替换为0037。

独立 review：`/root/regression_coverage_audit` 已 ACCEPT，另跑纯 mock 50/50，通过并核对0037原down；没有重复运行真实PG，真实PG证据由上述作者执行。版本绑定：helper `d6eab7bc3be051a13db516441f1500f2f17f69b9d423909be16326c3a49a37df`；test `593a345ddac8ddb431d01f5d8654230bd35590fa24001c8ba9a038be786f1223`。完整 quality/五组仍须 root 的新实际运行，不能用本次 51 项代替。`final-5` 原 FAIL 保留；此前 `final-source-review.md` 的差异摘要和第10项仍须最终新源/完整结果重新绑定。
