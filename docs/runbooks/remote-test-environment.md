# 远程测试环境运行手册

> 设计：`docs/plan/remote-test-environment.md`。本环境全部使用 TEST 适配器（模拟身份、支付、邮件），**不是** staging，也不能作为上线验收证据。

## 形态

- 一台 Debian 12 服务器（当前是 Lightsail 4GB，静态 IP `18.143.148.122`），运行用户是 `xiadan`，代码在 `/home/xiadan/app`。
- 实例 `stg`，基础域名 `stg.kikikong.com`。Cloudflare 上配一条通配记录 `*.stg` A → 服务器 IP，**仅 DNS（灰色云朵）**。
- Caddy 负责 Let's Encrypt 证书，并把 `https://<服务>.stg.kikikong.com` 反向代理到本机的 TLS 服务。Basic Auth 保护收件箱和 OIDC 身份选择页。
- 后台自 2026-09-29 起用内置账号登录（ADR-021，实例配置 `adminSignIn: LOCAL_ACCOUNT`），不再套 Basic Auth，登录页本身就是入口。
- 服务器上已安装：Node 24.20.0（`/opt`，经 SHA256 校验）、pnpm 11.25.0（corepack）、PostgreSQL 18（PGDG，只用二进制，集群由实例自己管理）、Docker、Caddy；另有 4GB swap。
- **Web 模式**（实例配置 `webMode`，2026-09-30 起 stg 为 `PREBUILT`）：
  - `PREBUILT`（正式构建）：商城和后台是事先 `next build` 好的产物，由 `next start` 在 test 层运行（生产版 React、没有 HMR、查单页 CSP 不含 `unsafe-eval`），各自监听私有后端端口；实例自己的 TLS 代理占住 `127.0.0.2:443`（商城）和 `127.0.0.3:443`（后台），转发时带上公网 Host。启动时绝不编译：构建戳记缺失或不是当前提交就直接失败。只支持内置账号登录（`adminSignIn: LOCAL_ACCOUNT`）。
  - 不写 `webMode` 即开发模式：两个 Next 开发服务器直接监听这两个地址的 443（Next 开发模式用 `--hostname:--port` 构造请求地址）。
  - 两种模式下 Caddyfile、systemd 单元和 DNS 预载都一样。`/etc/sysctl.d/99-xiadan.conf` 设置了 `net.ipv4.ip_unprivileged_port_start=443`；Caddy 只绑定 `127.0.0.1` 和本机内网 IP（`default_bind`），不占用这两个地址。
- 主机防火墙 ufw 只放行 22、80、443。云防火墙（Lightsail 联网页）同样只开这三个端口，其中 443 需要手动添加。

## 首次搭建（服务器已装好软件后）

1. **推送代码**：在开发机上执行 `git push staging v2/r1-production`（remote 地址是 `xiadan-app:repo.git`）。然后在服务器上以 `xiadan` 身份执行：
   ```bash
   cd ~/app && git fetch origin && git reset --hard origin/v2/r1-production
   pnpm install --frozen-lockfile
   pnpm exec turbo run build --filter=@fan-support/api... --filter=@fan-support/worker... --filter=@fan-support/admin^... --filter=@fan-support/storefront^... --concurrency=1
   ```
2. **创建实例，但不启动**：
   ```bash
   FAN_SUPPORT_LOCAL_POSTGRES_BIN=/usr/lib/postgresql/18/bin pnpm local:prepare --instance stg --public-base-domain stg.kikikong.com
   ```
3. **配置 Caddy**（root 执行）：
   - 把实例 CA 复制到 `/etc/caddy/fan-support-local-ca.crt`（CA 是公开证书，不是密钥）；
   - 用 `caddy hash-password` 从标准输入读取访问密码，生成 bcrypt 哈希；
   - 以 `xiadan` 身份执行 `pnpm local:caddy --instance stg --auth-user tester --auth-hash-file <哈希文件> --bind <本机内网 IP> --redirect-to-storefront kikikong.com`（内网 IP 用 `hostname -I` 查看；主域名 302 跳转到商城，后台根路径 `/` 302 跳转到 `/en`），把输出写入 `/etc/caddy/Caddyfile`；
   - 依次执行 `caddy validate`、`systemctl enable --now caddy`（修改绑定地址后要用 `restart`，不能只 `reload`）。
   - 等证书签发完成（`journalctl -u caddy` 里出现 "certificate obtained"）再启动实例：首页初始化时会经过 Caddy 访问 `s3.` 主机。
