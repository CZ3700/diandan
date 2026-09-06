# P3-01 目录运行时检查点 2A

本检查点接通 PostgreSQL → Application → Nest/Fastify 公开目录。P3-01 整体继续 IN_PROGRESS；媒体处理、内容写入/授权/preview/事务发布与 purge worker 尚未完成，前台业务页面接入属于 P3-04/05。

## 实现范围

- `GET /api/v1/idols`：显式 locale、分窗读取、名字/handle 搜索、anchor 定位、绑定查询与目录版本的 canonical cursor。
- `GET /api/v1/gifts`：显式 locale/market/currency、礼物分页、类别/金额/可售筛选及稳定价格排序。展示当前适用且可购买规格的最低价；购物车/结账仍须重新核价。
- 一个 SERIALIZABLE 事务覆盖版本、总数、结果窗口与内容加载；只加载当前窗口的完整发布和媒体证据。公开响应经过既有强发布投影验证，不返回 storage key、审核身份或内部 revision source。
- 0010 新增可重建搜索投影，沿用统一 Unicode 算法与 source hash。0011 修复旧价格状态触发器误读 generated column；原金额、价格有效期与其他原始字段仍不可变。
- 旧发布记录由不可变译文和 terminal APPROVED review 重建完整七语言 manifest；现有 publication 三个汇总 hash 的历史算法尚未落地，此读取层不声称已验证它们。后续内容发布用例须写入实际 manifest/hash。
- 按需采购/预售沿用现有内容规则，允许没有库存行；已有暂停库存行继续阻止售卖。TRACKED 必须有有效库存与可用余额。

## 可重复命令

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test:postgres:catalog
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:catalog
mise exec node@24.20.0 -- corepack pnpm check
mise exec node@24.20.0 -- corepack pnpm security:secrets
```

目录集成脚本使用独立、用后清理的本地 PostgreSQL；120 位艺人、120 件礼物均为虚构数据，seed 保持正常数据库触发器启用。HTTP 集成启动独立 loopback 随机端口，不是持续服务或生产部署。

## 运维接续

对已应用迁移但尚无搜索投影的数据库，在正确配置 `FAN_SUPPORT_DATABASE_URL` 的进程环境中执行：

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres catalog:rebuild-search
```

命令按批次重建并原子提交，不改变内容译文。它只输出处理数量，不输出连接配置。迁移 0010 回退只删除可重建投影；再次应用后必须重建。缺失/过期投影导致明确不可用响应，不能静默漏掉艺人。后续发布事务必须同步维护对应投影。

## 当前边界

- 名字及 handle 搜索已接数据库；独立受审别名、图片构图产物、七语言受控详情的存储/编辑仍在后续检查点，不能把纯规则当作运行时。
- 目录版本当前在数据库聚合标量状态；随出版、状态、库存和价格有效窗口变化失效。尚未证明超大目录负载，后续可改为事务维护的变更版本，不改变公开合同。
- HTTP 暂用 no-store 保证更新可见；真实 CDN 发布/失效与 60 秒 SLA 仍待后续链路验收。
- 保持旧媒体资格门禁；本次测试使用数据库媒体证据，不代表图片已重新经 S3 解码处理。
- 无新真机验收、远端 CI、staging 或生产发布。

根因参考：PostgreSQL 的生成列在 BEFORE trigger 之后计算，因此不能在该触发器中把 NEW 的生成列当作已计算原始字段比较。见 [PostgreSQL 官方生成列文档](https://www.postgresql.org/docs/current/ddl-generated-columns.html)。

## 最终验证（2026-09-05）

| 验证 | 结果 | 证据 |
|:--|:--|:--|
| 七个受影响包测试 | exit 0，631 tests；181 + 12 + 4 + 84 + 63 + 255 + 32 | `targeted-tests-final.log` |
| 真实 PostgreSQL 目录 | exit 0，120 艺人/120 礼物/七语言，287 断言 | `postgres-catalog.log`、`check.log` |
| 真实 Nest/Fastify HTTP + PostgreSQL | exit 0，31 请求/193 断言；实际 DB 断连安全 503、原进程恢复 200、关闭后连接清空 | `check.log` |
| 完整 `pnpm check` | exit 0，11 迁移/109 表；PG/S3/合同/架构/format/lint/typecheck/test/build 均通过 | `check.log` |
| Turbo 缓存范围 | typecheck 53/53（23 cached）、test 53/53（25 cached）、build 34/34（26 cached） | `check.log` |
| P2-04 / P2-05 真实浏览器回归 | exit 0；16 + 8 场景、18 + 22 PNG、10 + 3 axe，critical/serious 0 | `composites-browser.log`、`motion-browser.log`、`compatibility-and-progress.json` |
| 凭据扫描 | exit 0 | `secrets.log` |
| 独立复核 | ACCEPT；源码、合同兼容、浏览器当前指纹及日志统计再核一致 | `validation.json` |

`implementation-source.json` 记录 HEAD 和 56 个实现/测试输入的逐文件 SHA256，汇总指纹 `b96c2a50a715bac41b218724653a243716504e09e8dd3d08d2197208389e1dc8`。本检查点新增 13 个 versioned roots，原 155 个定义保持深比较不变，累计 184 个定义。最终结果与命令见 `validation.json`。全仓测试保留并如实统计 Turbo 缓存，受影响 631 tests 为本轮直接执行。

早期失败日志保留用于排障：强发布 loader 必须以 `to_jsonb(alias.*)` 取整行；BEFORE trigger 不应比较尚未计算的生成列；迁移替换函数必须显式限定 `public`，确保空库与 down/up 的 search_path 一致；按需采购/预售按既有领域规则允许缺少库存行。相应回归已通过。没有以绕过触发器、降低媒体资格或跳过门禁解决问题。

下一次按 `docs/plan/p3-01-content-runtime.md` 的 **2B** 接续；当前目录检索是后续前台功能的数据基础，现有黑金样板尚未切换到这些接口。
