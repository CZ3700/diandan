# 交接给 Mario：CI 完整门禁、stg 与 10-01 傍晚以来的改动

> 日期：2026-10-02
> 写给：Mario（远端协作者，暂时接手）
> 来自：Claude（Windows 端）
> 分支：`v2/r1-production`，起点 5fb1c926。我们这边没有改到一半的代码。
> 详细过程见 [2026-10-02-full-gate-postgres-and-stg-wish-chain](2026-10-02-full-gate-postgres-and-stg-wish-chain.md)、[2026-10-01-default-stock-location-and-full-gate-postgres](2026-10-01-default-stock-location-and-full-gate-postgres.md)；进度表“CI 回归（PR #16）”与“远程 TEST 环境 stg”两行开头是最新记录。

你最后一次提交是 10-01 16:46 的 7fa913d3。之后我们推了约 40 个提交，其中不少改到了你的代码或你常用的测试脚本，下文第 3 节逐条列出。

## 1. 现在的状态

- **草稿 PR #16**（`v2/r1-production` → `v2/r0-foundation`）只用来跑 CI，不合并。
- **CI**：最近几轮里跑完的 Security、journey、commerce、catalog 每次都通过，operations 只偶发失败过一次（见第 2 节第 3 条）。只剩 **quality**，也就是完整门禁 `pnpm check`。它已越过持久层 `test:postgres` 的全部 63 个脚本，以及根链上 12 个 API 套件：catalog、admin-content、content-authoring、base-content、resource-management、publication-preflight、publication-runtime、admin-workspace、gift-commerce、storefront、gift-storefront、storefront-acceptance（run 36920206117，5fb1c926）。
- **quality 当前停在 `test:postgres:cart`**：日常发布之后，第二次（DYNAMIC 模式）运行你的 `cart-runtime-rollback-proof.mjs` 时失败。f8500522 加的诊断显示：停在第一步“经共享守卫 `rollbackEmptyNotifications` 回退到 0028”，是空表断言（`legacy rollback probe requires an exact known head without ... admin history`）不过；输出被截断，没显示是哪一项非零。
  - **我们的判断（未实证）**：是 `filled_media_jobs`，即 `media_processing_jobs WHERE fit='COVER_ALLOW_ENLARGE'`。09-27 的 T-2（1f6a96cf，迁移 0041，日常图片一律铺满）把它登记进了守卫；而日常中心的图片任务只会以这种构图成功（`management-image-source.ts`），所以 `cart-daily-gift-fixture.mjs` 经管理中心上传礼物图片之后，这一步回退必然被拒。这条证明写于 09-16，早于 0041。
  - **建议**：DYNAMIC 这一次不再整段回退，改为直接在事务里执行 0028–0024 各自的 down SQL 断言守卫（55000），并核对迁移头不变；或者把 DYNAMIC 证明挪到日常发布之前，再另证“日常历史存在时回退被拒”。哪种更符合这条证明的原意由你定。你本机能跑 S3，先跑一次确认是哪一项非零。
- **stg** 在 e07161fa。之后的提交只有测试脚本和文档，不需要部署。

## 2. 接手后先做什么

1. **修 quality 当前这一站**（见上）。你的 Mac 跑过 HTTP+PG+S3 整链，应该能在本机直接复现：`pnpm --filter @fan-support/api test:postgres:cart`。我们这边没有 Docker，需要 S3 的套件只能靠 CI，所以排查起来慢。
2. **继续沿根 `test:postgres` 链往下推**。剩余套件按顺序是：cart（当前）、cart-storefront、checkout-preflight、payment-runtime、payment-action-refresh、order-payment、order-access、commerce-expiry、notifications、notification-submissions（55285906 已预先修了它的回滚断言）、zeptomail、admin-access、production-admin-oidc、admin-orders（持久层与 API 各一）、admin-order-resends、admin-finance（两个）、admin-payment-configuration、admin-exceptions（API）、wishes、storefront-brand。之后是 `test:s3`、prettier、eslint、全量 typecheck/test/build、`check-adapter-boundaries`、`check-build-artifacts`。120 分钟上限够不够还不知道：到 cart 约 35 分钟（持久层部分约 15 分钟），后面还有 20 多个套件。
3. **operations 偶发登录超时**：共享登录 `authenticate()`（`apps/api/scripts/admin-orders-runtime.mjs`）等 `.mc-account` 60 秒超时，出现过两次：
   - run 36875313892 的支付设置矩阵；
   - run 36910405617 的异常重放矩阵。

   两次都是“七语 × (390, 1440)”矩阵里的第 11 次登录（es-390）。前 10 次每次都有一条“未登录 session 401”和一条“OIDC 回调 303”；第 11 次两条都没有，说明请求没走到回调。代码里管理员登录没有限流，根因还没找到。016f9555 已加诊断：再出现时，日志里会有一行 `Admin sign-in diagnostic`，内容是路径、登录按钮数、提示文字，以及最近 12 个后台 API 和身份源响应的方法、路径、状态。这两个矩阵是你写的，你可能更快看出端倪。

