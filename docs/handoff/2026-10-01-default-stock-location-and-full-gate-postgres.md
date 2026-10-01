# 交接：默认库存地点（stg/本地/CI）与心愿整链；journey 媒体冲突；完整门禁 PG 脚本

> 日期：2026-10-01（深夜）
> 执行：Claude（Windows 端）
> 分支：`v2/r1-production`，本文件提交后与 origin 同步。stg 已部署到 e329cc91。
> 冷启动顺序：AGENTS.md → SPEC §0.3–0.9 → [上线计划](../plan/2026-09-28-flexible-storefront-launch.md) → [当前进度](../progress/launch-progress.md)（“CI 回归（PR #16）”行开头一段是本轮记录）→ 本文件
> 上一份交接：[2026-10-01-ci-regression-motion-gates-wish-location.md](2026-10-01-ci-regression-motion-gates-wish-location.md)

## 背景

按上一份交接推进草稿 PR #16 的 CI 回归。用户本轮做了决定：心愿缺默认库存地点一事选 (a)，给 stg、本地启动配置和 CI 各配一个默认库存地点。本轮同时处理了这轮 CI 新出现的 journey 偶发、quality 完整门禁里被后续迁移弄坏的 PG 脚本，并把改动部署到 stg。

## 已完成

| 提交 | 内容 | 验证 |
|:--|:--|:--|
| 1bbf4390 | **journey**：媒体处理仓储在保存点内把 40001/40P01 吞成领域 `CONFLICT`，SAVE_GIFT 在 PREPARE_MEDIA 首次尝试就成不可重试终态。改为抛出事务级 `TRANSACTION_ABORTED/RETRY_SAME_COMMAND`，外层整段重放；唯一约束、版本冲突、产物冲突仍报 `CONFLICT` | 测试先红后绿；持久层 860、应用层 772 项全过；run 36875313892 起 journey 通过 |
| 99b7397b | **默认库存地点**：本地体验启动步骤 `apps/api/scripts/local-experience-default-location.mjs`（挂在 supervisor 的政策步骤之后、首页步骤之前）；CI 管理中心运行时 `management-center-runtime-config.mjs` 指向已有 ACTIVE 地点；`management-center-browser.mjs` 心愿用例补成整链，公开页数量框按键加水合重试 | 单测 7 项；真实 PG 校验 9 项（`output/checks/wish-location/pg-default-location.mjs`）；**run 36880458187 catalog 整组通过，含心愿整链** |
| 6a9715a7 | `postgres-storefront-theme.mjs`：0045 上造数时临时放空的 `wish_bindings` 替身；hero 用例固定升到 0058 | 本机 409 项；navigation、information-pages 同样通过 |
| e329cc91 | `postgres-payment-runtime-parameters.mjs`：恢复分支参数 11 → 12（b0270006 加了证据原因码 `$12`） | 本机通过 |
| 5cfdf07f | L3-13/L3-14 的 `postgres-artist-private-notes.mjs`、`postgres-staff-deletion.mjs`：0064 之后迁移器拒绝回滚非最新版本，改为直接探测 down SQL 守卫 + 核对最新版本不变 | 本机 66、33 项通过 |
| a73efa17、b599f809 | 运行手册写明默认库存地点启动步骤；进度表本轮记录 | — |

stg：部署 e329cc91。冷备份 `~/backups/stg-pre-e329cc91-20261001`（843M，回滚 b85173b1），构建通过，无迁移、无新权限，未跑 sync-roles。启动时新步骤已建 `STUDIO_DEFAULT` 并发布管理默认配置第 2 版。17 条公开路由与部署前一致；心愿表单只读探测结果为 `hasInventoryLocation=true`，“暂无可用的库存位置”不再出现，0 次提交，qa.check 已重新暂停（`output/checks/stg-deploy-e329cc91/`）。

**最新 CI（run 36880458187，e329cc91）**：Security、journey、operations、commerce、catalog 通过。quality 停在完整门禁 `test:postgres` 的 `postgres-admin-catalog.mjs`：脚本打印“320 assertions PASS”后，连接池上未处理的 `57P01` 让进程崩溃。本机该脚本通过。b599f809 推送触发的那一轮会验证 5cfdf07f。

## 关键决策及理由

- **默认地点放在“每次启动检查”的步骤，而不是首次 bootstrap**：首次 bootstrap 只在新实例运行一次，改它对已有的 stg 无效。stg 自己会跑启动流程，所以部署后重启一次就配好了，不需要额外的服务器命令。检查条件是“已发布默认配置没有地点”，已有地点一律不动，所以重启是空操作。这与首页启动步骤“按数据库现状判断”的模式一致。
- **库存地点经正式审计接口创建，不用 SQL 直插**：0020 起 `inventory_locations` 有延迟触发器，要求审计行、活的 MFA 会话、`inventory.manage` 权限和回执，裸插入在 COMMIT 时会失败。做法是复用 `withLocalHomepageSessions`：先登记会话 id 再插入，`finally` 中必定撤销，进程崩溃后下次启动也会撤销遗留会话。默认配置版本本身没有审计要求，直接 SQL 发布，顺序固定为：新版 DRAFT → VALIDATED → 旧版 SUPERSEDED（`AND lifecycle='PUBLISHED'`，影响行数不是 1 就回滚）→ 新版 PUBLISHED。每种配置只能有一个 PUBLISHED，所以旧版必须先退出。
- **默认配置写 `inventory_policy='TRACKED'`**：0022 的约束要求“TRACKED 当且仅当有地点”。已核对，这个字段除了透传给后台上下文没有任何读取者：表单对普通礼物固定默认“按需采购”，只有艺人展示参数会被另一处读取。所以对普通礼物零影响，只是运营选“限量现货”时也有了默认地点。
- **CI 管理中心运行时直接选已有地点**：catalog 组用的是另一套运行时（`management-center-runtime.mjs`，不走本地体验启动）。`seedGiftStorefront` 已经经 API 建好两个 ACTIVE 地点，按 `location_key` 排序取第一个；没有地点就报错，与同函数里“没有市场就报错”的写法一致。
- **新步骤失败会阻断启动**：与政策启动步骤一致，不默默跳过，否则 stg 会表面正常、实际仍建不了心愿。
- **媒体冲突只改分类、不改重试用尽路径**：本次只出现一次 40001，修正分类后会被正常重放。重试用尽时仍是 `MANAGEMENT_UNAVAILABLE`（运营可重试），这条路径有 Mario 的单测约定，所以没有扩大改动。媒体 worker 对“返回 CONFLICT”和“抛出事务失败”都归为 `UNAVAILABLE`，行为不变。
- **门禁脚本的修法都不放宽检查**：theme 的替身表只在“表不存在”时临时存在，造完即删；回滚守卫改为直接执行 down SQL 期望 55000，证明力不变，且不再受以后新增迁移影响。这是 Mario 修 delivery-proofs 时的同一做法。
- **没有在 stg 上建测试心愿**：心愿会出现在公开商城，按此前记录需要用户同意。心愿整链已由 CI catalog 在真实 PG、S3 和浏览器上验证。

