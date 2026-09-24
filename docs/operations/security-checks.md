# P6-04 本地安全检查与复验

本入口覆盖本仓库源码及自有、可销毁的 TEST 服务。它不授权扫描第三方或现有用户实例，也不代表正式商户、生产身份服务、云 WAF 或 staging 已验收。扫描报告必须记录源码指纹、工具与规则版本、实际扫描文件数、解析失败、完整退出状态和人工分类；不能把零扫描文件或数据库尚未收录的漏洞解释为零风险。

## 可重复检查

使用仓库固定的 Node 24.20.0、pnpm 11.25.0 和 frozen lockfile。在 `scripts/regression-workspace.mjs` 创建的独立源码副本执行，保持用户原 TEST 数据与私有配置不变。`POSTGRES_TEST_BIN` 可显式指定已有 PostgreSQL 18 运行时；S3 测试使用自有 Docker 容器。真实浏览器门需要 Chrome。

```sh
pnpm install --frozen-lockfile
pnpm security:dependencies
pnpm security:regressions
pnpm security:secrets
pnpm check:dev
pnpm check:contracts
pnpm check:infrastructure --tofu /absolute/path/to/verified/tofu
pnpm test:performance-tools
pnpm --filter @fan-support/api test:postgres:order-access
pnpm verify:admin-access:browser
pnpm --filter @fan-support/api test:postgres:admin-finance
pnpm --filter @fan-support/api test:postgres:admin-exceptions
pnpm verify:rum
pnpm verify:regression --suite journey --output output/checks/security-journey
```

这是一组有明确范围的安全复验，不是原 P6-01 全部五组回归。依赖升级同时影响前台和后台时，最后的实际浏览器旅程验证七语言、390×844 / 1440×900、结账、可信支付证据、独立邮件查单及后台操作；单元测试或模拟的回跳不能代替这些结果。自动测试不代签真人读屏、正式语言审核、真实支付和云端部署。

| 检查 | 必须观察的边界 |
| --- | --- |
| 身份与越权 | OIDC state/nonce/PKCE、一次性 callback、MFA、会话过期及撤权；事务中再次校验权限 |
| CSRF / token | 严格 Origin、HttpOnly / Secure / SameSite cookie、独立 CSRF 和用途隔离的 token 摘要；查单凭据绑定准确订单 |
| 支付与重放 | 原 provider/account、签名/认证证据、金额币种与幂等记录；浏览器跳转不能写最终支付状态 |
| 内容与 SSRF | 富文本标签白名单、JSON-LD 转义、媒体来源与格式约束、外部 HTTP adapter 的地址和重定向边界 |
| 隐私 | canary 不进入公共响应、日志、截图或对象元数据；测试收件箱也保持认证加密 |
| 滥用与依赖 | 差异化 edge 限流声明、依赖审计与官方通告交叉核对、原 secretlint 规则、非零范围的源码静态检查 |

## 本轮修复的回归点

- **Next.js 补丁**：前台、后台、lint plugin 和 lockfile 同步为 16.3.6。`security:dependencies` 同时执行已公布漏洞的版本回归门和 npm audit；CI 使用同一入口。2026-09-24 的 npm feed 未列出下述官方通告，因此不能单凭 audit 的零结果放行。没有发现项目使用 `next/og` / `ImageResponse` 的可达路径，但旧锁定版本属于官方影响范围。
- **RUM 冲突隔离**：新 `RumReportV2` 不修改旧合同。任何同一 measurement key 的身份或同 revision 数值冲突，隔离该 key 在窗口内的全部记录；其余记录继续聚合。报表显示 `DEGRADED` 和数量，不包含原 key，也不给性能预算通过结论。畸形声明数据、超出输入上限仍失败。旧 v1 的拒绝语义保留。
- **TEST 邮件认证标签**：解密显式要求 16 字节 GCM tag。正确历史密文格式保持，截短 tag 和密文字段篡改必须失败。这是本地 TEST 存储的加固，未证明存在远程改写该数据库的路径。
- **差异化限流**：现有 private origin / CloudFront WAF 边界下，按六类操作独立配置，不用订单或支付 UUID 分桶；每个规则的阈值和窗口须显式提供。细节、近似限流语义及 count→block 云验收见 [基础设施 runbook](../runbooks/infrastructure-offline.md)。本地直接连接 TEST API 不经过 WAF，不声称获得云端保护。

## 工具结果与剩余验收

本次证据目录为 `output/checks/p6-04-security/`；最终状态以该目录的 `final-verification.md` 为准。Semgrep OSS 只执行本地官方规则集，不上传源码；ERROR/WARNING 是工具规则级别，必须结合数据流和运行环境判定实际风险。部分解析必须原样披露，误报必须附具体约束和证据。不得降低原秘密扫描规则以通过检查。

正式部署前需要再次审计最新依赖、真实 production composition、WAF 计数/拦截与 PSP 重试兼容、私网不可绕过、运行时镜像，以及正式 IdP/PSP/邮件和完整 staging 核心旅程。未知的未来通告不推断为已经受影响，也不冒称已验证；2026-09-23 的 Next.js 预告指出另有安全版本计划于 9 月 30 日发布，届时或部署前必须重新核对已披露的影响范围与补丁。

官方依据：[Next.js 9 月 22 日安全更新](https://nextjs.org/blog/nextjs-security-update-september-22-2026)、[GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)、[9 月 23 日后续更新预告](https://nextjs.org/blog/upcoming-nextjs-security-release-september-2026)。原范围 `>=16.2.0 <16.3.6`，漏洞条件涉及 Node.js 下受攻击者控制的 `ImageResponse` SVG 输入；预告尚未给出的具体影响范围不能自行补全。
