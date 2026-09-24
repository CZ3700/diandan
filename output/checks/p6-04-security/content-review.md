# P6-04 内容、出口与 RUM 安全复核

日期：2026-09-24。复核者：`security_content_review`（P6-04 root 的受托子项，不是新 Lane executor）。基线：`e65c9ffde4e9651c7c3b6e86df6426db05fbf410`。本报告区分已证实问题、已有控制、未被本轮运行证据覆盖的范围。

## 结论

- **确认 1 个 Medium 缺陷：匿名 RUM 双合法记录可令旧聚合整窗失败。** 已依授权加入 v2 隔离聚合、版本化合同和 CLI 展示，定向测试通过；完整生成合同对照、工作区门禁和非作者复核由 root 汇总。
- 3 个 Semgrep 前台 HTML sink、8 个 Fastify `reply.send` 命中均有可追溯控制，不构成本次已证实 XSS。未在已审查链路证实 SSRF、公共 DTO 私密内容泄漏或 fragment 持久化。
- **CSP 是残余防御缺口，不是本轮证实的 XSS 利用链。** 公开页面缺少统一脚本限制；管理端只有 frame-ancestors；敏感页面的部分策略也不能防御任意 inline script。记录为 Low / defense gap，不据此报 High。
- 本轮只运行内存 Request、Fastify.inject、源码单测和本地 CLI；没有启动 PG、Chrome、S3/PSP/OIDC 实体服务，没有触碰受保护持久实例，也没有外部扫描。公网访问仅官方参考资料。

## RUM-01：两条合法匿名测量使整窗报告不可用（Medium，已修复待独立验收）

**前提与入口。** RUM 已启用，攻击者可以向公开 intake 发 POST。`apps/storefront/src/server/rum-intake.ts:92` 检查 configured Origin 和 sec-fetch-site，它们是浏览器跨站控制，不能认证非浏览器发送者；`122` 校验单记录 schema 后在 `147` 返回 204。`measurementKey` 和 revision 由发送者提供。攻击者使用自己的合法 UUID，不必知道正常记录的 key，也不必改变配置或访问日志。

**缺陷位置。** `packages/observability/src/rum.ts:74` 的同 key/revision 异值分支及 `79` 的身份冲突分支抛出异常。旧 CLI 在写入任何输出前调用旧聚合，所以这两条记录会让同窗所有正常分组的报告也无法生成。影响是监测可用性和验收可信度，不是支付/订单业务状态、机密性或任意代码执行。

**最小复现。** 先投递一个独立 key 的合法 INP 1000，再用另一个合法 key、revision=1 投递 INP 120 和 121，其他 context 相同。真实 intake Request→schema sink 返回 `[204,204,204]`；正常记录单独可聚合，三条合并报 `Conflicting RUM measurement`。`content-review-tmp/rum-conflict.test.ts` 保留此历史 v1 复现；`reproduction-result.json` 记录无网络、仅合成数据。原 CLI 的 exit 1 日志为 `cli-reproduction.log.txt`，合成输入为 `synthetic-rum.log.txt`。原 `.log` 原件保留，交付审计使用 `.log.txt`。

**真实 RED。** 新预期是整窗还能输出正常 key，不能只写一个期望 throw 的测试。`rum-aggregate-red-3.log.txt` 记录 11 测试中 9 失败；`rum-contract-red.log.txt` 记录新合同缺失；`rum-cli-red.log.txt` 的真实子进程预期 exit 0，旧实现实际 exit 1。早期工具启动失败日志单独保留，不算 RED 证据。

**修复与完整性边界。** `packages/observability/src/rum.ts:145` 新增 `aggregateRumV2`，检查窗口内同 key 的身份和值冲突，隔离该 key 的全部窗口内 revision，保留独立 key 的 p75。报告只含隔离 key 数、隔离记录数和接受记录数，不输出 UUID。窗口及所有实际报告行强制 `DEGRADED`，不能给 `WITHIN_BUDGET`；mode、automation、samplePermille 保持原值，local 不变 field。重复同值、乱序旧 revision、窗口 `[start,end)`、最近秩 p75 和样本门沿用原逻辑。schema 损坏、声明为 RUM 的损坏日志、文件/字节/记录边界仍拒绝。

