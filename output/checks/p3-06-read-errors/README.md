# P3-06 读取错误保真检查点

本地基线 `75751e1`，2026-09-16 UTC（曼谷 2026-09-17）。完成本检查点，P3-06 仍 IN_PROGRESS；不解锁 Phase 5，不推送 GitHub。

嵌套内容仓储重复转换已经标准化的数据库错误，丢失 `TEMPORARY_UNAVAILABLE`、`TRANSACTION_ABORTED` 等原分类。本次只在现有转换入口保留经合同再次验证的标准错误；重新构造干净错误，保留恢复方式和重试延迟，剥离额外的数据库描述。未知 Proxy、getter 或损坏字段继续安全降级。没有新增自动重试，COMMIT 不确定结果仍必须对账。

真实 PostgreSQL 的已发布艺人行锁产生 `55P03`，旧编译代码在仓储分类断言失败，修复后通过。最外事务管理器原本会记住首个内层错误，因此不能声称所有 HTTP 响应原本都被误分类；也未证明此前自然出现的不可用页面由此造成。

## 验证与复跑

所有命令从仓库根执行，完整字面参数、时间、耗时和退出码见 `*-result.json`。原始 `.log` 保留本地，没有纳入 Git。

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test src/transaction-runner.test.ts src/errors.test.ts
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-port --filter @fan-support/persistence-postgres --filter @fan-support/application --filter @fan-support/api test
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test:postgres:publication-runtime
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:catalog
mise exec node@24.20.0 -- corepack pnpm check:dev
mise exec node@24.20.0 -- corepack pnpm security:secrets
```

- 首轮单测 9 FAIL /68 PASS，修复后77 PASS；独立复核发现 Proxy 边界回归，补4项测试先4 FAIL /77 PASS，再修正到81 PASS。两份失败均保留。
- 最终受影响包 1,424 tests PASS；非作者独立5文件116 tests PASS。
- 原真实 PostgreSQL 发布运行时487断言（含新增10项行锁、回滚、连接释放/同连接恢复、原publication不变）以及原事件时间30断言 PASS。旧代码RED准确停在仓储错误分类；最终完整命令21.998秒exit0。
- 原真实HTTP目录49请求/331断言 PASS，覆盖七语言120艺人/120礼物、数据库断连安全503和同进程恢复。这里仅验证媒体元数据/URL，不声称媒体字节或浏览器验收。
- 全仓 `check:dev` 45.86秒exit0：format、lint、边界、typecheck/test各62任务（各59缓存）、build36（34缓存）。它不是完整 `pnpm check`。
- 最终暂存文件秘密扫描36.252秒exit0，`git diff --check`通过；原始失败日志和旧未跟踪文件未暂存。
- 2,207实现输入冻结一致，SHA `d10c5da1cc5c2193bb41ae34319109bdbeb5387668646cb42da8d30c09e6fd93`；仅3个旧输入变更，另增1个PG测试文件。旧合同、SQL、所有前端输入保持。初始3,767未跟踪文件逐SHA不变。

## S.U.P.E.R（本检查点范围）

|检查|结论|
|:--|:--|
|1 文件职责|PASS：事务边界错误转换、单测、真实故障回归各自独立|
|2 函数职责|PASS：只修标准化错误保真，复用既有JSON快照和合同解析|
|3 单向依赖|PASS：Adapter依赖原Port/合同，无反向业务依赖|
|4 无循环|PASS：未引入模块依赖；全仓边界与类型/构建通过|
|5 Schema合同|PASS：原持久化错误schema不变，重验后输出|
|6 可序列化|PASS：公开错误仅保留标准JSON，无原生driver附加信息|
|7 配置注入|PASS：无生产常量新增；锁超时与样例origin仅限TEST|
|8 显式依赖|PASS：依赖和lockfile不变|
|9 可替换|PASS：既有adapter/port形状不变|
|10 验证|PASS限本检查点：受影响、PG、HTTP与开发门通过；整个P3-06性能/人工门仍未通过|

独立评审：[independent-review.md](independent-review.md)。结构化结果：[final-verification.json](final-verification.json)。源码清单：[candidate-source-final.json](candidate-source-final.json)。原始失败由本地 `unit-red.log`、`boundary-red.log`、`postgres-red.log` 保存，退出摘要随提交。

## 下一步与仍待验收

下一候选是让礼物正文与SEO共用完整 scoped 读取，避免正常市场页面重复读取发布内容；合同与源码证据、错误回退及七语言验证计划见 [performance-audit.md](performance-audit.md)。本轮没有实施它，没有新LCP收益结论。

风险R-03（提交未知结果不得变自动重试）、R-08/R-12/R-13/R-17仍按原阶段管理。自然读取故障根因、正式LCP矩阵、人工运营/读屏/关键译审、手机、商户PSP、staging及上线门仍开放；不把本次修复当作这些门已通过。
