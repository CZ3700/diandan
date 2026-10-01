# 交接：CI 回归——ui-motion 与 catalog 首次通过，完整门禁推进；心愿缺默认库存地点待决定

> 日期：2026-10-01（夜）
> 执行：Claude（Windows 端）
> 分支：`v2/r1-production`，本文件提交后与 origin 同步。stg 已部署到 b85173b1。
> 冷启动顺序：AGENTS.md → SPEC §0.3–0.9 → [上线计划](../plan/2026-09-28-flexible-storefront-launch.md) → [当前进度](../progress/launch-progress.md)（“CI 回归（PR #16）”行开头两段是本轮记录）→ 本文件
> 上一份交接：[2026-10-01-ci-regression-catalog-quality-operations.md](2026-10-01-ci-regression-catalog-quality-operations.md)（其中“Quality 卡在 decoration.css”的判断有误，已由 7fa913d3 更正）

## 背景

按上一份交接继续推进草稿 PR #16 的 CI 回归。用户本轮做了两个决定：ui-motion 长任务预算采纳 (a)，只统计页面加载完成之后的动效与交互阶段；艺人页底部那句收尾文案也撤掉。同时按计划修 catalog 最后一步、journey 偶发 SAVE_GIFT，并把本轮与 Mario 的改动部署到 stg。

## 已完成

| 提交 | 内容 | 验证 |
|:--|:--|:--|
| dacb98bd | ui-motion：长任务预算只算 `loadEventEnd` 之后；加载期长任务保留在证据里；无法定位的长任务、缺加载时间戳都按失败 | 测试先红后绿；CI run 36847160866 起 `ui-motion` 通过 |
| 7f6a5804 | **商城性能回归修复**：Mario 7af78868 的 `BrandingProvider`（根布局、客户端）从合同包总入口运行时导入默认值，把 Zod schema 打进每个公开页面；改为只导入类型、本地给出同一默认值 | 单测锁定默认值一致且只做类型导入；本机正式构建动效夹具页 JS 268,190 → 145,234 字节（预算 150KB，余量约 4.7KB） |
| e6b225c7 | catalog：管理中心入口改为按后台自己的上下文读取结果推导应见分区，要求完全一致，前三个为艺人/礼物/海报、默认停在艺人 | 新单测 `regression-management-entry.test.mjs`；CI 上该断言通过 |
| 811d10f6 | **发布核心修复（Mario 的代码）**：发布事务进程内重试用尽后仍是 40001/40P01 → `defer` 重新排队，不再记终态 `PUBLICATION_FAILED`；完整性冲突与意外适配器错误照旧 | 应用层 43 项，新用例旧实现 3 红；journey 本轮两次通过 |
| e477d727 | 艺人页底部撤掉“每份礼物，都有心意”标题；保留转交说明与“挑选礼物”按钮；暂停收礼的状态标题保留 | 七语单测先红后绿；本机 189 项；stg 真实域名七语双端通过 |
| b15859fb | 完整门禁脚本：check-ci 跟上 Stripe 构建、check-observability 跟上 fastify 5.12.4（均为我此前漏改） | 本机两项通过；CI 越过 check-ci |
| 50d9d735 | check-runtime：admin `instrumentation.ts`、storefront `proxy.ts` 经 `src/server` 下不带 `server-only` 的小模块读配置（Mario 09-28/29 引入） | 本机通过；admin/proxy 测试；新单测 |
| 1cf89660 | check:contracts：五个后台文案模块改 `switch`，证书测试改为两组合起来等于 `SUPPORTED_LOCALES` | 本机通过 |
| 644330c1 | catalog：四类礼物一步按心愿新规则改写（见“关键决策”） | CI run 36853235004 catalog 整组通过 |