## 3. 我们改了你的代码或脚本（请过目）

产品代码：

| 提交 | 位置 | 改了什么、为什么 |
|:--|:--|:--|
| 7f6a5804 | 你的 `BrandingProvider`（根布局） | 原来从合同包总入口在运行时导入默认值，把 Zod schema 打进了每个公开页面：JS 268KB，预算 150KB。改为只导入类型、本地给出同一默认值，降到 145KB，余量约 4.7KB。单测锁定它与 `createDefaultStorefrontBrandView()` 一致 |
| 811d10f6 | 日常发布核心 `packages/application/src/management-center.ts` | 发布事务在进程内重试用尽后，如果仍是 40001/40P01，改为 `defer` 重新排队，不再记终态 `PUBLICATION_FAILED`。完整性冲突和意外错误照旧。你原来“三次中止后记失败”的用例改成了“重新排队”，另加两个用例 |
| 1bbf4390 | 媒体处理仓储 | 保存点内的 40001/40P01 原来被吞成领域 `CONFLICT`（不可重试），现在改为抛出事务级 `TRANSACTION_ABORTED/RETRY_SAME_COMMAND`，由外层整段重放。唯一约束、版本冲突、产物冲突仍报 `CONFLICT` |
| 50d9d735 | admin `instrumentation.ts`、storefront `proxy.ts` | 改为经 `src/server` 下不带 `server-only` 的小模块读取配置，修复 `check-runtime`。行为不变 |
| 1cf89660 | 五个后台文案模块 | 按语言用 `switch` 取文案，不再重复声明完整的语言映射，修复 `check:contracts`。行为不变 |
| 4854696b | 后台礼物列表 `list-view.tsx`、`management-center.css` | 心愿卡片的“类型 / 艺人 · 状态 / 价格”原来挤在一行，价格被拆成“US$ / 23.0 / 0”。现在“艺人 · 状态”单独一行，价格不换行 |
| 1653ea03 | 持久层 node-postgres 适配器（共享） | pg-pool 的 `end()` 会在空闲连接真正断开前就返回，`close()` 随即摘掉监听，迟到的 57P01 就会让进程崩溃。现在调用 `end()` 时挂一个只吞关闭中迟到错误的监听 |
| 99b7397b | 本地体验启动、CI 管理中心运行时 | 默认库存地点，见第 4 节 |

测试与门禁脚本（行为调整都在提交说明里写了理由）：

| 提交 | 位置 | 改了什么 |
|:--|:--|:--|
| 55785f88 | `withNativeTestPostgres`（共享） | 停机前等其它客户端连接离开，最多 5 秒。持久层有 15 个脚本自带原始 `pg` 池工厂，不经过 1653ea03 的修复，靠这一层兜住 |
| 3ccae5a0 | `admin-exceptions-postgres.mjs` | 改为在 0037 是迁移头时做往返，再迁到最新；结尾的降级检查改为直接执行 0037 的 down SQL，断言 55000（原来实际靠迁移器“不是迁移头”空过）；改用标准池 |
| 6a9715a7 | theme/hero 的 PG 用例 | 0045 上造数时临时补一个空的 `wish_bindings` 替身；hero 用例固定升到 0058 |
| e329cc91、e07161fa、5cfdf07f、55285906 | 支付恢复参数、订单写语句数、通知提交与整链夹具、私密备注与删除员工 | 跟上当前 schema：参数 11→12、写语句 8→9；旧版本回滚改为在其为迁移头时往返，或直接探测 down SQL 守卫 |
| c83d186e、644330c1 | gift-commerce 夹具、管理中心礼物检查 | 未绑定艺人的 WISH 按 SPEC 6.3.0 不可售：gift-commerce 改用 PHYSICAL，管理中心检查按绑定心愿规则写 |
| 4555bad8、c14ce6ed | `storefront-protocol.mjs` | 加了失败诊断；“归档主视觉艺人→整页 503”改为按 T-9 规则断言（见第 4 节） |
| dacb98bd、e6b225c7、b15859fb | ui-motion、管理中心入口、check-ci/observability | 分别按用户决定和当前访问规则、当前依赖调整 |
| 016f9555、f8500522 | 共享登录、cart 回滚证明 | 只加诊断，行为不变 |

