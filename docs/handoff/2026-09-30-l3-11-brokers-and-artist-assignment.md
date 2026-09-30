# 交接：L3-11 经纪人账号与艺人归属已完成并上 stg；下一步 L3-12

> 日期：2026-09-30
> 执行：Claude（Windows 端）
> 分支：`v2/r1-production`，本文件提交后与 origin 同步。stg 在 cfcdfde1（`webMode: PREBUILT`），迁移头 0057。
> 冷启动顺序：AGENTS.md → SPEC §0.3–0.5 → [上线计划](../plan/2026-09-28-flexible-storefront-launch.md) → [当前进度](../progress/launch-progress.md) → [新功能方案](../plan/2026-09-30-brokers-ledger-private-notes.md)（第 2.3 节账目、第 5 节、第 9 节“账目（L3-12）”）→ [ADR-022](../decisions/022-brokers-ledger-private-notes.md)（含“L3-11 实现约定”增补）→ 本文件
> 上一份交接：[2026-09-30-stg-production-builds-and-new-requirements.md](2026-09-30-stg-production-builds-and-new-requirements.md)

## 背景

用户要求按上一份交接的计划推进。计划的顺序是 L3-11 → L3-12 → L3-13，CI 回归穿插。本轮完成了 L3-11：后台新增“经纪人”角色，经纪人只能看、管自己名下的艺人；艺人有归属，超管可以指定和改派，未分配的由超管和日常运营照常管理。

## 已完成

| 条目 | 提交 | 验证 |
|:--|:--|:--|
| 进度登记（开工前） | 649278bd | — |
| L3-11 全部代码、迁移 0057、七语言后台、文档（ADR-022 增补、运行手册、风险 R-19、SPEC §9.8） | cfcdfde1 | 见下 |
| 回滚探针登记 0056、0057；进度表；本交接 | 本次提交 | 回滚探针 96 项 |

L3-11 的验证（详细数字在进度表 L3-11 行）：

- **单测**：合同 595、后台 524、持久层 847，应用层与 API 路由的相关用例全过。
- **实际 PostgreSQL**：
  - `postgres-idol-assignments.mjs` 81 项：越权反例全部被拒，绕过应用直接写库也被拒，并且核对了是被哪一条校验拒绝的；经纪人新建的艺人归自己；改派立即生效；0057 升级、回退逐字恢复 0022 的函数、有归属记录时拒绝回退；
  - 员工页 159 项、服务器命令 56 项、HTTP 全流程 172 项；57 个迁移往返与结构目录。
  - 持久层 `test:postgres` 整套：回滚探针 96 项通过；其余脚本逐个跑，51 个通过，失败的 3 个是既有问题（`postgres-delivery-proofs`、`postgres-payment-runtime-parameters`、`admin-exceptions-postgres`），失败原因与进度表原记录一致。
- **本机真实浏览器** 269 项（`apps/api/scripts/admin-brokers-browser.mjs`）：七语言、390×844 与 1440×900、axe、键盘、减少动态。L3-10 员工页用例回归 111 项。
- **门禁**：format、lint、typecheck 69、build 38 通过；测试为串行加逐包降并发复跑全过。
- **stg 真实域名** 94 项（`output/checks/l3-11/stg-brokers.mjs`）：经纪人带真实照片添加艺人并自动归自己；超管看到归属、筛选、改派；超管新建艺人时选经纪人；经纪人编辑名下艺人并在商城生效；七语双端。
- **CI**（cfcdfde1）：Security、journey 通过；其余四组仍是既有失败，失败步骤与之前相同。

## 关键决策及理由

- **经纪人角色带四个媒体权限**（`content.media.upload/read/process/rights`）。日常发布流程用提交人的会话处理照片，数据库触发器按这四个权限校验；不给的话经纪人无法添加或更换名下艺人的照片。这些接口只能按素材 ID 访问、没有列表，经纪人拿不到别人素材的 ID。剩余风险记在 R-19，**需要用户知情**。
- **标准角色的权限清单放在合同包**（`adminStandardRolePermissions`），服务器命令照它授予，测试也照它核对。工作室管理员不持有三个“只限名下”的键（`management.assigned`、`ledger.assigned`、`ledger.messages`），否则超管自己会出现在经纪人名单里。
- **迁移只登记自己用到的权限键**：0057 登记 `idols.assign`、`management.assigned`；`ledger.*` 留给 0058，`idols.private` 留给 0059。合同测试 `admin-local-access.test.ts` 里有一条断言“0057 不含后四个键”，L3-12、L3-13 加迁移时要同步改这条测试。
- **已有环境必须执行 `sync-roles`**：`ensureStandardRoles` 原来只在 `create` 时执行。新增的 `admin-account.mjs sync-roles` 只补不删，可重复执行。L3-12、L3-13 部署后同样要执行一次。
- **同时有经纪人和其他角色的账号**：持有 `management.direct` 就按“管理全部艺人”处理，新建的艺人不自动归自己。员工页的角色说明里写了这一点。
- **接口里的经纪人标识用员工身份 ID**（`admin_identities.id`）加显示名和“是否有效”。这样归属表、校验函数和接口用同一个 ID，不需要换算；没有内置账号的身份显示 ID 前 8 位。
- **艺人列表每一项都带归属字段**（未分配为 null），不做“可选字段”。原因：管理中心的响应要能赋给 `JsonValue`，可选字段通不过类型检查。经纪人的列表只含自己名下的艺人，界面上不显示归属行。
- **改派是单独的命令 `ASSIGN_ARTIST`**，不改冻结的 `SAVE_ARTIST` 意图。带“编辑页看到的原归属”，与当前不一致就拒绝；重复提交同一归属不写新记录。
- **已有艺人改下拉框立即保存；新建艺人在发布成功后由页面提交归属**。后者失败时艺人保持未分配并提示。已知缺口：发布完成前离开编辑页，归属不会提交。
- **数据库校验**：0022 的两个函数改为调用 `assert_management_scope`。持 `management.direct` 的账号走和原来完全一样的检查；否则要求 `management.assigned`，且操作是保存名下艺人或新建艺人。
- **经纪人名单**只列有效的经纪人，加上仍有名下艺人的停用账号。停用且名下没有艺人的账号不出现在筛选和下拉框里（否则验收账号会一直留在用户的筛选框里）。
- **本机浏览器脚本不写七语言对照表**：`check:contracts` 禁止在 i18n 包之外重复完整的语言映射。脚本改为比较页面自身的文字，并检查七种语言各不相同；逐字文案由单测保证。
- **状态记为 LOCAL_ACCEPTED 而不是 DONE**：计划内的验证都做完了，但用户还没试用，经纪人的“艺人账目”入口要等 L3-12。