stg：部署 b85173b1（含 Mario 0064 品牌标识、结账精简）。冷备份 `~/backups/stg-pre-b85173b1-20261001`（回滚 826fceb4），构建 7 分 35 秒，`sync-roles` 已执行；17 条公开路由与部署前一致；浏览器抽查 256 项通过（`output/checks/stg-deploy-b85173b1/`）。

**最新 CI（run 36853235004）**：Security、journey、operations、commerce、**catalog（首次整组通过）** 通过；quality 见文末。

## 关键决策及理由

- **ui-motion 按用户决定 (a)**：判定点用页面内 `performance.getEntriesByType("navigation")[0].loadEventEnd`，而不是脚本里 `goto` 返回后的时间——前者是浏览器自己的加载完成时刻，不受 Playwright 往返影响。缺时间戳按失败（fail closed），避免口径放宽后变成“拿不到证据也算过”。
- **JS 超预算不是口径问题**：Codex 复核（7fa913d3）提醒“不能只调整长任务口径就宣称修复”，确实如此。量化后定位到根布局客户端组件的总入口运行时导入；修法是只做类型导入，因为 `createDefaultStorefrontBrandView` 只是返回常量，但模块顶层的 Zod schema 链不会被摇树去掉。没有改合同包结构（影响面大）。
- **管理中心入口用“推导”而不是写死列表**：交接要求以 `apps/admin` 分区定义为准、不照抄截图。脚本只记录各读取是否授予（不保存响应体），推导规则镜像 `access.ts` 与侧栏顺序，单测覆盖超管全量、经纪人、CI 运行时三种组合。
- **重排队只针对瞬时冲突**：40001/40P01 是并发争用，人工“重试”没有意义；`defer` 重新领取时校验授权，授权过期即 `NEEDS_AUTHORIZATION`，不会无限循环。完整性冲突是真错误，仍要让运营看到失败。
- **艺人页只撤那一句**：用户原话是“那句收尾文案”，所以只撤标题，转交说明和按钮保留；若希望整块去掉，删 `artist-content.tsx` 的 `storefront-final` 区块即可。
- **门禁脚本的修法不改规则**：check-runtime、check:contracts 都是把代码改到合规，没有放宽检查本身。新 `src/server` 小模块不带 `server-only`，沿用 proxy 已引用的同目录模块（`information-page-preflight.ts`、`request-origin.ts`）的做法，避免在 proxy/instrumentation 层引入未验证的 `server-only` 行为。
- **心愿用例没有替运营配库存地点**：心愿固定限量 1 件，件数放在后台默认配置的库存地点；CI 运行时与 stg 都没配置，界面会提示“暂无可用的库存位置”。在 CI 夹具里随手配一个地点能让用例变绿，但会掩盖 stg 与正式环境同样建不了心愿的事实；这属于运营配置决定，所以脚本如实断言“未配置时拒绝且不发请求”，等用户决定后再补心愿整链。

## 在途

- **没有改到一半的代码**，本地与 origin 同步。
- quality 组：最新一轮在 `ui-composites` 挂起至超时，见文末“最新 CI”。

## 需要用户知情或决定

1. **心愿缺默认库存地点（新，阻塞 stg 心愿）**：stg 与 CI 的后台默认配置没有库存地点，运营在管理中心选“心愿礼物”后无法提交（stg 只读探测：`output/checks/stg-deploy-b85173b1/wish-form-probe.mjs`，0 次请求）。同样影响限量礼物。需要决定：(a) 给 stg（以及本地启动夹具 `local-experience-bootstrap.mjs`、CI 运行时）配置一个默认库存地点；或 (b) 让表单可选择库存地点（Mario 的心愿表单，属产品改动）。Mario 计划的“stg 心愿整链复验”也会卡在这里。
2. 发布冲突改为重新排队（811d10f6）改的是 Mario 的日常发布核心，请转告。
3. check-runtime 两处与 check:contracts 五个文案模块也改了 Mario 的文件（行为不变），请转告。
4. 上一份交接遗留：工作室管理员可删除其他管理员（L3-14）；经纪人可看待审核留言（L3-12）；后台付款区刚操作后保持展开（85f4cbcd，可回退）。

