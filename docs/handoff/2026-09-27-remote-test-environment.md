# 交接：远程测试环境已上线（stg.kikikong.com）→ 下一阶段 F2 榜单与公会赛

> 日期：2026-09-27
> 项目：`C:\Users\admin\Desktop\下单\下单`
> 分支：`v2/r1-production`（已推送 origin 和服务器裸仓库，工作区干净；没有打开的 PR）
> 新会话冷启动顺序：
> 1. 本文件；
> 2. `docs/runbooks/remote-test-environment.md`（服务器怎么更新、怎么复测）；
> 3. `docs/handoff/2026-09-27-f1-ci-pr14.md`（F1 的 CI 结论与 F2 的开工清单）；
> 4. 进入 F2 前读 `docs/decisions/018-leaderboards-guild-results.md`。

## 背景

用户 2026-09-27 要求把项目部署到自己的云服务器上，以便随时在真实服务器环境里测试，并对该服务器全权授权。调研发现，正式 staging 还不能部署：存储和密钥只接 AWS，后台身份源（R1-5）、邮件（R1-4）、镜像构建与迁移任务（R1-9）都没做。用户选择了"远程测试环境"：把本地体验栈公开到真实域名，全部使用 TEST 适配器。

## 已完成

| 事项 | 验证 |
|:--|:--|
| **服务器**：Lightsail 新加坡，Debian 12，4GB 内存 + 4GB swap，静态 IP `18.143.148.122`。装有 Node 24.20.0（SHA256 校验）、pnpm 11.25.0、PostgreSQL 18（PGDG）、Docker、Caddy；ufw 只放行 22/80/443。运行用户是 `xiadan`，代码经服务器上的裸仓库（本机 remote `staging`）推送 | 软件版本逐项确认；防火墙启用后 SSH 仍然可用 |
| **补丁**（提交 `faa7fca` 到 `2acd3e5`）：本地体验新增公网模式、`local:prepare`、`local:caddy`、systemd 服务模板、运维走查脚本 | Linux 上本地体验单测 65/65；`check:dev` 前五段通过，test 段只有既有的持久化冷启动超时，其余串行 68/68 |
| **上线**：实例 `stg`，基础域名 `stg.kikikong.com`（Cloudflare 通配记录 `*.stg`，灰色云朵）；Let's Encrypt 证书 7 张 | `remote-test-walkthrough.mjs` 从开发机全程通过：商城、后台（Basic Auth + TEST OIDC）、艺人/礼物/海报发布、下单、TEST 支付、已付款订单、收件箱查单链接 |
| **测试内容**：已有演示艺人、礼物和海报 | 礼物详情页的图片和价格都正常显示 |

## 关键决策及理由

1. **不做正式 staging，做 TEST 远程环境**（用户决定）。正式 staging 属于 R1-4/5/9，仍排在最后。
2. **Basic Auth 只保护后台、收件箱和 OIDC 身份选择页**（用户决定：前台要能正常访问）。TEST 身份页不需要密码，公开出去等于谁都能进后台。
3. **每个 Next 开发服务器独占一个回环地址的 443**。Next 开发模式始终用 `hostname||'localhost'` 加监听端口构造请求地址（`next/dist/server/lib/render-server.js`），`experimental.trustHostHeader` 在开发模式下走不到，第一次尝试已回滚（`35948bb`）。只有让 `--hostname:--port` 等于公网地址，后台 BFF 的同源校验才能通过，这也正是回环模式本来的工作方式。代价有两个：Caddy 只能绑定 `127.0.0.1` 和内网 IP；需要设置 `ip_unprivileged_port_start=443`。
4. **Caddy 必须 `header_up Host {host}`**：上游是 HTTPS 时，Caddy 默认会把 Host 改写成上游地址。本地服务按 Host 校验，SigV4 签名也包含 Host。
5. **对外地址在实例创建时固定**，换域名要新建实例（会清空测试数据）。所以用户在部署前就配好了正式域名，而没有先用临时域名。
6. **凭据**：访问密码和收件箱令牌只存在本机 `C:\Users\admin\.tools\xiadan-stg-access.txt`，服务器上只有 bcrypt 哈希，对话里从未出现过。

## 在途

没有改到一半的代码。待观察的问题：
- 第 2 次走查时创建艺人偶发失败（后台提示 "This update could not be completed"），第 3 次通过，原因未查；
- ~~订单页礼物图片是占位图~~：确认只是加载时序问题，等页面加载完即正常显示；
- ~~Next 开发模式的 "Issue" 角标~~：原因是订单页 CSP 缺少开发模式所需的 `'unsafe-eval'`，已修复（`0b4f320`）；
- 内存占用 3.0GB/3.8GB，开发模式运行时间长了可能要重启服务，或者升到 8GB；
- ~~主域名~~：按用户要求用 302 跳转到商城；后台根路径也会跳转到 `/en`（`5d2fedf`）。
- Basic Auth 密码曾因运维命令被打印出来，已经轮换（2026-09-27）。以后检查带认证的地址时只打印状态码，用 `curl -K -` 从标准输入读取凭据，不用 `-u`，也不打印 `%{redirect_url}`。

## 下一步

1. **F2 榜单与公会赛**：按 `2026-09-27-f1-ci-pr14.md` 的"下一步"开工，先写 `docs/plan/f2-leaderboards-guild.md`，拆成子里程碑。每完成一项就推送到服务器（`git push staging` 后按运行手册更新并重启），用走查脚本复测。
2. 按需排查上面的待观察项（偶发的发布失败优先）。
3. 其余遗留仍在"CI 四组回归失败修复"里（临时 S3 夹具的代理 502 等）。

## 环境注意

- **SSH 别名**：`xiadan`（root）、`xiadan-app`（运行用户），密钥是 `~/.ssh/xiadan_deploy_ed25519`。
- **服务管理**：`systemctl restart fan-support-remote-test@stg`，重启后约 1 分钟就绪。修改 Caddy 的绑定地址后要 `restart`，不能只 `reload`。
- **Python 写文件的坑**：heredoc 里的 `\t`、`\n`、`\U` 常被错误转义。涉及正则或模板字符串的替换，改用 Edit 工具更稳。
- **不能在服务器上临时改源码调试**：路由按 ESM 编译，没有 `require`，改坏会直接 500。本次的临时修改都已用 git 还原。
- 查单链接是一次性的；走查用过的链接，再打开会显示失效。
