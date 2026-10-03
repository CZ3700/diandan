# 交接：stg 已切正式构建；经纪人、账目、私密备注的方案获批；下一步 L3-11

> 日期：2026-09-30
> 执行：Claude（Windows 端）
> 分支：`v2/r1-production`，本文件提交后与 origin 同步。stg 在 84cb4868（`webMode: PREBUILT`），迁移头 0056。
> 冷启动顺序：AGENTS.md → SPEC §0.3–0.5 → [上线计划](../plan/2026-09-28-flexible-storefront-launch.md)（文末“2026-09-30 用户追加：经纪人账号、艺人账目与私密备注”）→ [当前进度](../progress/launch-progress.md) → [新功能方案](../plan/2026-09-30-brokers-ledger-private-notes.md)（第 7 节用户决定、第 9 节代码入口）→ 本文件
> 上一份交接：[2026-09-30-l2-16-light-palettes-and-ci.md](2026-09-30-l2-16-light-palettes-and-ci.md)

## 背景

本轮开始时，用户要求先读上一份交接、按计划推进，同时追加了一组后台需求：

- 经纪人账号，只能看、管自己名下的艺人；
- 艺人归属（添加时绑定、可改派、未分配归超管）；
- 按艺人查看收礼账目，可选时段，能导出单人、单个经纪人、全局三种表格；
- 艺人私密备注，只有超管可见。

处理顺序：

1. 整理需求、补齐遗漏，写成方案，经用户确认四个问题后落盘（ADR-022、SPEC 6.0.0）；
2. 按用户选定的顺序，先完成已批准的 stg 正式构建；
3. CI 回归穿插进行。

新功能本身还没开工。

## 已完成

| 条目 | 提交 | 验证 |
|:--|:--|:--|
| 新需求方案、ADR-022、SPEC 6.0.0（§0.5、§2.2、§3.1）、风险 R-02/R-18/R-19、上线计划与进度登记 | 94188fab | 文档相对链接 24 个全部可解析 |
| stg 正式构建：配置窄口子、`webMode`、`local:build-web`、戳记核对、`next start` + 实例 TLS 代理、商城不拿后台凭据、`web-events.log`、代理绑定地址、L3-10 harness `--compiled` | f8227216、84cb4868 | 配置 194；新测试本机 16、Linux 23；本机编译后台 test 层 L3-10 三套 429 项；全仓门禁（测试串行加逐包复跑、build 38） |
| stg 切换与验收 | 84cb4868 | 见下方“stg 验收” |
| CI Security：brace-expansion 新公告 | 09be5a16 | 本机 `security:dependencies` 通过，下一轮 CI Security 通过 |
| CI journey：图片遍历改为页面内判断 | 2fa2dd1a | 下一轮 journey 整组通过 |
| 文档：进度表、运行手册（PREBUILT 部署流程）、两份方案、T-12 登记 | a3e8ba63 及本交接 | — |

### stg 验收（84cb4868，TEST 通道，无真实资金）

- **部署**：
  - 停机冷备份到 `~/backups/stg-pre-84cb4868-20260930`，回滚版本 b8de15bc；
  - 首次全量构建 470 秒，内存峰值约 3.5GB，swap 235MB；
  - 启动 16 秒。
- **连续重启 5 次**：每次 16–18 秒就绪，全部路由状态与首轮一致，动态路由全部 200。“重启后动态路由全部 404”的问题不再出现。查单页 CSP 不含 `unsafe-eval`，页面没有开发标记。
- **T-11 全站清查 161 步**：开发徽标、块加载失败、CSP 违规、水合告警、页面报错全部为 0。其余 36 条是与基线相同的业务 404/401。
- **真实域名专项**：
  - L3-10：18 项，覆盖两步验证、改密、恢复码、旧密码失效、锁定；
  - L3-09a 凭证：143 项，订单 FS-A6CGG8 已整行退款；
  - 后台实时预览：21 项，只预览不保存，线上仍是经典黑金。
