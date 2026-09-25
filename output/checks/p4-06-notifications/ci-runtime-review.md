# P4-06 CI runtime independent review

审查人：`/root/order_bff`。日期：2026-09-16。范围：只读新增通知/过期集成测试入口、依赖与 CI 时限；仅写本报告，未修改源代码、安装依赖或重跑重型检查。

**结论：当前 quality 45 分钟修订、Ubuntu 24.04 运行前提和测试发信隔离的源码范围 ACCEPT。没有发现必须在再次冻结前修复的 Chrome/TLS/平台阻断。实际 Linux CI 通过与最终全仓通过仍待 root 的真实运行结果；本报告不替代它们。**

## 1. 时限问题已修复，45 分钟是合理起点

根 [package.json](/Users/mario/Desktop/下单/package.json:38) 的 `test:postgres` 串行追加两个命令；[persistence-postgres/package.json](/Users/mario/Desktop/下单/packages/persistence-postgres/package.json:36) 实际新增三个串行长夹具：expiry action probe、expiry fixture、notification integration。两个命令均先构建 API/Worker 依赖闭包。通知浏览器还通过现有 Next harness 构建并启动真实 Storefront。

| 已读取证据 | 状态 | 本地耗时依据 |
| --- | --- | --- |
| `output/checks/p4-05-order-storefront/check-full-1-result.json` | exit 0 | 原单条完整检查 1737.580 秒 |
| `output/checks/p4-06-commerce-expiry/action-2026-09-16T02-31-05.164Z/run-result.json` | PASS，5843 assertions，sourceUnchanged | 目录时间至 completedAt 为 83.278 秒 |
| `output/checks/p4-06-commerce-expiry/run-2026-09-16T02-31-05.164Z/run-result.json` | PASS，6105 assertions，sourceUnchanged | 同法约 144.787 秒 |
| `output/checks/p4-06-notifications/persistence/run-2026-09-16T02-31-39.751Z/run-result.json` | PASS，6812 assertions，sourceUnchanged | 同法约 138.908 秒 |

后三项 JSON 没有独立 startedAt；这里明确采用夹具创建输出目录的时间估算，而且不含其上游所有准备成本。两项 expiry 独立证据曾并行开始，根脚本却串行执行，因此预算应累计各自区间，不能只算共同墙钟跨度。

`1737.580 + 83.278 + 144.787 + 138.908 ≈ 2104.553 秒`，约 **35 分 05 秒**。旧 30 分钟仅给旧检查留下 62.42 秒，已不足承载约 6 分钟新增工作。该数字是本地预算估算，不是 Ubuntu 实测；冷安装、Docker 镜像拉取、CPU/架构与 Turbo 缓存命中会改变耗时，job timeout 还覆盖安装步骤。

已复核 root 修订：

- [ci.yml](/Users/mario/Desktop/下单/.github/workflows/ci.yml:23) 的 Quality 为 45 分钟，Security 仍为 20 分钟。
- [check-ci.mjs](/Users/mario/Desktop/下单/scripts/check-ci.mjs:68) 精确预期同步为 45/20，没有放松整体工作流结构断言。
- `ci-budget-red-result.json` exit 1，日志为工作流不符合批准策略；`ci-budget-green-result.json` exit 0，日志 `CI contract check passed`。这些结果均已读取。

45 分钟提供约 10 分钟本地估算余量，适合作为本轮修复；不是承诺每次冷 CI 都能在此时限完成。保留全部测试与既有隔离；后续先按真实 CI 时间再拆分独立 job 或共享经严格清理的夹具初始化。不要在同一工作目录直接并行多个会写 `.next` 的浏览器构建。

## 2. Ubuntu 24.04、Chrome 与 TLS 可运行性

截至本次读取，官方 Ubuntu 24.04 runner 清单的 image version 为 `20260907.300.1`，列有 Google Chrome `152.0.7977.82`、Docker client/server `28.0.4`、OpenSSL `3.0.13`，并缓存 Node `24.20.0`。这是当前发布清单；具体 CI 机器以其 Set up job 日志为准。[官方镜像清单](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)

