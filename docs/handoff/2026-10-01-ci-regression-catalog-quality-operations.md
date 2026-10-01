# 交接：CI 回归——catalog-fallback-seo 修通，catalog / quality / operations 一路推进；journey 偶发 SAVE_GIFT 已抓到发布阶段失败

> 日期：2026-10-01（晚）
> 执行：Claude（Windows 端）
> 分支：`v2/r1-production`，本文件提交后与 origin 同步。stg 仍在 826fceb4（本轮没有部署）。
> 冷启动顺序：AGENTS.md → SPEC §0.3–0.9 → [上线计划](../plan/2026-09-28-flexible-storefront-launch.md) → [当前进度](../progress/launch-progress.md)（“CI 回归（PR #16）”行开头几段是本轮记录）→ 本文件
> 上一份交接：[2026-10-01-l3-13-l3-14-notes-and-staff-deletion.md](2026-10-01-l3-13-l3-14-notes-and-staff-deletion.md)

## 背景

上一份交接把“CI 回归，先修 `catalog-fallback-seo`”列为下一步。本轮从它开始，把草稿 PR #16 的 CI 一组一组往前推：catalog、quality、operations 三组此前都停在各自的“既有失败”，后面的步骤自 09-28 前后起就再没被执行过，所以每修通一处都会暴露下一处。同时按计划给 journey 偶发的 SAVE_GIFT 超时加了诊断，并且已经抓到了一次真实失败的证据。远端协作者 Mario 本轮推了 5372a8b3、10c1529b、7af78868 三个商城提交，CI 因并发设置被取消过几次。

## 已完成

| 提交 | 内容 | 验证 |
|:--|:--|:--|
| 943a0a7f | **catalog-fallback-seo 根因修复**：测试 API 组合 `createTestPublicationRuntimeComposition` 补上正式组装里的四个公开展示接口（首页布局、主题、导航、信息页）；回归脚本取正文时去掉 `<script>`，首页先断言大图区存在，超时失败记录错误首行 | 单测先红后绿；`check:dev` 全过；本机夹具验证；CI run 36826573401 起 `fallback-seo` 通过 |
| 09d25956 | journey 失败时在停机前只读快照管理操作与媒体任务的状态字段、连接与锁等待计数，写 `durable-work.json` | 单测；真实 PG 迁移后执行；CI 已产出（见“在途”） |
| dd6e84c4、e68fb32d | quality 组合件：原生 200% 缩放下 Linux 经典滚动条造成的小数视口与“可视视口=innerWidth”误判 | 单测先红后绿；CI 上 `ui-composites` 首次通过 |
| 0392bfc3 | catalog 验收夹具：有专门场景的礼物（0–7、24）不再被轮转成未绑定艺人的 WISH；目录独立期望按 SPEC 6.3.0 心愿规则 | CI 上目录价格检查通过 |
| 85f4cbcd | **后台产品修复**：付款区里退款/对账成功后订单整体重载，“付款与退款”不再折叠回去（L2-12 引入的缺陷） | 单测先红后绿；后台全量 613 项；`check:dev` 全过；CI operations 越过原失败点 |
| 64ae4cc3 | 三处“归档 → 503”过时期望改为 404（对应 1717eda0 的“已删除即 404”） | CI 上 `storefront-seo-cache` 整步通过 |
| 6e5b4227 | 财务浏览器脚本：等付款面板加载完再决定是否点开（结果未知的订单会自动展开） | 待本轮 CI |
| 02004d2e | 礼物详情简介检查接受“只有副标题”（旧结构化长文按 SPEC 6.1.0 不显示） | 待本轮 CI |
| faf18511 | worker 子进程也报告回滚的数据库错误（SQLSTATE/触发器/约束名）；journey 失败时汇总成 `postgres-failures.json` | 单测；真实 PG 端到端探针 |

CI 进度（逐轮最新）：Security、commerce 稳定通过；journey 多数通过、偶发失败；catalog 已通过 `fallback-seo` 和 `storefront-seo-cache`（验收协议 + 七语浏览器矩阵），下一步 `catalog-gifts`、`management-publication`；operations 已越过退款对账；quality 已通过 `regression-tools` 与 `ui-composites`，停在 `ui-motion`。**本轮最后一次推送（faf18511，run 36836295708）的结果见文末“最新 CI”**。

## 关键决策及理由