## 在途

- **没有改到一半的代码**，本地与 origin 同步。
- **被拒的读取，待用户决定**：读取 `packages/persistence-postgres/scripts/postgres-admin-catalog.mjs` 收尾部分（约第 74–100 行与第 1120–1140 行）时，被自动模式拒绝，没有给原因。按规则没有换方式去读。CI 上 quality 正卡在这个脚本的收尾崩溃。

## 需要用户知情或决定

1. **admin-catalog 收尾 57P01**：需要你放行读取该脚本，或者你来定处理方式。从输出看是集群关闭时连接池仍持有空闲连接、且没有 error 监听。本机通过、CI 崩溃，属于时序问题。
2. **admin-exceptions-postgres.mjs**：b0270006 起的既有失败，属于 Mario 的后台异常模块。本机在脚本早期就崩于 Client 上未处理的 57P01，没有打印结果，不只是收尾问题。它排在 test:postgres 最后一个，修好 admin-catalog 后就会成为 CI 的下一站。
3. **stg 心愿整链复验**：Mario 计划的整链复验现在不再被库存地点卡住，但会在公开商城新增测试心愿，是否进行请定。
4. 本轮改了 Mario 的代码或脚本，请转告 Mario：媒体处理仓储的冲突分类（1bbf4390）、theme/hero 用例（6a9715a7）、支付参数用例（e329cc91）。
5. 上一份交接遗留的知情事项不变：发布冲突重排队 811d10f6、check-runtime 与 check:contracts 改动、L3-14 管理员可删管理员、经纪人可看待审核留言、付款区保持展开 85f4cbcd。

## 下一步

1. **先看 b599f809 那轮 CI**：确认 quality 越过 private-notes 与 staff-deletion；看 admin-catalog 是否再次崩溃。如果用户放行读取 admin-catalog 脚本，按“先 `persistence.close()`、`client.end()`，确认没有残留连接后才让集群关闭；必要时给 Pool/Client 加 error 监听，只吞 57P01”的思路修。admin-exceptions 修之前先和用户确认，因为是 Mario 的模块。
2. 完整门禁在 test:postgres 之后还有 `test:s3`、prettier、eslint、全量 typecheck/test/build、`check-build-artifacts`，CI 上是否会逼近 120 分钟上限还没有数据。越过 test:postgres 后记录各子步骤耗时。
3. 偶发观察：operations 支付设置七语矩阵 es-390 登录超时（`admin-orders-runtime.mjs:279` 等 `.mc-account` 60 秒）出现过一次；ui-composites 挂起这两轮没再出现。如果 ui-composites 再挂，按上一份交接的方案给单场景加超时。
4. 动效夹具页 JS 余量约 4.7KB（不变）。T-12 不变。

## 环境注意

- **CI 附件**：用 `gh api repos/{owner}/{repo}/actions/artifacts/<id>/zip > x.zip` 下载，比 `gh run download` 快一个数量级；附件 id 用 `gh api .../runs/<run>/artifacts` 列出，单个作业跑完就能下，不必等整轮结束。整轮没结束时 `gh run view --log-failed` 拿不到日志，用 `gh api .../actions/jobs/<jobId>/logs`。
- **本机逐脚本跑 test:postgres**：`node output/checks/theme-pg/run-each-postgres.mjs <输出目录>`，不短路，每个脚本单独记退出码，63 个约 70 分钟（每个脚本起临时集群约 67 秒）。之前要先 `pnpm --filter @fan-support/persistence-postgres run build:with-dependencies`，跑的过程中不要重建持久层 dist。
- **PG 脚本只打印错误码时**：在 scratchpad 写小脚本生成调试副本，给 `pg` 的 `Client.prototype.query` 打补丁，打印失败语句的 SQLSTATE、报错首行和语句开头。不要用 sed 往文件里写带 `\n` 的内容（又踩了一次，会变成真换行）。
- **本地体验的 node 测试**（`apps/api/scripts/local-experience*.test.mjs`）在 Windows 上有 45 个既有失败，原因是要求 POSIX 绝对路径，与改动无关；新测试单独跑。
- **stg 就绪判断**：systemd 日志里就绪输出是多行 JSON `"ready": true`，不是 `{"stage":"ready"}`。
- **管理中心浏览器整链**本机跑不了（需要 S3 模拟），靠 CI catalog 验证。
