# 交接：L3-13 私密备注与 L3-14 删除员工账号完成并上 stg；下一步 CI catalog-fallback-seo

> 日期：2026-10-01
> 执行：Claude（Windows 端）
> 分支：`v2/r1-production`，本文件提交后与 origin 同步。stg 在 826fceb4（`webMode: PREBUILT`），迁移头 0063。
> 冷启动顺序：AGENTS.md → SPEC §0.3–0.9 → [上线计划](../plan/2026-09-28-flexible-storefront-launch.md) → [当前进度](../progress/launch-progress.md) → [经纪人/账目/备注方案](../plan/2026-09-30-brokers-ledger-private-notes.md)（第 9、10 节）→ [ADR-022](../decisions/022-brokers-ledger-private-notes.md)（L3-11 至 L3-14 四段实现约定）→ 本文件
> 上一份交接：[2026-10-01-l3-12-artist-ledger.md](2026-10-01-l3-12-artist-ledger.md)

## 背景

上一份交接之后，前一个会话连续做了三件事：登记 L3-13 并追加用户的新需求 L3-14（576bd7fa，SPEC 6.4.0），完成 L3-13 私密备注（f102a334，已推送），开始 L3-14 删除员工账号。L3-14 代码已全部写完、类型检查通过，**刚开始跑第一个实际 PG 专项时电脑断电**。本会话从断电点恢复：核对仓库完整性、读懂在途代码、补完全部验证，再把 L3-13 和 L3-14 一起部署到 stg 并在真实域名验收。L3-11 到 L3-14 这一组用户需求（经纪人、账目、私密备注、删除员工）到此全部完成。

## 断电恢复做了什么

- `git fsck` 通过；改动文件里没有 NUL 字节或退格符；新文件结尾完整。本地与 origin 一致（L3-13 断电前已推送）。
- 在途代码逐层读过：迁移 0063、合同、持久层、应用层、API、后台员工页、服务器命令、回滚探针登记。0063 的 down 与 0052、0057 的原函数逐字比对一致（只差 `CREATE OR REPLACE`），0058–0062 没有改写过这两个函数。
- 先把 L3-14 登记为进行中并推送（746f94e9），再继续。

## 已完成

| 条目 | 提交 | 验证 |
|:--|:--|:--|
| L3-14 登记进行中 | 746f94e9 | — |
| L3-14 全部代码、迁移 0063、ADR-022 增补、进度 | 826fceb4 | 见下 |
| stg 部署 826fceb4（L3-13 + L3-14 + Mario 的四个商城/后台提交） | 本次提交（记录） | 见“stg” |
| L3-13、L3-14 真实域名验收 | 本次提交（记录） | 141 项全过 |

L3-14 验证（数字也在进度表 L3-14 行）：

- **单测**：合同 625、应用 764、API 381、后台 612、持久层 858。
- **实际 PostgreSQL**：
  - 新专项 `postgres-staff-deletion` 33 项（越权、自删、登录名不符、过期版本、经纪人名下三位当前艺人加一位已删除艺人全部转交、会话/两步验证/角色撤销、数据库直写反例、0063 升降级与有已删除账号时拒绝回退）；
  - 员工仓储 159、艺人归属 82、服务器命令 61、HTTP 全流程 172、回滚探针 114；
  - 63 个迁移往返，结构目录 `expected-catalog.json` 已重新生成（只多了 0063 的内容）。
- **本机真实浏览器** 159 项（`apps/api/scripts/admin-staff-deletion-browser.mjs`）。
- **门禁**：`check:dev` 全过（format、lint、typecheck 69、test 69、build 38）；改动文件 secretlint 无发现。

## stg