- **catalog-fallback-seo 的真正根因不是“首页聚合读取不回退”**（之前的嫌疑）。我先用临时测试证明内容层聚合投影在日语缺失时能正常回退，再顺着截图（只有错误卡片、没有礼物区和分类区）锁定页面工厂的“布局读取失败”分支，最后本机实测确认：测试组合根本没挂 `/api/v1/storefront/home-layout`，返回 404，回归里的首页**自 09-28 起每种语言都只渲染错误卡片**。旧检查 en/zh-CN/th/vi 之所以“通过”，是因为 `main.textContent` 把 JSON-LD 脚本也算进去了，而夹具的 seoTitle 恰好等于首页标题；日语回退页是 noindex、不输出 JSON-LD，所以只有日语失败。Mario 在 b30e1cb3 改成定位首页标题后，变成 en 就等满 30 秒超时。
- **补接口放在测试组合里，而不是只改回归运行时**：礼物商城、管理中心、购物车等测试运行时都用这个组合，都缺这四个接口；放在组合里一次补齐，和正式组装一致。代价是 stg 的本地组装里这四个接口改由测试组合的连接池提供（同一个库），行为不变。
- **夹具改类型而不是改所有期望**：第 1 件礼物是“仅剩 1 件、数量上限 1”的专门场景，却被轮转成了未绑定 WISH（按 SPEC 6.3.0 不能购买）。如果把各处期望都改成“不可购买”，会丢掉库存上限的覆盖，所以让有专门场景的礼物不做未绑定 WISH，其余 WISH 照心愿规则期望。
- **付款区折叠是产品缺陷，不只是测试问题**：操作员刚在付款区完成退款或对账，页面一重载区块就收起，“已记录”提示也跟着消失；面板本来就设计成“刚记录就自动展开”，只是被外层重新挂载抵消了。所以修在后台（订单工作区记住刚操作过的订单），而不是让脚本多点一次。
- **ui-motion 的长任务预算没有放宽**：phase-6 记录明确“不得预设根因或放宽帧率阈值”。现象是连续两轮同一场景（泰语 768×1024）在首屏加载期 185–200ms 出现一个 57–70ms 长任务，预算为 0。这需要用户或 Mario 决定（见下一步）。
- **journey 诊断先查数据库状态，再查数据库错误**：本地实例的管理操作由 API 测试组合里的运行时处理，结果不记日志；媒体 worker 的 `media_processing.run` 不在可观测性事件白名单，实际被换成 `observability.invalid_event`（既有问题，没改，改白名单是共享安全边界）。所以先从数据库只读快照状态字段，第一次就抓到“发布阶段 PUBLICATION_FAILED、媒体全部成功”；再把 supervisor 里已有的“只报 SQLSTATE/触发器/约束名”补丁装进 worker 子进程，下一次失败就能看到是哪个约束或守卫。

## 在途

- **没有改到一半的代码**，本地与 origin 同步。
- **journey 偶发 SAVE_GIFT**（run 36833431183 的附件 `output/checks/ci-catalog-seo/run-36833431183-journey/`）：`SAVE_GIFT` 状态 FAILED、阶段 PUBLISH、失败码 `PUBLICATION_FAILED`（可重试）、尝试 2 次，创建约 4 秒后失败；所有媒体任务 SUCCEEDED。`PUBLICATION_FAILED` 只在发布事务抛出 `INTEGRITY_VIOLATION`、`TRANSACTION_ABORTED` 或 `UNEXPECTED_ADAPTER_FAILURE`（且重试后仍失败）时记录（`packages/application/src/management-center.ts` 的 `recordRolledBackPublicationFailure`）。faf18511 那一轮的 `postgres-failures.json` 已确认是 3 次 40001 可串行化冲突（见“最新 CI”），修法见下一步第 2 项，代码尚未改。
- **ui-motion 长任务**：待决定，见下一步。
- **Quality 作业（`pnpm check`）**仍失败在 Mario 3415a527 的 `decoration.css` 像素值（`check:design-foundations`），没动他的文件，需转告。
- **stg 没有部署**本轮任何改动。85f4cbcd（后台付款区保持展开）是唯一的产品改动；测试组合与诊断改动也会影响 stg 的本地组装（四个公开接口换连接池、worker 记录数据库错误），行为不变。下次部署 stg 一并带上，并会带上 Mario 的结账精简（10c1529b）和品牌标志（7af78868）。

## 需要用户知情或决定

1. **ui-motion 长任务预算**（新）：二选一——(a) 把“长任务=0”限定在页面加载完成之后的动效与交互阶段（这正是动效门禁要保护的），加载期只记录不判失败；(b) 保持现状，先在 CI 抓性能剖析找泰语首屏加载期的根因。我倾向 (a)，但这是放宽门禁口径，需要你点头。
2. 任何工作室管理员都能删除其他管理员（含 `studio.owner`，L3-14，上一份交接已列）。
3. 经纪人能看待审核的留言（L3-12 起维持）。
4. Mario 的心愿整链复验会在 stg 公开商城新增测试心愿，尚未做。
5. 艺人页底部收尾引导文案是否也撤（L2-17 遗留）。
6. 后台付款区改动（85f4cbcd）属于小的体验修复，没有改规范；如果你希望刚操作过的付款区仍然折叠，告诉我即可回退。

## 下一步

