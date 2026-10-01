# 交接：完整门禁 PostgreSQL 关闭竞态与陈旧脚本；stg 心愿整链验收；后台心愿卡片

> 日期：2026-10-02（凌晨）
> 执行：Claude（Windows 端）
> 分支：`v2/r1-production`，本文件提交后与 origin 同步。stg 已部署到 e07161fa。
> 冷启动顺序：AGENTS.md → SPEC §0.3–0.9 → [上线计划](../plan/2026-09-28-flexible-storefront-launch.md) → [当前进度](../progress/launch-progress.md)（“CI 回归（PR #16）”行开头一段是本轮记录）→ 本文件
> 上一份交接：[2026-10-01-default-stock-location-and-full-gate-postgres.md](2026-10-01-default-stock-location-and-full-gate-postgres.md)

## 背景

按上一份交接推进草稿 PR #16 的 CI 回归。用户本轮决定：上一份交接里的未定事项都按 Claude 的建议处理，涉及远端协作者 Mario 的部分（admin-exceptions 脚本、stg 心愿整链复验）这次一并做完。目标是让 quality 组越过完整门禁 `pnpm check` 里的 `test:postgres`，并在 stg 真实域名验收心愿整链。

## 已完成

| 提交 | 内容 | 验证 |
|:--|:--|:--|
| 1653ea03 | **持久层关闭竞态**（admin-catalog 收尾 57P01 的根因）：pg-pool 的 `end()` 在空闲连接真正断开前就返回，`close()` 随即摘掉池的 error 监听；服务器紧接着停机时，迟到的 57P01 经池的空闲监听抛成未处理错误。node-postgres 适配器在调用 `end()` 时挂上只吞关闭中迟到错误的监听，持久层自身监听的约定不变 | 新单测在旧代码上红；持久层 862 项通过；admin-catalog 本机 320 项 |
| 55785f88 | **测试集群停机前等连接离开**：15 个持久层脚本自带原始 `pg` 池工厂，不经过适配器，CI 下一轮就在 publication-runtime 上复现同一崩溃。`withNativeTestPostgres` 停机前经自己的短连接轮询 `pg_stat_activity`，等到没有其他客户端后端再 `pg_ctl stop`（套件没关的连接最多等 5 秒） | 新单测在旧代码上红；四个原始池脚本真实 PG 通过且耗时不变；**run 36901344960 quality 首次越过持久层全部 63 个脚本** |
| 3ccae5a0 | **admin-exceptions-postgres.mjs**（Mario 的异常处理模块）：0037 往返改在 0037 为迁移头时做，再迁到最新继续；结尾“降级被拒”改为直接执行 0037 down SQL 断言 55000 与守卫原文、核对迁移头不变（原断言靠迁移器“不是迁移头”空过）；Client 加关闭期 error 监听，失败时不再被 57P01 盖住；改用标准池 | 本机 54 项；CI 通过 |
| e07161fa | `admin-orders-parameters.mjs` 写语句 8→9（第 9 条是我们 09-26 F1-1 c41ef5b2 加的）；`postgres-notification-submissions.mjs` 的 0050 往返改在 0050 为头时做 | 本机 9、4 项 |
| 55285906 | `notification-submission-fixture.mjs`（通知提交整链，需 S3）：回滚 0050 后断言头仍是 0050，改为直接探测 0050 down SQL 守卫、核对迁移头与日志行不变 | 探测逻辑在真实 PG 上用空日志与一行日志各验证；整套待 CI |
| c83d186e | `gift-commerce-http-fixtures.mjs`：夹具把礼物归为未绑定艺人的 WISH，SPEC 6.3.0 起不报价、不随艺人筛选出现；改用 PHYSICAL（与 0392bfc3 同类） | CI 通过（1658 项） |
| 4555bad8、c14ce6ed | `storefront-protocol.mjs`：先加诊断（公开读取状态不符时打印路由/状态/code，首页聚合失败时逐一读取各组成部分），据此查明失败的是最后一条“归档主视觉艺人→整页 503”：与 T-9（be411377，ADR-012 增补“删除主视觉艺人保留海报、去掉艺人链接”）冲突，改为期望 200、主视觉槽 UNAVAILABLE、其余槽可用 | CI storefront 通过 |
| 016f9555 | 共享浏览器登录 `authenticate()`（`admin-orders-runtime.mjs`）超时诊断：打印路径、登录按钮数、提示文字与最近 12 个后台 API/身份源响应的方法+路径+状态（无查询串与令牌），行为不变 | 待 CI 复现时取证 |
| f8500522 | `cart-runtime-rollback-proof.mjs` 失败时打印模式、步骤、错误名、SQLSTATE（迁移器与断言消息为固定文本才打印），行为不变 | 随本文件推送，待 CI |
| 4854696b | **后台礼物列表心愿卡片**：类型、“艺人 · 状态”、价格挤在一行，价格被拆成“US$ / 23.0 / 0”；心愿行单独成行、价格不换行 | 新单测在旧代码上红；后台 641 项通过；stg 真实布局检查通过；CI catalog 通过 |
| 9b151d4f、d4fc025b | 进度表：CI 行本轮记录、心愿与结账精简与选择器的公开 TEST 结果、stg 部署 | — |

