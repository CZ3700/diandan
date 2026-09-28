# 交接：同步远端、stg 更新与旧账清理完成 → 下一步 L3-10 后台内置账号登录

> 日期：2026-09-29
> 执行：Claude（Windows 端）
> 分支：`v2/r1-production`
> 冷启动顺序：AGENTS.md → SPEC §0.3–0.4 → [上线计划](../plan/2026-09-28-flexible-storefront-launch.md) → [当前进度](../progress/launch-progress.md) → 本文件。

## 背景

远端开发者（Mario）09-28～09-29 在同一分支推进了 ADR-020「可配置装修＋完整交易」的 L0–L3-07，共 13 个提交，迁移从 0043 推进到 0051，没有部署到服务器。本会话完成三件事：

- 把本机同步到他的最新代码；
- 把远程测试环境 stg 更新到新版本；
- 按用户决定，把两端并行开发的分工、后台登录方案和应援凭证方案落盘。

## 用户决定（2026-09-29）

1. **stg 部署**：同意把新代码部署到 stg。
2. **虚拟礼物**：选方案 a「可保存的应援凭证」，见 ADR-019 增补，进度条目 L3-09。
3. **协作方式**：两端一起前进。各自做完的事推送代码并留下完整记录，另一方同步。开工前在 launch-progress.md 登记认领的条目。
4. **旧账**：一起处理掉。
5. **后台登录**：
   - 用我们自己在服务器上创建的账号密码登录；
   - 登录页要正式设计，不要现在这种潦草的一个框；
   - 登录后在设置里可以扫码绑定 2FA，**2FA 不强制**；
   - 要有修改密码等功能。
   - 见 ADR-021 与 SPEC 5.1.0 §0.4。Claude 建议过强制 2FA，用户选择自选；风险已写入 ADR-021。
6. **外部资源**：Zoho 已开通（若 ZeptoMail 事务发信未开通，后面专门处理，先完成功能）。Airwallex 暂时不能提供。
7. **stg 访问密码**：本会话中 Claude 误把 stg Basic Auth 密码打印进了对话（凭据文件用全角冒号，过滤规则没匹配上）。用户决定**不轮换**。
8. **CI**：同意开草稿 PR 跑 CI，即 PR #15。

## 已完成

| 事项 | 结果 |
|:--|:--|
| 同步远端 | 本机快进到 b0270006，依赖安装完成。本机门禁：类型检查和构建全过，测试串行全过，唯一真失败是 Windows 下的文件权限断言，已修复（cf41d5d1）。 |
| 决定落盘 | ADR-021、ADR-019 增补、SPEC 5.1.0 §0.4、上线计划的"协作约定与 Claude 认领条目"、进度表的 L3-09 / L3-10 / stg 三行、AGENTS.md 与 CLAUDE.md 入口（686ec7a9）。 |
| stg 更新 | 停机后冷备份整个实例到 `~/backups/stg-pre-b0270006-20260929`，回滚版本记在同名 `.revision` 文件。更新到 b0270006，启动时自动执行 0044–0051。 |
| stg 走查 | 实物礼物和虚拟礼物各一轮完整走查通过：后台登录、新建艺人/礼物/海报、加购、TEST 付款、邮件链接查单。 |
| 装修预览 | 首页布局、全站主题、导航页脚三个预览都在真实域名下跨域渲染成功；信息页入口正常。首次打开时，开发服务器编译预览页较慢，握手可能超时显示"无法加载"，点"重新加载"即好，正式构建没有这个问题。 |
| T-9 远程实测 | 删除后，后台列表和前台目录都不再出现（sitemap 查询本就排除已归档对象，是从代码确认的，没有在 stg 上实测）；购物车里只有那一行不可用；已付款订单在查单页和后台订单都正常；首页主视觉艺人被删后，首页保留海报并去掉艺人链接。**发现缺口**：被删的详情页返回 200"此页面暂时不可用"，已修为 404（1717eda0）。 |
| T-10 遗留 | 那两条失败编辑是版本冲突、不可重试，列表每次加载都显示"内容已在别处更改"且关不掉。现在已增加"知道了"按钮（261fad39，七语言，记在本浏览器）。 |
| T-1 | 模拟 iPhone 视口访问 en/zh-CN/th/vi 页面，没有水合报错。真机复测仍需用户。 |
| CI（PR #15） | operations 通过；Security 失败已修复（235bd771，给 Security 任务补构建 Stripe 包）。其余失败见下方"在途"。 |
| 修复部署复核 | 本地完整门禁通过：类型检查 69 项；测试串行全过（persistence 单跑，其余 68 个任务）；构建 38 项。已推送 1717eda0 并部署到 stg：被删礼物/艺人详情页 en 与 zh-CN 都返回 404，正常首页/艺人/礼物页 200。"知道了"按钮只做了单元测试：那两条旧失败已被今天新增的操作挤出"最近 10 条"窗口，stg 上暂时没有可点的失败提示，列表干净。 |

## 在途

### CI 回归（PR #15，未修）

报告在本机 `output/checks/sync-2026-09-29/ci/artifacts/`：

- **quality**：`quality-ui-composites` 的 P2-04 组合组件样板页，在"葡萄牙语 + Chrome 200% 缩放"下横向溢出 1 像素（clientWidth 847、scrollWidth 848）。本机有 Chrome，可以复现。
- **catalog**：`catalog-fallback-seo` 在 HOMEPAGE 的故障回退检查报错，日志没有细节。时间上与 L1 首页布局改动吻合，建议先和远端开发者确认。
- **journey 与 commerce-orders**：CI 内容准备阶段，SAVE_GIFT 以 `PUBLICATION_FAILED`（可重试）失败，截图见 journey 附件的 `failure-upload.png`。stg 上同样操作正常。附件里没有 worker 日志，要修先得给回归脚本加诊断输出（上传 worker/S3 日志）。可能与 09-26 的 S3 TLS 代理 502 同源。

