# 远程测试环境：把本地体验环境公开到真实域名

> 日期：2026-09-27 · 依据：用户 2026-09-27 决定（远程测试环境 / 4GB 服务器 / 前台公开、后台加密码）
> 性质：TEST 适配器环境，**不是** staging 或生产，结果不作 P5-08 或上线验收证据（`docs/runbooks/local-experience.md`）

## 目标

在一台 Linux 服务器上运行现有的本地体验栈（原生 PostgreSQL 18、Docker versitygw、TEST OIDC/PSP/邮件/媒体、进程内 API、worker、两个 `next dev`），经由真实域名和受信任的 HTTPS 访问，手机和他人都能打开商城。

## 现状障碍

- 对外地址写死为 `https://<服务>.example.invalid:<端口>`（`scripts/local-experience-state.mjs`），配置 schema 要求地址端口等于监听端口（`local-experience-config.mjs`）。
- 服务按地址里的端口监听（`startLocalTlsServer`），内部调用按地址里的端口直连（`createLocalExperienceFetch`）。
- 浏览器上传的预签名地址是 `https://localhost:<端口>`。
- TEST OIDC 的身份选择页不需要密码。

## 设计

1. **暴露模式在实例创建时确定**：`pnpm local:start --instance <名称> --public-base-domain <域名>`。
   - 配置新增可选字段 `exposure`：`{ mode: "PUBLIC", baseDomain }`；省略即原有的回环模式，老实例不受影响。
   - 已有实例若和参数不一致，直接拒绝。换域名要新建实例：身份源、支付绑定和证书都绑定在对外地址上。
2. **对外地址与监听端口分离**：
   - PUBLIC 模式下，对外地址是 `https://<服务>.<域名>`（无端口，443）；服务仍只监听 `127.0.0.1:<ports[服务]>`，仍使用本地 CA 证书（SAN 含公网主机名），并按公网 Host 校验。
   - 回环模式保持不变。
3. **内部调用不经 Caddy**：`createLocalExperienceFetch` 改为接收"地址→端口"表，直连本地端口，并按主机名校验本地证书。后台、登录页、收件箱前面的密码因此不会拦住服务之间的调用。
4. **对象存储**：
   - 服务端 SDK 仍使用 `https://localhost:<s3>`；浏览器与媒体处理器使用的预签名地址是 `https://s3.<域名>`（适配器本来就区分 `endpoint` 和 `presignEndpoint`）。
   - 本地 S3 代理两种 Host 都接受；SigV4 签名的 Host 经 Caddy 原样保留。
5. **主机名解析**：PUBLIC 模式下，supervisor 和 Next 进程预加载的 DNS 映射把公网主机名解析到 127.0.0.1。Next 连本机 443（Caddy），不依赖云上回环访问公网 IP。
6. **Caddy**：`pnpm local:caddy --instance <名称>` 按配置生成 Caddyfile。
   - 每个公网主机都用 Let's Encrypt 证书，反向代理到 `https://127.0.0.1:<端口>`，信任本地 CA，按主机名校验。
   - Basic Auth 范围：后台和收件箱整站；OIDC 只保护浏览器页面，discovery、JWKS、token 保持开放（这几个接口本来就需要客户端密钥或授权码）。
   - 商城、模拟支付页、媒体、S3 不加密码。
   - 密码随机生成，明文只保存在运维者本机的文件里，服务器上只存 bcrypt 哈希。
7. **运维**：
   - 用专用用户 `xiadan` 运行，由 systemd 托管 `local:start --skip-build`；设置 `FAN_SUPPORT_LOCAL_POSTGRES_BIN=/usr/lib/postgresql/18/bin`。
   - 代码经服务器上的 git 裸仓库推送，不在服务器上放 GitHub 凭据。

## 公网主机（基础域名 `stg.kikikong.com`）

| 主机 | 用途 | 密码 |
|:--|:--|:--|
| `storefront.` | 商城 | 否 |
| `admin.` | 后台 | 是 |
| `oidc.` | TEST 登录 | 仅浏览器页面 |
| `mail.` | TEST 收件箱 | 是 |
| `payments.` | TEST 支付页 | 否 |
| `media.` | 媒体 | 否 |
| `s3.` | 上传 | 否（只接受预签名请求） |

## 验证

- 单测：配置 schema（两种模式、端口规则、拒绝混用域名）、`localServiceOrigin`、地址→端口直连。
- 本机：回环模式的既有测试全部通过。
- 服务器：按运行手册执行全链路走查，覆盖后台上传礼物、商城下单、TEST 支付、查单、收件箱、送达照片，并在 390×844 与 1440×900 两种视口下检查。

## 不做

- 生产或 staging 组合：AWS S3/KMS/CloudFront、真实 OIDC、邮件服务商，属于 R1-4/R1-5/R1-9。
- 公开 TEST 适配器无密码访问。