- 按运行手册 PREBUILT 流程：停机 → 冷备份 `~/backups/stg-pre-826fceb4-20261001`（837M，逐文件比对一致，回滚版本 d367ade6）→ reset + install → `local:build-web` 7 分 25 秒、`build exit 0`、戳记为 826fceb4 → 启动约 3 秒就绪 → `sync-roles`。
- PG 日志与事件日志无错误；公开路由 17 条与部署前逐条一致（商城仍是用户的樱花粉）。
- 真实域名验收脚本 `output/checks/l3-14/stg-notes-and-deletion.mjs`，141 项全过：
  - L3-13：未开两步验证时锁定 → 开启后当前会话仍锁定 → 用验证码重新登录后写入、修改、查看历史版本；七语双端。
  - L3-14：临时经纪人带真实照片建 QA 艺人 → 七语双端确认区 → 删除 → 该经纪人页面刷新回登录页、不能再登录 → 服务器命令显示 `DELETED`、拒绝重新启用、拒绝复用登录名 → QA 艺人变为未分配。
  - 结束后 QA 艺人已删除，`qa.check`、`qa.broker` 已暂停且没有两步验证；用户的 `studio.owner` 没有动过。
- **stg 上留下的东西**：一个已删除的经纪人 `qa.l314.10010610`（删除只是标记，账号行永久保留）、一位已删除的 QA 艺人和它的两版私密备注、相应审计。因此 0062、0063 都不能直接回退，回滚只能用冷备份。

## 关键决策及理由

- **删除 = 标记 `ARCHIVED`，不物理删除**：审计只追加，几十处外键指向员工身份，内置账号、恢复码、登录记录和会话都有防删触发器。物理删除要么被数据库拒绝，要么抹掉“谁做过什么”。状态值 `ARCHIVED` 从 0001 起就预留了。0063 再加两个终态触发器：状态不能改回，已删除身份不能再持有角色。所以绕过应用直接写库也恢复不了。
- **登录名不复用**：这是用户的决定，这样审计里同一个登录名只对应一个人。实现上利用账号行保留、登录名唯一约束天然生效；服务器命令的报错写明“已删除账号的登录名不复用”。
- **已删除的艺人也转交，但不计数（本会话修正）**：断电前的代码让“转交数”包含已删除的艺人，而员工列表的“名下艺人数”不含。结果确认框写“名下 3 位”，删完却提示“4 位已转交”。现在两边都只数当前艺人。已删除的艺人照样各写一条改派记录改为未分配，这样任何艺人都不会挂在一个已删除的经纪人名下。为此 0063 给 0057 的归属校验加了一个窄分支：只有前一位经纪人已删除时，才允许改派已删除的艺人。
- **改派记录的 `reason` 仍写 `ASSIGNED`**：0057 的取值检查只允许 `BROKER_CREATED` 和 `ASSIGNED`。删除原因放在审计的 `reason_code`（`BROKER_DELETED`）里，就不必改 0057 的表约束。
- **0063 的 down 在有已删除账号时拒绝**：旧代码不认识 `ARCHIVED`，它的服务器命令 `reactivate` 会把已删除的账号重新启用。
- **任何工作室管理员都能删除其他管理员**：包括用户的 `studio.owner`，只是不能删自己。这符合用户原话“超级管理员可以删除已经创建的员工账号”，但**需要用户知情**：如果希望主账号不可删，需要另加规则（例如“最早创建的管理员不可删”，或“删除管理员需要两步验证会话”）。

## 在途

- 没有改到一半的代码。
- **需要用户知情或决定**：
  1. 任何工作室管理员都能删除其他管理员（见上）。
  2. 经纪人能看待审核的留言（L3-12 起，方案第 7 节第 5 条已记录维持）。
  3. 远端协作者的心愿整链复验会在 stg 公开商城新增一件测试心愿，还没做，需要先问用户。
  4. 艺人页底部收尾引导文案（L2-17 遗留），Mario 的 95a09cbc 已退休页脚固定标语，艺人页那句是否也撤，待用户定。