`packages/contracts/src/rum-report-v2.ts:5` 定义 version 2，校验计数和状态一致。旧 v1 schema 和旧聚合保留；`rum-v1-source-compatibility.json` 验证移除新增 factory import/末尾导出后旧 RUM 合同全文与基线一致，旧 `aggregateRum` 函数正文也相同。共享 artifact registry 和 generated 全定义值比较由 root 执行，不能用源码比较替代它。

`scripts/render-rum-dashboard.mjs:108` CLI 使用 v2，展示明确隔离状态。对原合成输入重放，`cli-repaired.log.txt` 为 exit 0、`integrity=DEGRADED`、`fieldAcceptance=false`；`repaired-dashboard/rum-report.json` 保留 1 个正常观测、隔离 1 key / 2 records，模式仍 local，p75=1000、assessment=DEGRADED。CLI 的 exit 0 仅表示成功生成报告，不是整体验收 PASS。匿名非冲突伪造、分布式耗尽 intake 容量等仍不能靠该聚合证明是真实用户，runbook 明确此边界。

## CSP 实际层级与残余缺口

| 层级 | 代码证据与行为 | 判断 |
| --- | --- | --- |
| Storefront 普通公开页 | `apps/storefront/src/proxy.ts:21` 对非敏感路径提前返回，不设置 CSP | 没有统一的应用级脚本执行限制 |
| Checkout / order API | 同文件 `49`：frame-ancestors none、受配置约束的 frame-src、object-src none、base-uri self、form-action self | 有 framing/嵌入/表单边界；一般 checkout 分支没有 script-src |
| Order HTML | 同文件 `51`：script-src self unsafe-inline、connect-src self，再加上述限制 | 任意 inline script 不会被这条策略阻止；尚无注入前提被证实 |
| Admin | `apps/admin/src/proxy.ts:22`：no-store、no-referrer、nosniff，CSP 仅 frame-ancestors none | 防点击劫持，不约束脚本执行 |
| CDN IaC | `infra/opentofu/modules/edge/main.tf:170`：private response headers 加 no-store/no-referrer、nosniff/HSTS；没有 CSP | 仓库部署定义不能补足应用 script-src；未验证已部署响应 |
| 图片优化返回 | `apps/storefront/src/server/image-config.ts:69` attachment + default-src none/script-src none/sandbox | 是图片响应隔离，不能当 HTML 页面 CSP |

建议在后续具备 nonce/hash、Next hydration、PSP 嵌入和七语言实浏览器回归范围的任务内收紧脚本策略。当前没有证明可注入执行的输入，因而此项是 Low 防御缺口，不虚构利用步骤或生产可利用性。

## Semgrep 命中复核与已有内容控制

输入扫描结果：`scans/semgrep-findings-triage-input.json`。以下判断逐点追过校验到输出，不仅按规则 severity 接收。