## 4. 用户已定、你需要知道的

- **心愿默认库存地点**（用户选了方案 a）：本地体验每次启动、API 就绪后检查已发布的管理默认配置。没有地点时，用一次性合成管理员会话经正式审计接口建 `STUDIO_DEFAULT`，再发布下一版默认配置指向它；已有地点不动。默认配置随之写 `TRACKED`，对普通礼物没有影响。CI 管理中心运行时直接指向已有的 ACTIVE 地点。stg 已经有地点。
- **ui-motion 长任务**只统计页面加载完成（`loadEventEnd`）之后的阶段。
- **艺人页底部**撤掉了“每份礼物，都有心意”（e477d727）。
- **删除主视觉艺人**（T-9，ADR-012 增补）：删除即归档，首页保留海报、去掉艺人链接；其它主视觉故障仍让首页失败关闭。你 09-07 写的协议断言已按此改。
- **你的几项已在 stg 公开 TEST 验证**（e329cc91 / e07161fa，真实域名，TEST PSP）：
  - 心愿整链 38、41 项全过，覆盖你交接里列的每一步，并在结束时退款、删除测试数据；
  - 结账精简：TEST 单一方式确认后直达付款页；
  - 心愿艺人选择器：用 stg 已有艺人资料，按姓名列出、7/7 显示头像。

  脚本是 `output/checks/stg-wish-chain/stg-wish-chain.mjs`（只在 Windows 端）。**没验证的**：结账的取消与恢复路径。进度表里你那几个条目的“公开 TEST”一行已经补上。

## 5. 这轮踩出来的几条规矩

- **迁移器只允许回滚当前迁移头**。“全量迁移后回滚 00xx”的断言要么必然失败，要么靠“不是迁移头”空过。往返请在目标版本为头时做；守卫请直接在事务里执行该迁移的 down SQL，断言 55000 与守卫原文，再核对迁移头不变（与你修 delivery-proofs 的做法相同）。
- **新加迁移**：除了 manifest 和 `expected-catalog.json`，还要在 `notification-rollback-prefix.mjs` 的 `supportedHeads` 和空表计数里登记，测试也要同步。漏登记会让多个套件的共享回退在 CI 里失败。
- **夹具里不要用未绑定艺人的 WISH 测可售场景**：未绑定的心愿只列出、不报价，按艺人筛选时也不出现。
- **新增公开接口**要同时挂到测试组合 `createTestPublicationRuntimeComposition`（catalog-fallback-seo 就栽在这里），以及 stg 用的本地组装。
- **测试里关连接池**：不需要在脚本里吞 57P01，上面两层已经兜住。但如果套件忘了关池，停机会多等最多 5 秒；某个脚本无故变慢，先看这一点。
- **CI 是同分支 concurrency**：任何一方推送都会取消在跑的一轮。quality 到关键站大约要 35 分钟，推送前请先看一眼有没有在跑的轮次。

## 6. 待用户定、涉及你的代码

- **已被支持的心愿页文案**：支持完成后，购买区沿用通用提示“This option cannot be sent to the selected artist.”，读起来像选错了艺人（截图：stg 心愿页 `SUPPORTED` 状态）。我们建议改成与状态一致的“已被支持”类说明，或者在已支持时不显示这一行。改动在 `apps/storefront/src/storefront/gift-purchase.tsx` 的 `Offer`，我们没有动，等用户定。

## 7. stg 与协作

- **stg 运维目前只在 Windows 端**：SSH、部署、`qa.check` 账号都在那边，凭据不在仓库里。你接手期间如果要部署或在 stg 上验收，请先找用户。stg 上留有几笔已退款的 TEST 订单和已归档的 QA 艺人/心愿（都是验收留下的）；`qa.check` 平时是暂停状态。
- 开工前请在 `docs/progress/launch-progress.md` 的“CI 回归（PR #16）”一行登记执行者。交接文档继续写在 `docs/handoff/`。