- **CI**：
  - f102a334（L3-13）：Security、journey、commerce 通过，catalog、operations、quality 仍是既有失败。
  - 746f94e9 只改了文档，journey 却失败了。附件显示卡在海报准备阶段的 `UPLOAD_GIFT`：礼物保存操作一直没完成，最后超时。这和之前记录的 CI 偶发 SAVE_GIFT 问题是同一类，与代码无关。附件已下载到 `output/checks/l3-14/ci-36819542473-journey/`。
  - 826fceb4（L3-14，run 36821721021）：Security、commerce、journey 通过，catalog、operations、quality 仍是既有失败，与 L3-13 那次相同。journey 恢复通过，说明 746f94e9 那次是偶发。
- **生成文件变大**：推送时 GitHub 警告 `packages/contracts/generated/contracts.schema.json` 已有 51.33 MB，超过建议值 50 MB（硬上限 100 MB）。每加一组接口它就涨约 1 MB（L3-13 加了约 1100 行）。照这个速度还能撑几十个条目，但最好找时间看看生成器能不能去掉重复的内联定义，或改为按模块拆分。目前还不紧急。
- **Mario 3415a527 的 `decoration.css` 像素值**（`check:design-foundations` 报两处，只在 `pnpm check` 里）：仍未告诉他，下次协作时转告。

## 下一步

1. **CI 回归，先修 `catalog-fallback-seo`**（HOMEPAGE 故障回退）。诊断见 [L2-17 交接](2026-10-01-l2-17-gift-display-and-filtering.md)第 80 行和进度表“CI 回归”行：嫌疑是 `storefront-homepage-repository.ts` 的 `loadPublishedContentContext` 在译文缺失时不回退。Mario 在 b30e1cb3 改过 `regression-seo-recovery.mjs`，先看他的改动。开工前在进度表登记。
2. 把“在途”里需要用户知情的四件事带给用户。
3. journey 偶发的 SAVE_GIFT 超时：之前的首要假设是 media-processing-repository 把 `TRANSACTION_ABORTED` 归为不可重试的 `CONFLICT`，先加 worker 诊断再改。
4. T-12：不变。

## 环境注意

- **断电恢复清单**（这次用过，可复用）：
  - `git status` / `git log origin/<分支>..HEAD` 看推送状态；
  - `git fsck --no-dangling`；
  - 对改动文件查 NUL（`grep -qP '\x00'`）和退格符；
  - 看 `output/checks/<条目>/` 里最后写的日志：空日志就是断电时正在跑的那一步；
  - 按文件修改时间还原工作顺序。
- **后台门禁的退出码**：`cmd > log; echo "exit $?" >> log` 这种写法，后台任务通知总是“exit 0”（那是 `echo` 的退出码）。要看日志里的 `exit N` 和 `[check:dev] stopped at …`。这次第一轮 `check:dev` 就是这样“成功”了，其实停在 lint。
- **不要在本机浏览器验收运行时改 `apps/admin` 源文件**（包括 prettier 格式化），开发模式的热更新会干扰正在跑的页面。等它跑完再改。
- **两条 PG 链不要同时构建**：`migrations:catalog`、`test:postgres:*`、`test:postgres:admin-local` 都会先构建依赖。单测和浏览器脚本直接读 `dist`，要等构建步骤结束再开。
- **stg 验收里的 TOTP**：脚本用 `node:crypto` 自己实现了 RFC 6238，已与 `@fan-support/application` 的 `totpCode` 交叉比对 200/200。服务器拒绝重放，所以每次用验证码登录都要取比上次更新的时间步（`freshCode`），最多等 30 秒。用验证码登录一次后，用 `context.storageState()` 复用会话，避免七语言循环里反复等验证码。
- **stg 上删除账号不可逆**：以后每次跑 L3-14 验收都会留下一个已删除的临时经纪人（登录名带时间戳，不会冲突）。如果不想积累，可以改为只验证确认区、不实际删除。
- **pg 驱动弃用警告**：同一个 `Client` 上 `Promise.all` 并发查询会报 “client is already executing a query”，脚本里要顺序执行。