**stg 心愿整链**（`output/checks/stg-wish-chain/stg-wish-chain.mjs`）：e329cc91 上 38 项、e07161fa 上 41 项全过。覆盖 Mario 交接要求的全部要点：正常后台新建 QA 艺人与绑定它的心愿 → 艺人页列出 → 心愿页写明唯一收礼人、无数量框 → 以别的艺人打开不提供购买，把加购请求的收礼人改写为别的艺人被拒（409 `IDOL_UNAVAILABLE`）→ 购物车里在署名/匿名/不公开之间切换 → 确认后直达 TEST 付款页并付款 → “Wish supported”、心愿停售、展馆按艺人显示署名 → 查单页撤回后展馆不再显示。之后整行退款（记录变“Support withdrawn”，心愿不重新出售），删除 QA 心愿与艺人（两页 404），展馆条目数回到运行前。另加：后台卡片价格单行；选择器用 stg 已有艺人资料按姓名列出、7/7 显示头像（Mario“心愿艺人头像选择修复”要求的复验）。

**stg 部署 e07161fa**：冷备份 `~/backups/stg-pre-e07161fa-20261002`（852M/4876 文件，回滚 e329cc91），构建命中缓存 89 秒，无迁移、无新权限、未跑 sync-roles；17 条公开路由与部署前一致（`output/checks/stg-deploy-next/`）。

**CI**：连续四轮（run 36896344778、36901344960、36905620329、36914618202）Security、journey、commerce、catalog 通过，operations 只在 36910405617 失败一次（见下文第 3 项，36914618202 已通过）。quality 的完整门禁逐站推进：持久层 `test:postgres` 63 个脚本全过；根链 API 套件已通过 catalog、admin-content、content-authoring、base-content、resource-management、publication-preflight、publication-runtime、admin-workspace、gift-commerce、storefront、gift-storefront、storefront-acceptance（32461 项）共 12 个。**最新停在 `test:postgres:cart`（run 36914618202，016f9555）**：日常发布之后第二次（DYNAMIC 模式）运行 `cart-runtime-rollback-proof.mjs` 时以 `kind=RUNTIME` 失败，没有 SQLSTATE。已加步骤诊断（f8500522，随本文件推送）；下一轮日志里 `Cart rollback proof diagnostic` 一行会给出停在哪一步（共享守卫回退到 0028、0028–0024 各步回退、0023 守卫探测、升回最新）以及迁移器消息（如 `migration 00xx up failed`）。

## 关键决策及理由

- **关闭竞态在两层修，而不是给每个脚本加 error 监听**：生产停机时数据库同时重启也会碰上同一竞态，所以适配器要修；但 15 个持久层脚本和若干 API 脚本自带原始池工厂，逐个改既繁琐又改不全，而且新脚本还会再犯。测试集群停机前等连接离开，一处修好全部，正常关闭的池几毫秒内断开，不拖慢套件；真正泄漏连接的套件最多多等 5 秒，之后照旧停机（泄漏本身仍会暴露）。
- **不保留“吞掉 57P01”的脚本级补丁**：上一份交接设想过“必要时给 Pool/Client 加 error 监听，只吞 57P01”。根因查清后没有这么做：吞错误会把真泄漏也藏起来。admin-exceptions 的 Client 监听是唯一例外，因为那里要让脚本自己的失败原因先报出来，不能被停机错误盖住。
- **“全量迁移后回滚旧版本”的断言一律改写**：迁移器只允许回滚当前迁移头（0064 之后的行为），旧脚本里“回滚 00xx 被拒”的断言要么必然失败，要么靠“不是迁移头”空过。做法与 5cfdf07f、Mario 修 delivery-proofs 相同：往返在目标版本为头时做；守卫用直接执行 down SQL（事务内、回滚）断言 55000 与守卫原文，并核对迁移头不变。证明力不变，以后新增迁移也不会再坏。
- **gift-commerce 夹具改 PHYSICAL 而不是绑定心愿**：这个套件测的是价格头与库存策略（含 TRACKED/PREORDER 多规格），心愿按规则只能一份、单规格，绑定后反而测不了原来的东西。心愿整链另有专门套件和 stg 验收。
- **stg 心愿复验用临时 QA 艺人并在结束时清理**：心愿会公开展示且只能支持一次；绑到用户已有艺人会在其页面留下永久“已支持”的心愿。用临时艺人，跑完退款、撤回、删除（归档），公开商城回到原状。每次运行仍会留下一笔已退款的 TEST 订单和归档的 QA 记录（和以往 stg 验收一致）。
- **已支持心愿页的提示文案没改**：心愿被支持后，购买区沿用通用提示“This option cannot be sent to the selected artist.”，读起来像选错了艺人。这是文案取舍，而且读取 `apps/storefront/src/storefront/gift-purchase.tsx` 的 Offer 段时被自动模式拒绝（未给原因），按规则没有绕道去读，留给用户或 Mario 定。

## 在途

- 没有改到一半的代码；本地与 origin 同步。
- 推送本文件会触发新一轮 CI（含 f8500522 的诊断），结果由下一个会话查看。