## 下一步

1. **先看本文件推送触发的那轮 CI 的 quality**。若 `ui-composites` 再次挂起：给 `scripts/verify-ui-composites-browser.mjs` 的单场景（`runScenario`）加超时，超时即失败并留下场景号、阶段与截图，而不是耗满 120 分钟（同样检查 `verify-ui-motion-browser.mjs`）；`page.evaluate` 里等待动画/图片的 Promise 没有超时，是重点嫌疑。若 ui-composites/ui-motion 通过而 `quality-repository-check` 超时：记录各子步骤耗时，和用户商量是拆分完整门禁还是调整作业上限（改 CI 时限属于门禁口径，需用户点头）。
2. 看 quality 组在完整 `pnpm check` 里的下一处失败，按同样方式修；此前记录过 `test:postgres` 有三个既有失败脚本（`postgres-delivery-proofs.mjs`、`postgres-payment-runtime-parameters.mjs`、`admin-exceptions-postgres.mjs`），很可能是下一站。
3. 用户就心愿默认库存地点做决定后：配置 stg（新配置版本，先冷备份）、本地启动夹具与 CI 运行时，并把 `management-center-browser.mjs` 的心愿用例补成整链（选艺人→发布→公开页限量 1 件、固定收礼人）。
4. 动效夹具页 JS 只剩约 4.7KB 余量，后续往根布局加客户端组件要注意。
5. T-12：不变。

## 环境注意

- **本机测 JS 传输量**：`output/checks/...` 之外的 scratchpad 脚本思路——preview 环境变量构建商城、起 standalone、系统 Chrome 无头（`channel: "chrome"`，本机没有 Playwright 自带浏览器）、按 `initiatorType==="script"` 累加 `transferSize`，与 CI 数值相差几十字节。
- **本机 L2-17 夹具**：`fixture-server.mjs` 需要端口参数 `node fixture-server.mjs 4610 4611`；`run-prod.sh build` 后 `run-prod.sh` 启动（有 standalone 警告但可用）；`stop.sh 4600 4610 4611` 停止。
- **stg 抽查脚本**会给 qa.check 换随机密码（SSH 标准输入，不打印）并在结束时暂停。
- **完整门禁**由 CI 的 `quality-repository-check` 执行（不是 Quality 汇总作业）。本机能跑其中的静态检查：check-ci、check-runtime、check-observability、check:contracts。
- **catalog 附件约 97MB**，`gh run download` 要十几分钟，放后台。

## 最新 CI（run 36853235004，67cb772d）

| 组 | 结果 | 说明 |
|:--|:--|:--|
| Security | 通过 | |
| commerce | 通过 | |
| operations | 通过 | 连续三轮 |
| journey | 通过 | 发布冲突重排队后连续两轮 |
| **catalog** | **整组通过** | 回归基线建立以来首次（fallback-seo、storefront-seo-cache、gifts、management-publication） |
| quality | 120 分钟超时取消 | `regression-tools` 通过后，`ui-composites` 停在 `reduced-motion-390x844-en`，11:09 起再无输出直到 13:06 超时；没有失败信息（附件 `output/checks/ci-catalog-seo/run-36853235004-quality/`）。上一轮（36847160866）同一场景几秒通过，两轮之间商城只改了 `proxy.ts` 的预览嵌入读取（仅影响布局预览路由），判断为偶发挂起，未证实 |

上一轮（36847160866）quality 的 `ui-motion` 已首次通过，并前进到完整门禁 `quality-repository-check`（越过 check-ci 后停在 check-runtime，本轮已修）。完整 `pnpm check`（含 test:postgres、test:s3、全量 test/build）在 CI 上要多久还没有数据，可能本身就逼近 120 分钟上限。

本文件的推送会触发新一轮 CI，下一会话先看它的 quality。