- [notification-link-browser.mjs](/Users/mario/Desktop/下单/apps/worker/scripts/notification-link-browser.mjs:119) 明确 `chromium.launch({ channel: "chrome", headless: true })`，没有 macOS 可执行文件路径。它用的是系统品牌 Chrome。官方 runner 安装脚本通过 amd64 deb 安装 Chrome 及包依赖；因此没有 `playwright install` **不是此工作流的确定缺陷**。[镜像 Chrome 安装脚本](https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/install-google-chrome.sh)；[Playwright 品牌浏览器渠道说明](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge)
- 这是 headless 运行，不依赖桌面会话或 Xvfb；没有新增 macOS shell 命令、Homebrew、`/Applications` 路径、AppleScript 或 Windows-only API。
- Playwright/Axe 来自已锁定的根依赖；API/Worker 依赖闭包先构建。receiver 直接 import `src/harness.tls.ts`，该文件只含可擦除 TS 类型，没有 enum/namespace/parameter property；CI 固定 Node 24.20.0，符合现有本地运行方式。
- [harness.tls.ts](/Users/mario/Desktop/下单/packages/notification-provider/src/harness.tls.ts:9) 使用标准 `openssl req` / `x509`、RSA/SAN、Node HTTPS、`tmpdir` 和 `path.join`；证书生成通过参数数组执行，未依赖 macOS 命令语法。监听固定 127.0.0.1，私钥权限 0600，自建 CA 只传给测试客户端，`rejectUnauthorized: true`。
- 共用 S3 harness 的 `openssl -addext` 适用于上述 OpenSSL 3；子进程带专用 `NODE_EXTRA_CA_CERTS`，并强制 `NODE_TLS_REJECT_UNAUTHORIZED=1`。浏览器仅为自有测试证书使用精确 SPKI pin，并把测试域名映射回 loopback。
- PG/S3 均通过既有 Docker harness 创建随机名、digest 固定的临时容器与 loopback 端口，不依赖 runner 自带 PostgreSQL 服务。PG 为 PostgreSQL 18.6 容器，不能误以为 runner 自带 PG16 是本测试数据库。
- 新三个集成脚本单个 child 上限均为 1200000 ms；容器和本机 TLS 服务具有既有 finally/ownership 清理。没有在本次审查中拉镜像或测 Linux 运行，镜像可用性、冷拉取、真实 runner Chrome/Playwright 组合仍由 CI 证明。

**非阻断改善建议：**下一次优化 CI 时，可在依赖安装后启动一次同样 `channel:"chrome", headless:true` 并输出浏览器版本，快速暴露镜像漂移，避免到长流程末尾才发现问题。若改到精简或自托管 runner，再显式安装 Chrome 及系统依赖。新增步骤必须同步严格的 `check-ci.mjs` 预期；本轮无需为已有官方 runner 重复安装所有 Playwright 浏览器。

## 3. 新增脚本入口不会向真实邮箱发信

审查了本轮所有新增 worker/persistence 脚本入口及其新增 provider 测试调用路径：

| 文件/入口 | 发送或网络边界 |
| --- | --- |
| `notification-integration.mjs` | CLI 强制建立本地 ephemeral S3/PG，调用 `verifyOrderNotifications` 时显式传入 `createPersistentNotificationGatewayHarness`，默认运行真实 TEST Worker helper。没有从环境选择 LIVE 邮件供应商。 |
| `notification-fixture.mjs` | 可复用入口只使用调用方传入的 transport；其默认替身只做内存结果。根 CI 使用上一行的本地 TLS factory。联系邮箱由 TEST checkout 流程生成，令牌/正文仅瞬态持有。 |
| `notification-worker-fixture.mjs` | `prepareNotifications` 显式注入 TEST Application/KMS/templates；`transportForKey` 只匹配本地 gateway 的不可变 key。真实 pg-boss/Outbox 调用到同一本地 transport，无法因宿主环境 LIVE 配置改走真实邮箱。 |
| `notification-gateway-harness.mjs` | 要求 DB host 为 loopback；TEST profile；可信 fetcher 先精确比较 origin，再把 HTTPS 请求钉在 127.0.0.1 和本地端口，显式验证自有 CA。没有 DNS 外发绕路。 |
| `notification-gateway-receiver.mjs` | 独立本机 TLS 子进程。严格验证 TEST/profile/key/认证；唯一“接受发送”效果是在独立 TEST PG schema 保存幂等 key、hash、receipt、retention。没有 SMTP、邮件供应商 SDK、转发 HTTP 或真正投递代码；不持久化 recipient、HTML 或 token。 |
| `notification-link-browser.mjs` | 校验真实邮件 HTML/text CTA 一致且为测试 Storefront origin；真实 Chrome 点击测试页面，通过本机 TEST API 查单。邮件 DOM 只在内存，点击前不开截图/trace/console capture；截图在受保护订单页完成。该 helper 本身不发送邮件。 |
| `commerce-expiry-action-probe.mjs` / `commerce-expiry-fixture.mjs` | 通过 owned S3/PG/order-access/payment TEST fixture 验证到期与支付竞态；没有构建邮件 transport 或外部邮件发件路径。 |
| `notification-gateway-harness.test.mjs` | 仅创建上述本地 PG/TLS receiver 并验证 receipt；可选报告环境变量只选择安全报告输出路径。 |
| `notification-link-browser.test.mjs` | 仅解析示例 TEST CTA 和验证错误链接在服务启动前被拒绝。 |
| `gateway.test.ts` / `gateway.tls.test.ts` | 前者注入 mock fetcher；后者注入自有 loopback TLS fetcher，所谓 side effect 为内存 receipt。redirect 用例不跟随外部地址。 |