1. **catalog 最后一步**：`apps/api/scripts/management-center-browser.mjs` 的 `default management entry exposes only artists, gifts and posters` 改为与当前管理中心一致的分区集合（按角色：超管、日常运营、经纪人各自可见的分区；以 `apps/admin` 的分区定义为准，不要照抄截图）。改完推送，看 `management-publication` 后面的步骤。这是 catalog 整组通过前的最后一步。
2. **journey 偶发 SAVE_GIFT（产品修复，先写失败测试）**：在 `packages/application/src/management-center.ts` 的发布路径里，进程内重试用尽后如果错误仍是 `TRANSACTION_ABORTED` 且 `recovery === "RETRY_SAME_COMMAND"`（40001/40P01 这类瞬时冲突），改为 `operations.defer(fence)`（重新排队，约 2 秒后再领取；超过 `authorized_until` 时领取环节会自动标 `NEEDS_AUTHORIZATION`，不会无限循环），而不是记 `PUBLICATION_FAILED` 终态；`INTEGRITY_VIOLATION` 和 `UNEXPECTED_ADAPTER_FAILURE` 仍记 `PUBLICATION_FAILED`。测试：应用层单测覆盖“三次 40001 → PENDING/重新排队”，以及完整性冲突仍失败；改的是 Mario 写的日常发布核心，提交前告知用户转告他。
3. **把“需要用户知情或决定”带给用户**（第 1 项 ui-motion 长任务是本轮新增）。用户定了以后改 `scripts/verify-ui-motion-browser.mjs` 第 791 行附近的判定。
4. 下次部署 stg 时带上本轮与 Mario 的改动，抽查后台订单付款区（退款后保持展开）。
5. T-12：不变。

## 环境注意

- **测试运行时缺接口的排查法**：在本机用 `createApiApplication(env, {})` + `inject` 能直接看到未挂载路由返回 `{"code":"NOT_FOUND"}` 的 404（探针在 `output/checks/ci-catalog-seo/probe/home-layout-404.mjs`）。新增公开商城接口时，测试组合也要挂。
- **浏览器断言取文本要去掉 `<script>`**：`main.textContent` 会包含 JSON-LD 和流式渲染的脚本内容，造成误通过。
- **Mario 推送会取消在跑的 CI**（同分支 concurrency）。本轮被取消了三次。我自己的修改尽量攒到当前一轮关键组出结果后再推。
- **CI 附件下载**：catalog/journey/operations 的附件 14–20MB，`gh run download` 常超过 2 分钟，放后台；只能在整轮结束后下载作业日志（进行中时 `gh run view --log` 拒绝）。
- **ui-motion 本机跑不了**：它的证据锁调用 POSIX `ps -o`，Windows 的 Git Bash 不支持。
- **原生缩放检查会弹出有界面的 Chrome**（组合件、交互两个脚本），不要在用户桌面上本机跑。
- **本机 L2-17 夹具新增了 `layout404` 模式**（`output/checks/l2-17/harness/fixture-server.mjs`，`POST /__mode {"layout404":true}`），可复现“布局读取失败只渲染错误卡片”。
- **`test:regression-tools` 现在也跑 `apps/api/scripts/local-experience-postgres-failures.test.mjs`**（apps/api/scripts 下的 node 测试是按命令逐个点名的，新增时要登记）。

## 最新 CI（run 36836295708，faf18511，含 Mario 至 7af78868）

| 组 | 结果 | 说明 |
|:--|:--|:--|
| Security | 通过 | |
| commerce | 通过 | |
| **operations** | **整组通过** | 回归基线建立以来首次 |
| catalog | 前三步通过，停在最后一步 | `fallback-seo`、`storefront-seo-cache`、`gifts` 通过；`management-publication` 失败在 `default management entry exposes only artists, gifts and posters`（`apps/api/scripts/management-center-browser.mjs`，阶段 `initial-entry-and-session`）——此后管理中心陆续加了信息页、装修、订单、付款、异常、员工、账目等分区，属过时期望 |
| journey | 失败（偶发） | 诊断已给出根因方向，见下 |
| quality | 停在 `ui-motion` | 长任务预算，待决定 |
| Quality（`pnpm check`） | 失败 | Mario 的 `decoration.css` 像素值 |

journey 本轮附件（`output/checks/ci-catalog-seo/run-36836295708-journey/`）：`durable-work.json` 与上一轮相同（SAVE_GIFT 在 PUBLISH 阶段 `PUBLICATION_FAILED`，媒体全部成功）；`postgres-failures.json` 记录到 **3 次 SQLSTATE 40001（可串行化冲突）**，分别在守卫 `assert_management_authority`、`assert_daily_publication` 中和一处无守卫语句上。`retryManagementTransaction`（`packages/application/src/management-transaction-retry.ts`）进程内最多试 3 次，正好用尽，随后 `recordRolledBackPublicationFailure` 把操作记为终态 FAILED（可重试，但要人工点重试）。同一时段有一个 SAVE_ARTIST 也在发布（尝试 3 次后成功），后台页面也在高频轮询。