| 命中 | 校验 / 编码证据 | 结论 |
| --- | --- | --- |
| `apps/storefront/src/storefront/content-safety.tsx:20` | `16` 在 sink 前 parse fullBio；`packages/contracts/src/content-lifecycle.ts:114` 只准平衡、小写、无属性 p/br/strong/em/ul/ol/li，拒绝未知标签和残余 `<`；plain 分支用 React 文本插值 | 受控富文本，sanitization/validation false positive |
| `apps/storefront/src/storefront/gift-content.tsx:67` | `63` 在 sink 前 parse policy body，使用同一受控语法；结构化区块通过 React 文本插值 | false positive |
| `apps/storefront/src/storefront/seo-structured-data.tsx:141` | JSON.stringify 后 `<`、U2028、U2029 编码；闭合 script payload 不保留字面 `<`；type application/ld+json | context encoding false positive |
| `apps/api/src/admin-content-authoring-route.ts:254` | `247` contentAuthoringResponseSchema.parse 返回对象 | JSON response false positive |
| `apps/api/src/admin-content-route.ts:251` | `241` adminContentResponseSchema.parse | JSON response false positive |
| `apps/api/src/admin-content-route.ts:283` | `271` contentPreviewResponseSchema.parse，目标匹配验证 | JSON response false positive |
| `apps/api/src/base-content-route.ts:289` | `276` baseContentResponseSchema.parse，kind/target 检查 | JSON response false positive |
| `apps/api/src/base-content-route.ts:319` | `309` baseContentPreviewResponseSchema.parse，target 检查 | JSON response false positive |
| `apps/api/src/publication-preflight-route.ts:224` | `214` publicationPreflightResponseSchema.parse，action/target 检查 | JSON response false positive |
| `apps/api/src/publication-runtime-route.ts:294` | `285` publicationRuntimeResponseSchema.parse，response 匹配 | JSON response false positive |
| `apps/api/src/resource-management-route.ts:267` | `257` adminResourceResponseSchema.parse，response 匹配 | JSON response false positive |

### 5 个 react-href-var 的实际调用链

`rg` 检查全部非测试 TS/TSX 中 Hero/GiftTile/IdolContext/IdolPortrait 的导入、导出及 JSX 使用，当前 ready 调用只在内部 specimen/demo；不是依据 TS prop 类型认为安全。搜索记录见 `content-review-tmp/href-call-sites.log.txt`。

| sink | 实际输入来源 | 判断 |
| --- | --- | --- |
| `packages/ui/src/gift-tile.tsx:69` | `apps/storefront/src/app/ui-composites-specimen.tsx:264` 固定 `#cart`，`273` 固定 `#catalog` | 固定内部片段，无攻击者可控 scheme，false positive |
| `packages/ui/src/hero.tsx:53` | 同 specimen `212`、`ui-composites-hero-failure-demo.tsx:30`、`ui-composites-hero-transition-demo.tsx:31` 固定 `#catalog`；`ui-motion-lab.tsx:144` 固定 `#idol-motion` | 固定内部片段，false positive |
| `packages/ui/src/idol-context.tsx:59` | specimen `281` / `289` 的 ready 调用均不传 optional href；其他仅 loading/empty/error | 当前该链接分支没有传入值的调用链，false positive |
| `packages/ui/src/idol-context.tsx:73` | specimen `282` 固定 `#catalog`；另一 ready 调用没有 action | 固定内部片段，false positive |
| `packages/ui/src/idol-portrait.tsx:76` | specimen `248` 固定 `#recipient`；另一个 unavailable 不进入 Link 分支 | 固定内部片段，false positive |

这些通用组件的 `href: string` 本身不构成 URL 安全控制，`packages/ui/src/link.tsx` 也只检查非空及 `_blank` rel。结论仅适用于已追溯的当前调用点；后续若接入运营/用户 URL，仍必须走运行时 locale 路径构造或获批准的 HTTPS schema，不能沿用本次固定输入结论。

