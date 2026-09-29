# 交接：L3-10 后台内置账号完成并在 stg 切换 → 下一步 L3-09

> 日期：2026-09-29
> 执行：Claude（Windows 端）
> 分支：`v2/r1-production`，与 origin 同步；stg 已部署 28e5f619
> 冷启动顺序：AGENTS.md → SPEC §0.3–0.4 → [上线计划](../plan/2026-09-28-flexible-storefront-launch.md)（L3-09 一节）→ [当前进度](../progress/launch-progress.md) → 本文件
> 上一份交接：[2026-09-29-storefront-four-items-done.md](2026-09-29-storefront-four-items-done.md)

## 背景

用户在 2026-09-29 决定：首发时后台不接外部身份源，改用平台内置账号（ADR-021 / L3-10）。内容包括：

- 账号密码登录；
- 登录后自选扫码绑定 TOTP 两步验证；
- 修改密码、恢复码；
- 用户追加的“员工账号”页面。

工作分七段交付。① ② 在上一轮完成；本轮从 ③ 做到 ⑦，并把 stg 后台从 Basic Auth 切换为内置账号登录。L3-10 在进度表中已登记为 LOCAL_ACCEPTED。

## 已完成

| 段 | 提交 | 验证 |
|:--|:--|:--|
| ③ 应用层与 API | e30a8979 | 应用单测 39、API 32、config 189；实际 PG 专项 152 项，含 0052 触发器逐条正反例、并发失败计数、双提交只签发一次会话；正式 API 组装 + 实际 PG 的 HTTP 全流程 172 项，含“明文不入库、不进日志”扫描 |
| 迁移 0055 | e30a8979 内 | 修正 0052 的 TOTP 密文 CHECK（见下文决策）；55 个迁移往返、结构目录重新生成 |
| ④ 登录页与 BFF | e4d16a82 | 真实浏览器 155 项：七语言、390×844 和 1440×900、15 次 axe 零违规、键盘、减少动态、Cookie 属性，以及验证码、恢复码、临时密码和锁定四条流程 |
| 设计令牌修正 | 30a6013c | L2-07 的模糊半径和 L2-10 的断点改为只用令牌，`check-design-foundations` 通过 |
| ⑤ 账号设置 | 6f03e174 | 真实浏览器 163 项：改密后其他会话失效；二维码与按 otpauth 地址重算的结果逐字一致；恢复码下载、重新生成、关闭两步验证 |
| ⑥ 员工账号 | 8fc74a80 | 真实浏览器 111 项：新建、改角色、重置、清除两步验证、暂停后对方会话失效；版本冲突提示；日常运营账号看不到入口 |
| ⑦ 服务器命令、本地体验、stg 切换 | 28e5f619 | 服务器命令实际 PG 44 项；实例与 Caddy 测试在 stg 的 Linux 上 12 项全过（Windows 上跑不了）；stg 真实域名 14 项 |
| 文档 | e80ba586 | 运行手册、L3-10 设计 §4.1–4.4 和 §5、进度表、上线计划 |

**门禁**：每段提交前都跑了格式、lint、typecheck（69）、build（38）。测试阶段偶发 5 秒超时（admin、storefront、persistence），均不是本轮改动的文件，降并发复跑后全过。

**stg 当前状态**（28e5f619，迁移头 0055）：

- 实例配置 `adminSignIn: LOCAL_ACCOUNT`；
- 后台 `https://admin.stg.kikikong.com` 不再有 Basic Auth，直接显示登录页；
- 收件箱和 OIDC 身份选择页仍返回 401（Basic Auth 保留）；
- 商城动态路由返回 200。

**stg 上的账号**：

- `studio.owner`（工作室管理员）：由服务器命令创建，尚未开启两步验证。密码只保存在开发机 `C:\Users\admin\.tools\xiadan-stg-admin.txt`，从未打印；
- `qa.check`：真实域名验收用的账号，验收后已暂停。

## 关键决策及理由

- **慢操作放在事务外，写入时比较后再落库**：
  - scrypt 很慢，正式环境的 KMS 又是网络调用，放进事务会长时间占着行锁；
  - 所以每个写操作分两步：先只读取出哈希或密文，在事务外校验；再在事务里锁行，确认值与校验时一致才写入；
  - 这样并发改密或并发解绑时，旧的校验结果会自动作废。