- **进程环境**：商城只有 `ADMIN_MODE=DISABLED` 和 `ADMIN_ORIGIN`，后台有密钥、模式为 `LOCAL_ACCOUNT`，两者都在 test 层。`web-events.log` 权限 0600，只含结构化事件。
- **内存**：xiadan 进程合计 3069MB → 1565MB（刚切换时），其中商城 1895MB → 447MB。运行约 1 小时后（跑完全部验收流量）合计 1786MB，商城 680MB，swap 保持 85MB，没有增长趋势。
- `qa.check` 每次用完都清除了两步验证并重新暂停。

## 关键决策及理由

- **四个用户决定（2026-09-30）**：
  1. 先做 stg 正式构建，再按 L3-11 → L3-12 → L3-13 推进。理由是之后每次部署都更可靠，新功能能直接在正式构建上验收，不必像 L3-09/L3-10 那样事后补验。
  2. 经纪人**可以**看名下艺人收到的私密留言，每条点开才显示，每次查看写审计；粉丝邮箱任何情况下都不给经纪人看，导出表格里永远没有留言。
  3. 对账时区用北京时间 UTC+8（`Asia/Shanghai`），做成部署配置项。
  4. 查看和修改私密备注，要求账号已开启两步验证，且本次登录输入过验证码或恢复码。
- **经纪人按“内部员工账号 + 范围限定”来做，不做商户体系**：SPEC §2.2 禁止外部经纪公司、多租户商户系统和分账。平台仍是唯一收款方，账目只用于内部对账。**以后如果要按账目给经纪人或艺人分钱，就是“分账”，支付服务商把它列为受限类目，必须重新评估**（已告知用户，写在 ADR-022）。
- **授权沿用“权限键 + 仓储层 + 数据库再校验”**，不写角色名判断。新增六个权限键，归属用独立的只追加表，不给 `idols` 表加列（0019 的守卫要求每次 UPDATE 都把 version 加 1，会引起编辑冲突）。
- **超管添加艺人时，先保存艺人，再写归属**：不改冻结的 SAVE_ARTIST 意图合同。第二步失败时艺人保持“未分配”，本来就归超管，所以不会越权。
- **Excel 在浏览器本地生成，不新增依赖**：自写最小 .xlsx（内联文字加数字，不会被当成公式）。本机有 Office 可以打开核对；Python 没有 openpyxl。
- **stg 正式构建的实现取舍**：
  - 构建戳记放在工作区级目录，因为 `.next` 属于整个 checkout。构建命令拿工作区锁，因此实例运行时拒绝构建，构建期间实例也启动不了；
  - 事件日志只保留通过 `structuredLogRecordSchema` 校验、并按字段重新序列化的行。Next 原始输出可能含订单链接或登录码，一律丢弃；
  - 本机 L3-10 用例加 `--compiled`：编译后的后台加本地 TLS 代理。健康探测必须带公网 Host，否则代理回 421。
- **缺失详情页的错误外壳没有顺手修**：这个问题开发模式下就存在，不是这次切换引入的，原因也不在表面，所以登记为 T-12，不在切换过程中临时插进来。

## 在途

- 没有改到一半的代码。
- CI（2fa2dd1a 那一轮）：Security、journey 通过，仍失败的是 catalog、operations、quality、commerce，都是交接前就有的四组。
- stg 运行在 PREBUILT 模式，数据未重置。验收新增了 TEST 订单 FS-A6CGG8（已退款）。

## 下一步

1. **L3-11 经纪人账号与艺人归属**（开工前在进度表把状态改为 IN_PROGRESS，并写明验证计划）。按[方案](../plan/2026-09-30-brokers-ledger-private-notes.md)第 5 节和第 9 节：
   1. 先写失败测试：
      - 合同：三个标准角色、六个新权限键；
      - 实际 PG 越权反例：经纪人读、改、上传他人或未分配的艺人被拒；经纪人新建的艺人归自己；运营不能改派；改派立即生效；
      - 员工页出现“经纪人”。
   2. 迁移 0057：
      - 只追加的归属表，加审计，绑定目标必须是经纪人角色；
      - 登记 `idols.assign`、`management.assigned`；
      - 替换 0022 的 `assert_management_authority` 和 `guard_management_operation`，down 逐字恢复原函数；有归属历史时 down 拒绝回退；
      - 重新生成 manifest 和 expected-catalog。
   3. 应用层与仓储：
      - `management-center-operation-data.ts:121` 的授权按归属放行；
      - 艺人列表按操作者过滤；
      - worker 新建艺人时在同一事务写归属；
      - 经纪人访问礼物、海报等分区一律拒绝。
   4. `admin-account.mjs` 的 `ensureStandardRoles` 补上第三个角色；员工页和七语言文案；艺人列表的归属列和筛选；超管添加、编辑艺人时的“归属经纪人”下拉框。
   5. 验收：受影响测试、实际 PG、七语双端浏览器、`check:dev`；按运行手册的 PREBUILT 流程部署 stg 复核（有新迁移，先冷备份）。