4. **启动**：把 `infra/remote-test/fan-support-remote-test@.service` 复制到 `/etc/systemd/system/`，然后执行 `systemctl enable --now fan-support-remote-test@stg`。首次启动要初始化数据，并让 Next 首次编译，大约需要 10–20 分钟。

## 日常

- **走查**：在开发机上执行 `node apps/api/scripts/remote-test-walkthrough.mjs`（位于 `apps/api` 下）。所需环境变量为 `REMOTE_TEST_BASE_DOMAIN`、`REMOTE_TEST_AUTH_PASSWORD`、`REMOTE_TEST_MAIL_TOKEN`，值从本机凭据文件读取。它会检查商城、后台登录、创建内容、下单、模拟支付和收件箱，截图写到 `output/checks/remote-test/`。加 `--no-seed` 则不创建新内容。

- **更新代码（PREBUILT，当前做法）**：停机 → 冷备份 → 更新 → 构建 → 启动，一次只做一步。
  1. root：`systemctl stop fan-support-remote-test@stg`；
  2. 冷备份 `~/app/node_modules/.cache/fan-support-local-experience/stg` 到 `~/backups/stg-pre-<提交>-<日期>`，旧版本号写进同名 `.revision`；
  3. 开发机 `git push staging v2/r1-production`；服务器 `cd ~/app && git fetch origin && git reset --hard origin/v2/r1-production && pnpm install --frozen-lockfile`；
  4. `pnpm local:build-web`：按容器镜像的方式构建 admin、api、storefront、worker（`--concurrency=1`），退出码如实返回，成功才写戳记（`node_modules/.cache/fan-support-local-experience/web-build.json`，记录提交与两个 `BUILD_ID`）。有实例在运行时它拒绝执行。2026-09-30 首次实测：全量未命中缓存约 470 秒，内存峰值约 3.5GB、swap 约 235MB，必须先停实例；
  5. 只有看到 `build exit 0` 才启动：root `systemctl start fan-support-remote-test@stg`，约 16–18 秒就绪；
  6. 抽查动态路由（政策、艺人/礼物详情、查单入口、后台 `/en`）。
  7. 更新里含新的权限键或标准角色时（例如 L3-11 的经纪人角色），启动后以 `xiadan` 执行一次 `node apps/api/scripts/admin-account.mjs sync-roles --instance stg`。它只补不删，可重复执行；不执行的话，员工页创建该角色会报“角色不存在”，已有角色也拿不到新权限。
- **切换 Web 模式**：`pnpm local:web-mode --instance stg --mode PREBUILT|DEVELOPMENT`，下次启动生效。`PREBUILT` 要求当前提交已 `local:build-web`；`DEVELOPMENT` 会删掉 `webMode` 字段（旧代码不认识这个字段，回退代码前必须先切回）。开发模式下更新代码仍是"reset、install、构建依赖包、restart"，Next 在运行时编译，健康等待 10 分钟。
- **回滚**：最快是切回 `DEVELOPMENT` 再重启（同一版本回到开发服务器，不用重新构建）；回退代码时先切回 `DEVELOPMENT`，再 reset 到冷备份 `.revision` 记录的版本，必要时用冷备份替换实例目录。
- **状态**：`pnpm local:status --instance stg`；supervisor 日志在 `~/app/node_modules/.cache/fan-support-local-experience/stg/supervisor.log`，只含结构化阶段。
- **报错排查（PREBUILT）**：正式构建没有开发日志（`.next/dev/logs/next-development.log`），浏览器端报错不会回传服务器，React 报错压缩成错误码。
  - 服务端：两个 Next 进程输出里只有通过结构化日志校验的事件行写进同目录 `web-events.log`（权限 0600，约 4MB 轮转一次，保留一个 `.1`），其余输出丢弃；
  - 浏览器端：用 Playwright 采集控制台和页面报错；真机问题临时切回 `DEVELOPMENT` 复现。