- **事务用 READ COMMITTED 加显式行锁**（先身份行，再账号行，再登录记录），不用 SERIALIZABLE。这样并发输错密码时计数会逐一累加，不会因为序列化冲突报“服务不可用”，也就不会被利用来绕过锁定。
- **步骤顺序：先验证码，再设新密码**。只拿到临时密码、没有验证码的人，不能先把密码改掉。
- **统一的失败计数**：以下错误都计入同一个计数，连续 5 次锁 15 分钟：
  - 登录时密码、验证码或恢复码错误；
  - 账号设置里当前密码或验证码错误。

  唯一例外是绑定时输错验证码，不计数，因为密钥只有本人看得到。锁定期间不再校验密码，直接回答“已锁定”，避免锁定期内被继续试密码。
- **登录名不存在**：照样算一次 scrypt，统一返回 `INVALID_CREDENTIALS`，不让响应时间暴露账号是否存在。
- **迁移 0055**：
  - 0052 的 TOTP 密文 CHECK 用了 `{32,4096}`，超过 PostgreSQL 正则 255 次重复的上限，任何非空值都写不进；
  - 这个问题只在实际 PG 上暴露，单测发现不了；
  - 0055 把它改成“字符类 + `char_length` 区间”；down 在已有密文时拒绝回滚，防止丢数据。
- **身份摘要**：内置账号用专用摘要函数（issuer 固定为 `urn:fan-support:local`）。现有函数要求 issuer 是 https 地址，改它会影响 OIDC 路径。
- **后台 `LOCAL_ACCOUNT` 的配置校验跟随部署环境**：
  - staging 和 production 按 OIDC 的标准校验（正式构建、公网 HTTPS）；
  - development（stg）按 LOCAL_OIDC 的标准校验；
  - 所以 stg 可以继续跑开发模式的 Next，而正式环境不会被放松。
- **挑战令牌只放在 HttpOnly 的 `__Host-` Cookie 里**（Strict，最长 300 秒），浏览器脚本看不到任何令牌。
- **二维码**：用 `qrcode-generator` 只计算点阵，由 React 画成 SVG，不引入会自己操作 DOM 或画布的库；它是零依赖，供应链面最小。
- **服务器命令设置的密码不要求登录后再改**：这个密码是运维者自己输入的，不是系统生成的临时密码。员工页生成的临时密码则必须在首次登录时改掉。
- **防止把自己锁在外面**：不能对自己重置密码、清除两步验证或暂停（这些操作改到账号设置里做）；改自己的角色时，新角色里必须仍有 `staff.manage`。
- **stg 只撤后台的 Basic Auth**：收件箱里有 TEST 邮件，身份选择页可以模拟任意身份，所以这两处都保留。
- **验收账号只暂停不删除**：审计记录引用账号，而且系统本来就不提供删除账号的操作。
- **来源 IP 限速不在应用里做**：按 ADR-021 由边缘 WAF 负责，应用内只做按账号的锁定。

## 在途

没有改到一半的代码。工作树干净，与 origin 同步。

遗留缺口和已知问题：

- **正式构建的浏览器验收缺口**：所有浏览器验收都在开发模式的后台 Next 上做，`NODE_ENV=production` 的正式构建以 `LOCAL_ACCOUNT` 运行时还没用浏览器走过。上线计划里 L3-10 的“验收”一项因此仍未勾选，留到正式 staging 或生产部署时补。
- **既有的实际 PG 脚本失败**（不是本轮引入，已记在进度表 CI 行，等远端开发者确认）：
  - `postgres-delivery-proofs.mjs`；
  - `postgres-payment-runtime-parameters.mjs`；
  - `admin-exceptions-postgres.mjs`。
- **CI 三组回归**（quality、catalog、journey/commerce）仍未修，见进度表“CI 回归（PR #15）”一行。
- **测试超时**：`check:dev` 并行跑时，admin、storefront、persistence 的测试经常 5 秒超时。降并发复跑能过（admin/storefront 用 `--maxWorkers=4`，persistence 用 `--maxWorkers=6`），根因未查。
- **stg 的 `studio.owner` 还没开两步验证**：要提醒用户首次登录后改密码并开启两步验证。

## 下一步