2. **CI 回归**（穿插）：
   - **journey 偶发的 SAVE_GIFT `CONFLICT`**（不可重试）：首要假设是 `packages/persistence-postgres/src/media-processing-repository.ts:84-93` 把 `TRANSACTION_ABORTED`（40001 序列化失败或死锁）归为 `CONFLICT`，worker 按不可重试直接判失败。
     - 先加诊断：worker 在操作失败时记录脱敏的错误类别和 PG 错误码，并进 CI 附件（现在 `3-stop.txt` 只看得到 supervisor 自己的 `postgresFailure`，看不到 worker）；
     - 拿到证据再改归类或重试；
     - 媒体链路是共享代码，改动前在进度表写明。
   - commerce-cart 的并发同键编辑断言（同样伴随 40001），可能同源。
   - catalog、operations、quality 维持上一份交接的结论与下一步。
3. **T-12**：缺失详情页的错误外壳与 404 页不带主题属性（见进度表 T-12 行），需要在本机正式构建下复现。
4. L3-12、L3-13 按方案依次推进；远端开发者相关的旧问题不变。

## 环境注意

- **stg 更新代码的流程已改变**（运行手册“日常”一节）：
  1. 停机、冷备份；
  2. reset、install；
  3. `pnpm local:build-web`，必须先停实例，内存峰值约 3.5GB；
  4. 看到 `build exit 0` 后再启动。

  最快的回滚是 `pnpm local:web-mode --instance stg --mode DEVELOPMENT` 再重启；回退代码前必须先切回 DEVELOPMENT，旧代码不认识 `webMode` 字段。
- **正式构建没有开发日志**：服务端事件看实例目录下的 `web-events.log`，浏览器报错用 Playwright 采集，真机问题临时切回 DEVELOPMENT 复现。
- **实例相关测试在 Windows 上跑不了**：`scripts/local-experience-state.test.mjs` 和 `apps/api/scripts/local-experience-tls.test.mjs` 在 Windows 上本来就全部失败（配置要求 POSIX 绝对路径）。本轮是在服务器上另建克隆跑的：
  - 用 `pnpm install --frozen-lockfile`（锁文件有新包时离线安装会失败）；
  - 从 `~/app/packages/*/dist` 复制未改动包的构建产物；
  - 跑完删除克隆和临时分支。
- **验收脚本**：
  - `output/checks/stg-prod-build/`：`routes.sh`（路由、CSP、开发标记、主题）、`stg-admin-accounts.mjs <tag>`（L3-10 真实域名）；
  - 凭证流程用 `output/checks/l3-09a/stg-certificate.mjs`（撤回文案已是新版）；
  - 查单页的 409 是买家旧购物车 `CART_EXPIRED`，属于正常响应。
- **CI 附件**：
  - `output/checks/ci-2026-09-30/run4`（四组）、`run6`（journey ja 句柄过期）、`run7`（journey SAVE_GIFT CONFLICT）；
  - journey 报告按隐私规则不记录错误原文，只有错误名和行号。
- **测试超时**：做法不变。本轮 `check:dev` 里 storefront 有 4 项 5 秒超时；串行跑时 storefront 和 persistence 又有 5 项超时，逐包降并发复跑全过。
- **两个 Bash 工具的坑**：
  - 用 heredoc 喂给 Python、且文本里含中文加反斜杠时，会报 unicode 转义错误。改用 Edit 工具，或者把脚本写成文件再执行；
  - `require.resolve("@fan-support/application")` 在只导出 import 条件的包上会失败，直接按 `packages/<包>/dist/index.js` 的路径导入。