关键源码依据：[固定 loopback fetcher](/Users/mario/Desktop/下单/apps/worker/scripts/notification-gateway-harness.mjs:43)、[TEST profile](/Users/mario/Desktop/下单/apps/worker/scripts/notification-gateway-harness.mjs:100)、[receipt-only 接受事务](/Users/mario/Desktop/下单/apps/worker/scripts/notification-gateway-receiver.mjs:38)、[Worker transport 注入](/Users/mario/Desktop/下单/apps/worker/scripts/notification-worker-fixture.mjs:51)、[CLI 实际 factory 选择](/Users/mario/Desktop/下单/packages/persistence-postgres/scripts/notification-integration.mjs:162)。

上述 ACCEPT 仅覆盖受审测试入口的发信边界。生产 gateway adapter 是真实 HTTP 适配器，部署时仍需正确配置真实供应商并另行证明其原子去重/截止承诺和实际邮件投递；本轮本地 receiver 证据不能被表述为真实外部邮箱已收信。

## 4. 证据范围与未完成门禁

本次 P4-06 第一条完整 `pnpm check` 已实际 exit 1，`check-full-result.json` 记录 25.097 秒；日志具体为旧参数 AST 检查器求值新 SQL 模板时 `ReferenceError: restoresNonterminal is not defined`。它不是 Chrome/TLS 启动失败，也不是完整回归通过。root 已安排负责 agent 修检查器，再冻结重新运行；本审查没有将之前单项 PASS 或 P4-05 完整 PASS 冒充修复后的最终门禁。

最终仍由 root 核对：新冻结输入指纹、原单条完整检查 exit 0、各真实夹具新结果、Ubuntu CI 的实际执行与耗时。此报告只是当前 CI 配置与新增脚本的独立只读审查结论。

## Addendum：干净构建前置依赖复核与修复

后续只读复核发现，`notification-link-browser.mjs:16` 顶层导入 `packages/ui/dist/format-minor-amount.js`，原独立 `test:postgres:notifications` 只构建 API/Worker，不能保证该产物存在。根 `pnpm check` 前序 `test:postgres:admin-workspace` 等明确构建 UI，能覆盖这一点，但不能代替独立命令的构建前置。另一个必须补齐的依赖是 Storefront `layout.tsx`、`design-foundations.ts`、`route-states.tsx` 使用的 `@fan-support/design-tokens` JS export；它指向 dist，不在 API/Worker/UI 构建闭包。Next harness 直接执行 `next build`，没有先构建 workspace 包，tsconfig/next.config 也没有把这些 export 改为源文件。此前本报告没有覆盖这两个干净产物前提，此补充更正该遗漏。

只读扫描 49 个脚本组成的静态本地 import 图，发现 19 个 dist 目标：API、Worker、PG、i18n、KMS、notification-provider、observability 的目标都在既有构建闭包内；脚本顶层唯一缺项是 UI。再审 Storefront 编译依赖发现上述 design-tokens 缺项。没有要求改变 commerce-expiry 入口或产品实现。

root 已将同一 `packages/persistence-postgres/package.json` 通知脚本的前置构建增加 `--filter @fan-support/storefront^...`，构建 Storefront 的全部依赖，并排除尚未注入 TEST 配置的 Storefront app 本身。实际读取 `notification-build-prerequisites-2.json` / `-2-result.json`：Turbo dry-run 28 项包含 `@fan-support/ui#build`、`@fan-support/design-tokens#build`，不含 `@fan-support/storefront#build`，exit 0。比第一版仅补 UI 的 27 项前置完整；第一版 JSON 是过程证据，不能作为最终闭包。

第三轮完整检查开始后，上述 package script 曾修订，但当时尚未执行 notifications 命令；按 root 调度，它会在之后读取最终脚本。此次只改该构建前置，没有产品源修改。root 的最终冻结-2 指纹为 `fdfeb7436391fd492f5484f0cd1b769755ee8f6f27a4b5b1e372f061de26db91`；本报告不宣称该轮全程零源漂移，也不把 dry-run 当成实际冷构建通过。最终仍需完整检查的实际结果和范围说明。修订后的构建前置源码范围 ACCEPT；本 agent 到此停止源码检查与修改。