- **重置测试数据**：先停止实例，再执行 `pnpm local:reset --instance stg --confirm <instanceId>`。这会删除本实例的全部数据和图片，属于不可逆操作，需要用户确认。
- **换域名**：必须新建实例（配置、身份源、支付绑定和证书都绑定在对外地址上），然后重新生成 Caddyfile。

## 后台账号（内置账号，ADR-021）

- **切换登录方式**：`pnpm local:admin-sign-in --instance stg --mode LOCAL_ACCOUNT`（或 `LOCAL_OIDC`），下次启动生效，之后重新生成 Caddyfile。
- **服务器命令**（以 `xiadan` 身份在 `~/app` 执行，都加 `--instance stg`，审计记为 SYSTEM `admin-account-cli`）：
  - `node apps/api/scripts/admin-account.mjs list`
  - `node apps/api/scripts/admin-account.mjs create --login <登录名> --name <显示名> [--role studio:owner|studio:operator|studio:broker] --password-stdin`
  - `node apps/api/scripts/admin-account.mjs sync-roles`：补齐权限目录和三个标准角色，不创建账号（代码更新带来新权限或新角色后执行）。
  - `reset-password --login <登录名> --password-stdin`、`clear-2fa --login <登录名>`、`suspend --login <登录名>`、`reactivate --login <登录名>`
  - 密码只从标准输入或无回显提示读取，不能写进参数。从开发机远程执行时，把密码经 SSH 的标准输入传过去，不要写在命令行里。
  - `create` 和 `sync-roles` 都会幂等补齐权限目录和"工作室管理员 / 日常运营 / 经纪人"三个标准角色（只补不删）。
- **经纪人与艺人归属（ADR-022）**：经纪人账号在后台"员工账号"里创建（角色选"经纪人"），或用上面的 `create --role studio:broker`。艺人归属由工作室管理员在艺人编辑页的"归属经纪人"里选择，修改后立即生效；经纪人自己添加的艺人自动归自己。暂停经纪人账号不会改动名下艺人，列表里显示"（已停用）"，需要管理员改派。
- **当前账号**：`studio.owner`（工作室管理员，用户已自行开启两步验证，自动化验收不要动它；密码只保存在开发机 `C:\Users\admin\.tools\xiadan-stg-admin.txt`）；`qa.check` 是真实域名验收用的账号：验收脚本自己生成随机密码，经 SSH 标准输入交给 `reset-password`，用完清除两步验证并暂停。
- **重新生成 Caddyfile**：Basic Auth 哈希没有另存时，以 root 用 `grep -oE '[$]2[aby][$][0-9]{2}[$][./A-Za-z0-9]{53}'` 从现有 `/etc/caddy/Caddyfile` 提取到只有 `xiadan` 可读的临时文件，再以 `xiadan` 执行 `pnpm local:caddy ... --auth-hash-file <临时文件>`。对比时先把哈希替换成占位符再 `diff`，确认只有预期的变化；`caddy validate` 通过后安装，`systemctl reload caddy`，最后删除临时文件。远程执行时用 `ssh ... 'bash -s' <<'EOF'` 传脚本，避免 `$[` 被当成算术展开。

## 访问

| 地址 | 用途 | 密码 |
|:--|:--|:--|
| `https://storefront.stg.kikikong.com/en` | 商城 | 否 |
| `https://kikikong.com` | 302 跳转到商城 | 否 |
| `https://admin.stg.kikikong.com` | 后台（内置账号登录；根路径会跳转到 `/en`） | 否，用后台自己的账号 |
| `https://mail.stg.kikikong.com` | TEST 收件箱 | 是 |
| `https://payments.stg.kikikong.com` | TEST 支付页，由结账流程跳转 | 否 |

Basic Auth 的账号和密码只保存在运维者本机的文件里，服务器上只有哈希；后台账号见上一节。