1. **L3-09 虚拟礼物可保存应援凭证**（ADR-019 增补，范围见上线计划 L3-09 一节）：
   - 开工前把进度表 L3-09 行从 PENDING 改为 IN_PROGRESS，写上开工时间和验证计划（AGENTS.md 要求先登记）；
   - 先写失败测试：
     - 只对已送达的虚拟礼物行显示凭证；
     - 整行退款后显示“已撤回”且不能保存；
     - 凭证不含私密留言、金额和邮箱；
     - 实物行和未付款订单不显示。
   - 再读查单页、付款成功页的现有组件和主题令牌，确定凭证卡片放在哪里；
   - “保存图片”在浏览器本地生成 PNG。如果跨域照片让画布受限，改用同源受控读取或在服务器端生成，不放宽 CSP；
   - 文案七语言，以 en 为源稿，用“数字应援凭证”，不出现 donation、tipping、打赏；
   - 验收：七语言、两种尺寸、键盘、减少动态、保存出的图片内容正确；跑受影响测试和 `check:dev`，部署 stg 后复核。
2. **有正式构建环境时**，补做 L3-10 正式构建的浏览器验收，然后勾掉上线计划里的那一项。
3. **CI 回归和既有 PG 失败**：等用户或远端开发者确定分工。

## 环境注意

- **stg 部署流程**：
  - 带迁移的部署：先停机，冷备份到 `~/backups/stg-pre-<提交>-<日期>`，回滚版本写进同名 `.revision` 文件；
  - 部署后必须抽查动态路由，不能只看首页。
- **本轮回滚点**：
  - 状态备份 `~/backups/stg-pre-28e5f619-20260929`（回滚版本 2df635af）；
  - Caddyfile 备份 `/etc/caddy/Caddyfile.pre-28e5f619`；
  - 回滚顺序：停实例 → 代码回到 2df635af 并重建 → 用备份替换状态目录 → 恢复 Caddyfile 并重载 → 启动。
- **商城域名**是 `storefront.stg.kikikong.com`，不是 `shop.`。
- **远程执行含 `$` 的脚本**用 `ssh xiadan-app 'bash -s' <<'REMOTE'`，正则里用 `[$]`，否则 `$[` 会被当成算术展开。
- **后台账号运维**：
  - 命令是 `node apps/api/scripts/admin-account.mjs <子命令> --instance stg`，以 `xiadan` 身份在 `~/app` 执行；
  - 密码经 SSH 的标准输入传过去，不能写进命令行参数。
- **凭据文件**：
  - `xiadan-stg-access.txt` 和 `xiadan-stg-admin.txt` 的内容永远不能输出到对话里，哪怕是过滤后的版本；
  - 脚本读取文件后，只把值注入子进程环境、`curl -K -` 或页面输入框；
  - 参考 `output/checks/l3-10/stg/stg-owner-sign-in.mjs` 的写法。
- **本轮 stg 证据脚本**（被 gitignore）：`output/checks/l3-10/stg/` 下的 `create-owner.mjs`、`stg-local-accounts.mjs`、`stg-owner-sign-in.mjs`。
- **浏览器验收工具**：
  - 共享工具是 `apps/api/scripts/admin-local-browser-harness.mjs`：实际 PG、正式 API 组装，开发模式的后台 Next 以 `LOCAL_ACCOUNT` 和 experimental-https 运行在 `admin.example.invalid`，用 Chrome；
  - 验证码用它的 `freshCode` 取，避免同一个 30 秒步长被判为重放。
- **新增迁移的配套改动**：
  - `migrations:manifest`；
  - `migrations:catalog`（即 `postgres-integration.mjs --write-catalog`）；
  - 把版本加进 `scripts/notification-rollback-prefix.mjs`，并把它测试里的“未知版本”样例顺延一位。
- **POSIX 专用测试**：`scripts/local-experience-state.test.mjs` 等要求 workspaceRoot 以 `/` 开头，在 Windows 上会失败，要到 stg 的 Linux 上跑。
- **Windows 下的写文件坑**：Bash heredoc 超过约 8KB 会被截断；Python 从标准输入读中文会乱码。改 markdown 用 Edit 工具，长脚本先写到临时目录再执行。
- **设计基础检查**（`scripts/check-design-foundations.mjs`）：
  - CSS 里不允许出现原始颜色和长度，只能用令牌（`color-mix` 可以用）；
  - 断点只能用 48rem 和 64rem。