## 在途

- 没有改到一半的代码。
- stg 上留下的东西：验收账号 `qa.broker`（经纪人，已暂停）；四位已删除（归档）的测试艺人和它们的归属记录。因为有归属记录，stg 上 0057 不能直接 down，回滚要用冷备份 `~/backups/stg-pre-cfcdfde1-20260930`（回滚版本 84cb4868）。
- 用户自己的账号 `studio.owner` 在 `sync-roles` 后已有 `idols.assign`，登录后就能看到“归属经纪人”。

## 下一步

1. **L3-12 艺人收礼账目与导出**（开工前在进度表把状态改为 IN_PROGRESS，并写明验证计划）。按方案第 2.3 节、第 5 节和第 9 节“账目（L3-12）”：
   1. 先写失败测试：
      - 金额口径：币种分开、退款扣减、拒付整单退回、一单多艺人拆分、未付款与已取消不计入、TEST 与 LIVE 分开；
      - 越权：经纪人只看得到名下艺人的账目和留言，改派后原经纪人立即看不到；读留言逐次写审计；导出不含粉丝个人信息。
   2. 迁移 0058：只读查询用的索引（`order_items.idol_id`、付款时间、`refund_items.order_item_id`），登记 `ledger.read`、`ledger.assigned`、`ledger.messages`。同步改合同测试里“0057 不含后四个键”那条。
   3. 合同、应用层、仓储、接口；对账时区 `Asia/Shanghai` 做成部署配置项。按归属限定范围时复用 `management-center-scope.ts` 的 `managementGrants` 和数据库函数 `idol_current_broker`，不要另写一套。
   4. 后台：订单区“艺人账目”标签；经纪人侧栏增加“艺人账目”（`shell.tsx` 的 `artistsOnly` 分支）；浏览器本地生成 .xlsx；七语言。
   5. 验收同 L3-11；部署 stg 后执行 `sync-roles`。
2. **CI 回归**（穿插）：上一份交接的内容不变。journey 偶发 SAVE_GIFT `CONFLICT` 仍是先加 worker 诊断。本轮新发现的两处见“环境注意”。
3. **T-12**、**L3-13**：不变。

## 环境注意

- **只跑一部分测试会漏**：本轮第一次只跑了 `management-center-operation*` 一组，漏掉 `management-image-source.test.ts`（它也经过仓库对象，假数据库没回答新的权限查询）。改共享授权后要跑整个包。
- **持久层单测的假数据库按查询顺序出结果**。本轮让 `management-center-operation-repository.test.ts` 的夹具按 SQL 特征回答两类新查询（持有哪些权限、艺人归谁），其余仍按顺序。以后新增查询优先走这个办法。
- **`check:dev` 并行下的 5 秒超时**：做法不变。本轮 storefront 20 个文件、persistence 5 个、admin 1 个超时，串行加 `--maxWorkers=4` 逐包复跑全过。`turbo run test` 要加 `--continue`。
- **合同变更要同步的地方**：`artifact-registry.ts`（新的值对象还要进 `unversionedValueObjectNames`）、`artifact-documents.test.ts`（路径清单、值对象清单）、`management-center-openapi.ts`、`pnpm contracts:generate`。
- **`pnpm check:contracts` 有 5 处既有违规**（四个后台文案文件的完整语言映射、一个商城测试里的语言数组）。它不在 `check:dev` 和 CI 里，所以一直没暴露。待处理。
- **`pnpm security:secrets` 在 Windows 上跑不了**：脚本用 `spawnSync` 直接执行 `secretlint.cmd` 会失败。本机改用 `pnpm exec secretlint --no-gitignore <文件…>` 扫描提交内的文件。注意不要把它接在 `| tail` 后面再用 `&&` 串提交，管道会吞掉失败的退出码（本轮就这样提交了，事后补扫无发现）。
- **持久层 `test:postgres` 整套**：回滚探针的已知迁移头清单以后每加一个迁移都要登记（`notification-rollback-prefix.mjs` 和它的测试各一处）。整套在 `postgres-delivery-proofs.mjs` 处停（既有失败），其后的脚本用 `output/checks/l3-11/pg-rest.sh` 逐个跑、失败不停。
- **stg 验收脚本** `output/checks/l3-11/stg-brokers.mjs`：自己生成随机密码经 SSH 标准输入交服务器命令，结束后删除本次创建的艺人并暂停两个账号。筛选后列表会先卸载再重载，断言前要等重载完成。
- **本机浏览器验收**：`node apps/api/scripts/admin-brokers-browser.mjs`（在 `apps/api` 下，先构建 api）。这套环境没有对象存储，艺人是直接写库的、没有照片；带照片的新建流程只能在 stg 验。运行期间不要改后台源码，开发服务器会热更新。
