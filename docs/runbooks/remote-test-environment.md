# 远程测试环境运行手册

> 设计：`docs/plan/remote-test-environment.md`。本环境全部使用 TEST 适配器（模拟身份、支付、邮件），**不是** staging，也不能作为上线验收证据。

## 形态

- 一台 Debian 12 服务器（当前是 Lightsail 4GB，静态 IP `18.143.148.122`），运行用户是 `xiadan`，代码在 `/home/xiadan/app`。
- 实例 `stg`，基础域名 `stg.kikikong.com`。Cloudflare 上配一条通配记录 `*.stg` A → 服务器 IP，**仅 DNS（灰色云朵）**。
- Caddy 负责 Let's Encrypt 证书，并把 `https://<服务>.stg.kikikong.com` 反向代理到本机的 TLS 服务。Basic Auth 保护后台、收件箱和 OIDC 身份选择页。
- 服务器上已安装：Node 24.20.0（`/opt`，经 SHA256 校验）、pnpm 11.25.0（corepack）、PostgreSQL 18（PGDG，只用二进制，集群由实例自己管理）、Docker、Caddy；另有 4GB swap。
- 两个 Next 开发服务器分别监听 `127.0.0.2:443`（商城）和 `127.0.0.3:443`（后台）。Next 用启动时的 `--hostname:--port` 构造请求地址，只有监听 443，这个地址才会等于公网地址。
  - 为此 `/etc/sysctl.d/99-xiadan.conf` 设置了 `net.ipv4.ip_unprivileged_port_start=443`；
  - Caddy 只绑定 `127.0.0.1` 和本机内网 IP（`default_bind`），不占用这两个地址。
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

- **更新代码**：推送后在服务器上执行 `git reset --hard`、`pnpm install`、构建，再 `systemctl restart fan-support-remote-test@stg`。
  - 共享包改动会导致全量重建，重启后 Next 首次编译较慢。每个网页应用的健康等待是 10 分钟，整体仍受 `--startup-timeout-seconds 1500` 限制。
  - 2026-09-27 之前健康等待只有约 90 秒，一次全量重建后的重启曾因"admin did not become healthy"失败，再次重启即可。
  - 重启命令会等到就绪才返回，可放后台执行，再用 `pnpm local:status --instance stg` 查看。
- **状态**：`pnpm local:status --instance stg`；supervisor 日志在 `~/app/node_modules/.cache/fan-support-local-experience/stg/supervisor.log`，只含结构化阶段。
- **重置测试数据**：先停止实例，再执行 `pnpm local:reset --instance stg --confirm <instanceId>`。这会删除本实例的全部数据和图片，属于不可逆操作，需要用户确认。
- **换域名**：必须新建实例（配置、身份源、支付绑定和证书都绑定在对外地址上），然后重新生成 Caddyfile。

## 访问

| 地址 | 用途 | 密码 |
|:--|:--|:--|
| `https://storefront.stg.kikikong.com/en` | 商城 | 否 |
| `https://kikikong.com` | 302 跳转到商城 | 否 |
| `https://admin.stg.kikikong.com` | 后台（TEST 身份登录；根路径会跳转到 `/en`） | 是 |
| `https://mail.stg.kikikong.com` | TEST 收件箱 | 是 |
| `https://payments.stg.kikikong.com` | TEST 支付页，由结账流程跳转 | 否 |

访问账号和密码只保存在运维者本机的文件里，服务器上只有哈希。