PR #15 保持打开。推送 1717eda0 后已自动重跑一轮，用来确认 Security 修复；交接时这一轮还在跑。下个会话先看 Security 的结果，再按惯例关闭 PR。

### 其他

- stg 上还有一批合成测试数据（Demo/T9 艺人与礼物、测试订单），不影响使用。

## 下一步：L3-10 后台内置账号登录

范围与验收清单见上线计划的 L3-10 一节。以下是本会话调研出的实现要点（file:line 截至 b0270006），开工时不必重新探索。

**现有登录链路（OIDC）**

- 登录按钮在 `apps/admin/src/management-center/login.tsx:25`，经 `workspace/client.ts:107` POST 到 `/api/admin/auth/begin`。
- BFF 路由在 `apps/admin/src/app/api/admin/auth/{begin,callback,logout}`，逻辑在 `apps/admin/src/server/admin-access-bff.ts`：
  - 模式门在 30–32，TEST/DISABLED 下返回 404；
  - origin 检查在 104–132；
  - 调 API 在 133–168；
  - 设置 Cookie 在 276–281，名称为 `__Host-fan-admin-session` 和 `-csrf`，SameSite=Strict，最长 28800 秒。
- API 路由在 `apps/api/src/admin-access-route.ts`，固定三条路由（105–124），并校验 access key。
- 应用层在 `packages/application/src/admin-access.ts`：begin 在 104–168；callback 在 169–286，会拒绝没有 MFA 或认证时间过旧的请求。
- 会话写入在 `packages/persistence-postgres/src/admin-access-repository.ts:151-224`：锁定 `admin_identities(issuer, external_subject_hash)`，要求 ACTIVE，插入 `admin_sessions` 时 `authenticated_with_mfa=true`。
- 数据库触发器 `0030_admin-access.up.sql:57-84` 强制三件事：审计原因码必须精确匹配、会话 TTL 在 60–28800 秒之间、会话必须经过 MFA。**L3-10 的迁移要扩展原因码，并只对内置 issuer 放宽 MFA 约束。**

**身份与权限**

- `admin_identities` 只有 issuer、`external_subject_hash`（用 subjectPepper 对 [issuer, subject] 做 HMAC，见 `admin-access-tokens.ts:11-23`）、status 和 `mfa_required`，没有用户名和密码列。
- 角色和权限相关表在 `0001_foundation-security.up.sql:173-234`。
- 授权检查在 `admin-authorization-repository.ts:70-113`，检查会话、MFA、ACTIVE、CSRF 和权限键。
- 本地体验通过 `apps/api/scripts/local-experience-bootstrap.mjs:53-143` 插入两个 OIDC 身份（manager/reviewer）。

**建议做法**

- 内置账号使用平台专用 issuer（例如 `urn:fan-support:local`），subject 为账号 id。这样 `admin_identities`、角色和权限都不用改。
- 新表存登录名、scrypt 哈希与参数、失败计数/锁定时间、加密后的 TOTP 密钥和恢复码摘要。
- 仓库里没有密码哈希、TOTP 或二维码相关依赖：
  - scrypt 用 `node:crypto`；
  - TOTP 按 RFC 6238 用 `node:crypto` HMAC-SHA1 自己实现；
  - 扫码需要生成二维码，要么引入一个小依赖（先过 pnpm 供应链策略），要么自己实现编码。开工时先定。
- 限速可以复用 `order-access-rate.ts`（迁移 0028 的 `order_access_rate_limits` 模式）。
- 后台模式新增 `LOCAL_ACCOUNT`。`workspace/pages.tsx:20-31` 的 `authenticationAvailable` 和 `center.tsx:75-101` 的未登录界面需要改为新的登录页。
- stg 需要本地体验脚本支持新模式，并用服务器命令创建初始管理员。验证通过后重新生成 Caddyfile，撤掉后台的 Basic Auth，收件箱保留。
- 迁移从 0052 起。改完用 `pnpm --filter @fan-support/persistence-postgres migrations:manifest`、`migrations:catalog` 和根目录的 `pnpm contracts:generate` 重新生成。

之后是 L3-09 应援凭证，范围见上线计划的 L3-09 一节。

## 环境注意

- **跑 stg 脚本**：凭据启动器在 `output/checks/remote-test/with-stg-creds.mjs`，用法是 `node <启动器> <脚本绝对路径>`。它从凭据文件解析密码和收件箱令牌，只注入到子进程环境，不打印。
  - 本会话的复核脚本在 `output/checks/sync-2026-09-29/`：`stg-olditems.mjs`、`stg-followup.mjs`、`stg-t9-detail-probe.mjs`。
  - 这些脚本通过 `createRequire` 从 `apps/api` 解析 playwright，所以不必复制到 `apps/api` 下。
- **凭据文件**：永远不要输出凭据文件的内容，哪怕是"隐藏值"的过滤版本。
- **stg 数据库**：需要密码，验证时不要去取它，改用公开页面和 `data-theme-status` 之类的外部信号。
- **stg 路由**：艺人路由是 `/:locale/idols/<handle>`，没有 `/artists`。
- **CI**：配置了 `cancel-in-progress`，推送会取消进行中的一轮；要拿报告，就等它跑完再推送。
- **本机门禁**：`check:dev` 仍有并行负载超时误报，按 `persistence 单跑 --maxWorkers=12 + 其余 --concurrency=1` 串行复跑确认。