## 需要用户知情或决定

1. **已支持心愿页的提示文案**（见上）：建议改为与状态一致的“已被支持”类说明；需要放行读取 `gift-purchase.tsx` 或由 Mario 改。
2. **请转告 Mario**，本轮改了他的代码或脚本：`admin-exceptions-postgres.mjs`（3ccae5a0）、后台礼物列表心愿卡片布局（4854696b，`list-view.tsx` 与 `management-center.css`）、通知提交整链夹具（55285906）、gift-commerce 夹具分类（c83d186e）、storefront 协议的主视觉归档断言与诊断（4555bad8、c14ce6ed）、共享浏览器登录的超时诊断（016f9555，`admin-orders-runtime.mjs`）；共享代码：持久层适配器关闭（1653ea03）、测试集群停机（55785f88）。stg 心愿整链已按他的清单在真实域名通过。
3. **operations 登录超时第二次出现**：run 36910405617 的异常重放七语矩阵在 es-390 等 `.mc-account` 60 秒超时；上一次（run 36875313892）在支付设置矩阵，也是 es-390。两个矩阵顺序都是七语 × (390, 1440)，es-390 都是**第 11 次登录**；前 10 次每次都有“未登录 session 查询 401”与“OIDC 回调 303”两条记录，第 11 次两条都没有，即登录请求没走到回调。代码里管理员登录没有限流（已查 API、BFF、迁移），根因未定；已加诊断（016f9555），下次复现时日志会有 `Admin sign-in diagnostic` 一行。
4. 上一轮被取消的 run 36889208233 里 journey 与 quality 都跑了 55 分钟以上（正常 12–28 分钟），取消时附件没有上传，挂起位置不明；之后两轮未再出现。
5. 上一份交接遗留的知情事项不变：发布冲突重排队 811d10f6、L3-14 管理员可删管理员、经纪人可看待审核留言、付款区保持展开 85f4cbcd。

## 下一步

1. **看 CI 下一站**：先读最新一轮 quality 附件里 `Cart rollback proof diagnostic` 一行，按停住的步骤修 `test:postgres:cart`（候选：回退 0064→0028 途中某个 down 守卫因日常发布写入的历史拒绝，或升回最新时带数据升级的迁移失败；对照“需要回滚旧版本”的同类修法）。之后 quality 在根 `test:postgres` 链上继续逐站推进，剩余（按顺序）：cart-storefront、checkout-preflight、payment-runtime、payment-action-refresh、order-payment、order-access、commerce-expiry、notifications、notification-submissions、zeptomail、admin-access、production-admin-oidc、admin-orders（持久层、API 各一）、admin-order-resends、admin-finance（两个）、admin-payment-configuration、admin-exceptions（API）、wishes、storefront-brand；之后 `test:s3`、prettier、eslint、全量 typecheck/test/build、`check-adapter-boundaries`、`check-build-artifacts`。本机能跑的只用 PG 的套件已逐一跑过（只查出并修了上面几个），其余需要 S3 模拟（本机无 Docker），只能靠 CI。常见失败类型：未绑定 WISH 被当成可售（看 SPEC 6.3.0）、全量迁移后回滚旧版本、写死的条目数。
2. 越过 test:postgres 后记录完整门禁各子步骤耗时，看 120 分钟上限够不够（这一轮持久层部分约 15 分钟，前八个 API 套件约 10 分钟）。
3. operations 登录超时（见“需要用户知情”第 3 项）：再出现时先读日志里的 `Admin sign-in diagnostic`，看第 11 次登录停在哪个请求。ui-composites 挂起未再现，若再挂就给单场景加超时。

## 环境注意

- **本机逐套件跑根 test:postgres 后半段**：`node output/checks/full-gate/run-each-root-postgres.mjs <输出目录> [起始序号]`，不短路，每个套件内逐步记录退出码与耗时。需要 S3 的套件本机一律 2 秒内在初始化失败（日志里有 `ephemeral-s3-harness` 帧或 `versity-start-failed`），属于环境限制，不是回归。
- **stg 心愿整链脚本**：`node output/checks/stg-wish-chain/stg-wish-chain.mjs`，约 5 分钟；会在 stg 留下一笔已退款 TEST 订单和归档的 QA 艺人/心愿，结束时自动删除买家会话文件、暂停 qa.check。结账精简后 TEST 通道确认即直达付款页，旧脚本里等 `[data-payment-create]` 会超时。
- **heredoc 里的反斜杠又丢了一次**：用 `node -` 读 heredoc 做字符串替换时，锚点里的 `\W` 变成了 `W`（脚本因锚点不匹配而中止，文件未改）。含反斜杠的编辑一律用 Edit 工具。
- **check:dev 的 5 秒超时误报**：持久层三个“在 SQL 之前拒绝”类单测在并行负载下 5 秒超时，单独跑 862 项全过；按惯例用 `turbo run test --concurrency=1 --continue` 串行复跑。
- **被取消的 CI 作业不一定上传附件**：工作流的 `if: always()` 在取消时也没能保住 quality/journey 的附件。