8 处 API sink 均发送校验后的对象，而非拼接 HTML 字符串；对象由 Fastify 进行 JSON 序列化，符合 [Fastify Reply 文档](https://fastify.dev/docs/latest/Reference/Reply/)。对应 6 文件的 Fastify.inject 测试共 48 项通过，包含失效输入、body 范围、安全失败和敏感内容边界。

管理短表单文本通过 React 插值；`apps/admin/src/workspace/preview.tsx:130` 的 fullBio sink 来自 `241` 的客户端 `baseContentPreviewResponseSchema` 校验。不能因为类型声明本身信任服务端，但这里存在运行时 parse。`sitemap.ts:21` 编码 XML 的 &、<、>、单双引号，`72` application/xml 和 `76` nosniff；模板命中未证实 XML/HTML 注入。RUM dashboard 的序列化数据编码 `<` 与 `&`，表格/摘要使用 textContent，新增完整性摘要只来自有限枚举和数值。HTML sink 的安全依赖语法校验和上下文编码持续存在；参见 [React dangerouslySetInnerHTML 文档](https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html)。

## URL、媒体、HTTP、隐私边界

| 范围 | 已检查控制与限制 |
| --- | --- |
| 公共 URL | `packages/contracts/src/presentation.ts:10` HTTPS 禁 userinfo；`149` 拒绝 localhost / 非公网 IP 字面量（包括 URL 归一化后的变体）。媒体查询参数限尺寸/格式且无签名凭据。固定 localhost:7444 只作明确 TEST preview 例外。schema 不进行 DNS 解析，不能声称它单独防止 DNS rebinding。 |
| Next Image | `image-config.ts:48` localPatterns 空、remotePatterns 为配置 HTTPS origin 的 processed/v1 派生 AVIF/WebP/JPG 路径、无 query；`61` 不重定向、production 不许 local IP、SVG 关闭。无配置即没有远程源。主机名 regex 来源是构建期可信配置，没有发现运行时攻击者控制的 ReDoS 入口。配置行为参考 [Next Image 文档](https://nextjs.org/docs/app/api-reference/components/image)。 |
| S3/CDN / 媒体处理 | `packages/media-s3/src/adapter.ts:323` 对象路径逐段编码、服务配置验证、独立源/派生 storageClass；`packages/media-image/src/storage-transfer.ts:115` 验证 grant 身份并禁止重定向，限大小/哈希/MIME和截止时间；`image-pipeline.ts:112` decode 像素边界、`129` 头部/帧数核验、`183` 解码为去 metadata 的像素后重编码。未发现使用公开内容字段作为任意 worker fetch 目的地。真实对象权限/部署需 S3 集成证据。 |
| PSP | `packages/payment-gateway/src/client.ts:75` 可信连接配置、固定 command path、redirect:error、omit credentials、请求/响应边界；`241` hosted action exact origin allowlist、`279` return origin 检查。浏览器不授予最终支付状态。没有将来源用户 URL 直接作为服务端目的地的链路。 |
| OIDC | `packages/identity-oidc/src/real-oidc.ts:75` 固定 issuer/redirect 配置；`193` 截止时间、`212` 手动重定向并拒绝跳转、`224` 读取上限；后续校验 state/nonce/PKCE、签名、aud、MFA/认证时间。IdP 是配置可信边界；不能把配置端点信任误报为任意用户 SSRF，也不能将其说成 DNS 级 allowlist。 |
| 通知出口 | `packages/notification-provider/src/gateway.ts:99` 固定 path/可信 HTTPS origin，`109` redirect:error，`110` omit，`135` 响应 65536 bytes 上限，截止时间和分类错误。 |
| 日志/错误 | `packages/observability/src/logging.ts:64` strict allowlist，无 request body/cookie/任意错误字符串；`fastify.ts:45` 使用 route template；`safe-error.ts:24` 仅有限 code/requestId。observability 全 56 测试通过。 |
| 私密 DTO / 队列 | `packages/contracts/src/cart-runtime.ts:204` 私密字段要求 ciphertext/加密 key，`340` 公共 item view 只采用允许字段，不含完整 displayName/fanMessage。`reliable-events.ts:372` inbox job 和 `403` outbox dispatch 是 ID/propagation 引用，不把私密留言复制进队列。独立私密编辑响应不能误当公共 DTO；真实数据库加密/权限的完整证明由现有 PG 门禁完成。 |
| Order token fragment | `apps/storefront/src/order-entry.ts:3` 短期闭包，`4` 立即 replaceState 清 query/fragment，`7` 15 秒清除，`8` pagehide 清除、单次读取；`apps/storefront/src/app/layout.tsx:27` 在 order-access 入口关闭 RUM。没有 local/sessionStorage 持久化。对应测试通过；未声称可防御已获得任意同源脚本执行的攻击者。 |

## 本轮命令与证据

统一运行时：`mise exec node@24.20.0 -- node`。直接执行仓库工具，避免 `pnpm exec` 在并行工作区自动触发 install。全部日志在 `content-review-tmp/`。

| 检查 | 结果 / 日志 |
| --- | --- |
| 旧 intake→v1 聚合 + 真实 CLI | 合成 3 条全部 204，旧整窗异常/CLI exit 1；`reproduction-3.log.txt`、`cli-reproduction.log.txt` |
| observability 全测试 | 11 文件 / 56 PASS；`rum-observability-final.log.txt` |
| 合同 RUM v1/v2 | 2 文件 / 3 PASS；`rum-contract-final-2.log.txt` |
| CLI、browser-validator/lifecycle/config 纯工具 | 17 PASS；`rum-tools-final.log.txt`。没有启动浏览器。 |
| content-safety/gift-content/JSON-LD/image-config/RUM-intake/order-entry | 6 文件 / 42 PASS；`content-boundaries-final.log.txt` |
| 上表 8 API sink 对应 route tests | 6 文件 / 48 PASS；`content-json-routes-final.log.txt` |
| 直接 tsc build contracts→observability | exit 0；`contracts-build.log.txt`、`observability-build.log.txt`（root 随后再编译带 registry 的 contracts） |
| contracts/observability typecheck | exit 0；`contracts-typecheck-final.log.txt`、`observability-typecheck-final.log.txt` |
| 最终改动 ESLint / Prettier | exit 0；`rum-lint-final-3.log.txt`、`rum-format-final-2.log.txt` |
| v1 源码兼容性 | 既有 RUM schema 源码及 aggregateRum 正文与基线相同；`rum-v1-source-compatibility.json` |
| 同输入修复后 CLI | exit 0，正常数据保留，DEGRADED，fieldAcceptance false；`cli-repaired.log.txt`、`repaired-dashboard/` |

可重复入口：`node node_modules/vitest/vitest.mjs run --config /Users/mario/Desktop/下单/vitest.config.ts --root <package> <上述测试文件> --maxWorkers=1`；纯工具使用 `node --test scripts/render-rum-dashboard.test.mjs apps/api/scripts/rum-browser.test.mjs apps/api/scripts/rum-browser-lifecycle.test.mjs apps/api/scripts/storefront-test-rum-config.test.mjs`。v1 历史 intake 复现使用临时目录的 `vitest.config.mjs`。

未在此子项执行的集成入口：根 `pnpm test:s3`、`pnpm verify:rum`；API `test:postgres:resource-management`、`test:postgres:publication-runtime`、`test:postgres:cart`、`test:postgres:order-access`。这些是可按修改风险选择的既有入口，不是本轮新增全站重跑门。本轮协调者计划的相关实体回归为 order/finance/exceptions PG 与 fresh 七语言 journey（含真实 S3 上传接线）；未修改模块无需仅因列在审计范围就重跑全部负向集合。任何后续实体运行均使用独占 TEST 运行时，禁止借用受保护用户持久实例。生产 CDN、对象权限、PSP/OIDC 外部环境与 staging/灰度证据不能被本报告替代。

S.U.P.E.R 收尾：范围仅授权的 RUM 模块/合同/CLI/runbook 及 validator schema 适配；无新增依赖、DB/根配置改动；旧 API/版本保留；隔离规则和边界测试可重复；文档说明匿名样本可信度；敏感输出只枚举/计数；实现为单模块有界过滤复用旧 p75；无共享可变全局；无启动/退出副作用；独立复核、全工作区验收、generated 合同全定义比较由 root 汇总，未提前宣称 P6-04 完成。
