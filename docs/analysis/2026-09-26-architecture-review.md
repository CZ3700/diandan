# 下单项目（Fan Support Platform）架构审查报告

> 日期：2026-09-26
> 审查范围：`下单/` 仓库全部受控文件、git 历史与未跟踪产物（只读审查，未改动任何既有文件）
> 方法：治理文档通读 + 6 路并行代码深读（领域核心、数据层、API、前端、Worker/适配器、工程基础设施）+ 对高危结论逐条亲自复核（见附录）

---

## 0. 结论先行

1. **业务功能在本地 TEST 环境基本完整**：浏览偶像 → 选礼物 → 私密留言 → 购物车 → 自研结账 → TEST 支付 → 安全查单 → 后台审核/准备/送达/退款/对账/支付配置/异常处理，都已实现，也经过了真实 PostgreSQL 和浏览器验证。安全基础做得扎实。
2. **"本地能跑"和"能上线"之间，有一层生产接线没打通**：
   - 生产入口 `apps/api/src/main.ts` 只接了匿名浏览、购物车和查单链路。
   - 支付、webhook、管理后台在生产配置下都不可用。
   - 你本地体验到的完整系统，其实是由测试脚本 `apps/api/scripts/local-experience-runtime.mjs` 用 `createTest*` / `createLocal*` 组装出来的。
3. **架构是"六边形外壳 + 数据库内核"**：
   - 包之间的依赖方向是干净的。
   - 但真正生效的业务规则在 **199 张表、723 个触发器、271 个 PL/pgSQL 函数**里。
   - domain 层的订单/支付状态机在生产代码里**调用方为 0**。
4. **工程投入明显偏向"生产证据"而不是"交付产品"**：
   - 全仓代码中只有 **36.5%** 是生产代码，30% 是未做类型检查的 `.mjs` 验证脚本。
   - git 里 70% 的文件是证据产物。
   - 完整门禁耗时从 3 分钟涨到 36 分钟。
5. **最紧迫的风险不在代码**：**66 个提交从未推送**，远端最后一次同步停在 09-04。这些工作目前唯一的副本就在这台机器上。

---

## 1. 项目是什么

**产品**：面向全球粉丝的精品偶像礼物商城。
- 游客无需注册即可为指定偶像购买礼物并附私密留言。
- 平台工作室负责采购、准备，并把礼物交付给偶像。
- 七语言：`en`（默认）/ `zh-CN` / `th` / `vi` / `ja` / `es` / `pt`。
- 首发区域为美洲。
- 明确不做：社区、榜单、积分、众筹、偶像入驻、分账、原生 App。

**技术栈**

| 层 | 选型 |
|:--|:--|
| 仓库 | pnpm 11 workspace + Turborepo，Node 24.20，TypeScript 6（strict 全开） |
| 前台 / 后台 | 两个独立的 Next.js 16 App Router 应用（自托管） |
| API / Worker | Fastify（NestJS 只作为外壳），PostgreSQL 18，pg-boss 12 队列 |
| 数据 | 37 个手写 SQL 迁移；Drizzle 仅少量使用 |
| 合同 | Zod 4，并生成 JSON Schema 与 OpenAPI |
| 适配器 | S3 媒体 + sharp；AWS KMS 信封加密；OIDC（openid-client）；CloudFront 缓存清除 |
| 部署 | Docker（4 个镜像）+ Compose preview；OpenTofu 编排 AWS（ECS Fargate / RDS / CloudFront / WAF） |

**开发历史**
- 22 天（09-02 至 09-24），182 个提交。
- 几乎全部由原开发者在 Mac 上用 Codex 代理完成，分支名都是 `codex/*`。
- 开发流程是自建的 Phase / Task / Lane 治理体系：49 个任务，31 个 DONE、10 个 IN_PROGRESS、1 个 READY、7 个 PENDING。
- 当前处于 Phase 6（加固），Phase 7（上线）尚未开始。

**当前环境注意**
- 仓库是从 macOS 打包来的：上层目录有 `__MACOSX`，根目录有 `.DS_Store`。
- 3 个 git worktree 指向 `/Users/mario/...`，已失效。
- 本地体验脚本里硬编码了 macOS 路径，例如 `scripts/local-experience-browser-launcher.mjs:24-27`。**在这台 Windows 机器上尚未验证能否运行。**

---

## 2. 规模与构成

**全仓代码（ts / tsx / mjs / css，不含 SQL 与生成的 JSON）：约 48.8 万行**

| 类别 | 行数 | 占比 |
|:--|--:|--:|
| 生产运行时代码 | 178,066 | 36.5% |
| 验收 / 浏览器 / 门禁脚本（`.mjs`，**不做类型检查**） | 148,145 | 30.3% |
| 单元 / 集成测试 | 149,600 | 30.6% |
| 测试支撑 / fake | 8,115 | 1.7% |
| 生成产物 | 4,440 | 0.9% |

这 17.8 万行"生产代码"里还包含一些**实际不上线的部分**：
- 前台样张页约 6.9k 行
- 后台 `/advanced` 旧严格流程约 6.5k 行
- domain 层无调用模块约 900 行
- apps/api 里只能被测试组合触达的约 4.8k 行

**按模块看**

| 模块 | 真实生产代码 | 其余 |
|:--|:--|:--|
| apps/api | **仅约 9,880 行 TS** | 348 个 `.mjs` 验收脚本共 8 万行，外加 14k 行测试 |
| persistence-postgres | 37.9k 行 | 41.8k 行真库集成脚本，外加 18.5k 行测试 |
| contracts | 33k 行 src | 生成产物 `contracts.schema.json` **51.5MB**，`openapi.json` 8MB，均入库 |
| database | 37 个迁移（up + down） | `expected-catalog.json` 2.8MB（catalog 快照，CI 用来比对） |
| pricing / inventory / orders / payment-routing | **各 1 行** | 空壳包，只为通过目录结构检查 |

**仓库体积**
- 受控文件共 9,938 个，其中 `output/` 占 6,928 个（1.0 GiB）。
- 另有 **8,457 个未跟踪的证据文件，共 5.5 GiB**。
- `.git` 共 1.97 GiB，其中 1.08 GiB **只被**一个 Codex 检查点 ref（`refs/codex/turn-diffs/...`）引用。
- 代码和文档的全部历史压缩后只有约 21 MiB。

---

## 3. 架构全景：规范声称 vs 实际

| 维度 | 规范 / 文档声称 | 实际情况 |
|:--|:--|:--|
| API 形态 | NestJS + Fastify 模块化单体 | `AppModule` 只挂了 `/healthz`。业务全是手写的 Fastify 路由，通过工厂函数手工注入依赖；72 个文件平铺在一个目录里 |
| 分层 | Route → Application → Domain → Port → Adapter | 包依赖方向确实干净。但**真正执行状态迁移的是 adapter 里的 SQL 和数据库触发器**；domain 状态机生产调用为 0 |
| 业务规则位置 | Domain 承载规则 | 同一条规则存在三份：contracts 的 364 处 `refine`、domain、SQL/触发器，**已经出现不一致**（见 5.C） |
| 数据访问 | Drizzle query layer + 显式 SQL 迁移 | Drizzle 只映射了 9 张表；其余是 319 处手写 SQL 字符串，最长的单行有 1,769 个字符 |
| 真相源 | PostgreSQL 是唯一业务真相源 | **属实**，并且被强化到了极致 |
| 异步 | Outbox + pg-boss，不用 Redis | **属实**：至少一次投递，配合幂等回执和死信队列 |
| 支付 | 适配器化，可接多个 PSP | 端口设计是好的，但**没有接任何真实 PSP**；`payment-gateway` 是项目自定义的协议，生产环境也没有注册 provider |
| 缓存 | CDN `s-maxage ≤ 60`、ETag、精确清除 | **123 个页面全部 `force-dynamic`**，所有 fetch 都是 `no-store`，边缘层默认 `private, no-store` |
| 可观测 | OpenTelemetry | 只用来生成 traceId，`spanProcessors: []`，**没有配置任何导出器**，也没有 metrics |
| 目标目录 | pricing / inventory / orders 等包各司其职 | 这几个是空壳，逻辑分散在 domain 和 persistence-postgres 里 |

---

## 4. 做得好的地方（应当保留的资产）

- **支付 Saga 设计**：两段事务，外部调用不包在事务里。UNKNOWN 状态不重扣款、不换通道，provider 与 attempt 绑定。这符合行业最佳实践。
- **Webhook**：用原始 body 做 HMAC 校验，比较用 `timingSafeEqual`；最多 3 把密钥轮换；和 inbox 同事务入队；按事件 ID 去重。
- **加密**：KMS 信封加密。每次加密取新的数据密钥；AES-256-GCM 配随机 96 位 IV；AAD 绑定用途和主体。私密留言、邮箱、显示名都只存密文。
- **查单**：token 放在 URL fragment 里，水合前就用 `replaceState` 清除，一次性交换成 `__Host-` HttpOnly、SameSite=Strict 的会话。
- **管理端身份**：OIDC 使用 PKCE、nonce 和 RS256；强制 MFA；会话可撤销；有 CSRF 防护；角色存在平台数据库里。
- **输入输出校验**：请求和响应都用 Zod 校验。日志是严格的 allowlist，不会泄露 PII。SQL 全部参数化。
- **媒体管线**：同时校验文件头和 sharp 实际识别出的格式；重新编码时去掉 EXIF；内容寻址去重；预签名直传时把校验和也签进去。
- **容器**：基础镜像按 digest 固定，非 root 运行，带健康检查，4 个镜像分目标构建。
- **TypeScript 配置**：`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 等严格项全开。

结论：**安全和交易正确性的"骨架"质量很高**。问题集中在四个方面：生产接线、复杂度、运维就绪度、工程流程成本。

---

## 5. 问题清单（按严重度分级）

### A. 立即风险（数据与仓库安全）

| # | 问题 | 证据 | 建议 |
|:--|:--|:--|:--|
| A1 | **66 个提交从未推送**。远端最后同步是 09-04（P2-03），此后 P2-04 到 P6-04 的全部工作只存在于本机 | `git rev-list --branches --not --remotes` 输出 66 | 尽快备份或推送。分支可达的最大文件为 51.5MB，低于 GitHub 100MB 硬上限，可以推送（会有警告）。**项目自己的 SKILL.md:171 禁止 push，和你的全局守则冲突，需要你裁决** |
| A2 | 远端 CI 自 09-04 起没再运行过 | `phase-6-hardening.md:77` | 推送后第一时间跑一次 CI，看真实红绿 |
| A3 | `.gitignore` 没有 `*.pem`、`*.key`、`*.p12` 规则；也没有忽略 `output/` | `.gitignore` | 补上凭证类忽略规则（改动低风险） |

### B. 上线阻断（生产路径未打通）

| # | 问题 | 证据 |
|:--|:--|:--|
| B1 | **生产 API 入口只接了匿名商城链路**。admin 全部路由和 SEO 路由都没有在生产注册。完整接线只存在于 `.mjs` 测试脚本里 | `production-application.ts:92-107`；`local-experience-runtime.mjs:7-30` 引入的是 `createTest*` / `createLocal*` |
| B2 | **支付在生产环境静默禁用**：没有传入 provider 时直接 `return undefined`，即使配置了支付环境变量也不报错 | `production-application.ts:84-87` → `payment-runtime-composition.ts:315` |
| B3 | **生产 webhook 必然返回 503**：验签器默认为空。这个端点对公网开放，每个请求都会查一次数据库 | `reliable-events-composition.ts:176-177` |
| B4 | **管理后台在非 development 环境只能是 DISABLED**，页面直接 404 | `packages/config/src/server-config.ts:800-821` |
| B5 | **没有真实 PSP、没有真实邮件服务**：`payment-gateway` 和通知模块都是自定义协议的网关，只有 TEST 实现 | `docs/operations/payment-connectors.md:3,13` |
| B6 | **生产环境文案加载会抛错**：14 份 i18n 审校清单全是 DRAFT，而生产要求 APPROVED。这是规范有意设计的"未批准即阻断"，但闸门放在**运行时**而不是构建期，结果是镜像能部署、上线即全站报错 | `packages/i18n/src/storefront/messages.ts:81-87`；`apps/storefront/src/server/storefront-copy.ts:10` |
| B7 | **零缓存**：123 个页面 `force-dynamic`，全部 `no-store`，边缘层默认 `private, no-store`，违反规范 §16.2。页面导航也没用 next/link，实际是多页应用；每次跳转都重新拉取数据和图片 | `apps/storefront/src/app/(public)/**/page.tsx`；`infra/opentofu/modules/edge/main.tf:170-181` |
| B8 | **CSP 大面积缺失**：首页、偶像、礼物、购物车页没有 CSP，订单页是 `'unsafe-inline'`，后台只有 frame-ancestors | `apps/storefront/src/proxy.ts:14-28`（P6-04 自己也记为待办） |
| B9 | **可观测性不可用于生产**：<br>• OTel 没有导出器，`/healthz` 恒返回 ok<br>• Worker 的 `order_payment.review_required` 事件不在日志 allowlist 里，会被改写成 `observability.invalid_event`，错误码被丢弃，"支付需人工复核"的**主动告警信号丢失**（后台异常中心仍能看到） | `packages/observability/src/logging.ts:12-26,226-228`；`apps/worker/src/reliable-events-composition.ts:325` |
| B10 | **基础设施从未真实部署**：OpenTofu 只跑过 mock provider 的离线计划；CI 里没有镜像构建、推送和部署流水线 | `docs/runbooks/infrastructure-offline.md` |

### C. 架构与正确性风险

| # | 问题 | 严重度 | 证据 |
|:--|:--|:--|:--|
| C1 | **业务规则三份实现，domain 被旁路**。domain 的通用订单状态机写着 `CANCELED: []`，**缺少规范 §12.2 要求的迟到收款 CANCELED→OPEN**；数据库（`0035:93`）与规范一致。domain 的 90% 分支覆盖率门禁保护的是不上生产的代码，给人虚假的安全感 | 高（维护性） | `packages/domain/src/order-state-machine.ts:53`；全仓非测试代码中 `decideOrderLifecycle*` / `selectEffectivePrice` 调用为 0 |
| C2 | **库存锁升级死锁 + 全局热点**：同一事务里先 `FOR SHARE` 再 `FOR UPDATE` 同一行 `inventory_locations`，并发结账会死锁。所有结账在同一库存地点上串行；应用层只做 3 次无退避重试 | 中高（高并发时） | `checkout-preflight-current.ts:174`；`inventory-repository.ts:161` |
| C3 | 数据库复杂度远超 MVP：199 张表，其中 26 张翻译表、29 张 receipts 表；723 个触发器；3 套 outbox；两代发布机制并存 | 高（长期成本） | `database/migrations/*.up.sql` |
| C4 | 缺索引：611 个外键里有 369 个没有前导索引，例如 `inventory_reservations.locked_order_id`、`fulfillments.order_id` | 中 | 数据层审查 |
| C5 | Outbox 扫描成本线性增长：只追加、不归档，每次轮询用 NOT EXISTS 扫全表；另有 2 张 outbox 表只写不读 | 中 | `reliable-event-repositories.ts:1408-1421`；`0025:66-78` |
| C6 | Worker 维护循环串行单飞：通知逐封同步发送（每轮最多 200 封，单封最长 10 秒），期间支付入账和过期回收全部停摆 | 中 | `reliable-events-runtime.ts:205-260` |
| C7 | 连接与超时失控：每个 API 进程有 7 个独立 pg Pool；`connectionTimeoutMillis` 为 0；没有 `statement_timeout` / `lock_timeout`；连接池上限不可配置 | 中 | `persistence-postgres/src/connection-config.ts:44-56,296` |
| C8 | 数据库没有最小权限：运行时和迁移共用一个账号，没有 GRANT、角色或 RLS；"只追加"只靠触发器保证，而拥有者可以关闭触发器 | 中（安全） | `infra/compose.preview.yml:7,113` |
| C9 | 查单限流键是 `socket.remoteAddress`（有意不信任代理头），部署在 ALB 后面时，所有用户共享一个限流桶 | 中 | `apps/api/src/order-access-route.ts:151-152` |
| C10 | KMS 调用放大：每个购物车/支付/订单请求都要对每个密钥版本调用 `GenerateMac`，没有缓存，KMS client 也没有设超时 | 中（成本/可用性） | `cart-session-credentials.ts:235-243` |
| C11 | contracts 产物膨胀：用 `reused:"inline"` 展开共享 schema，单个根最大 1.4MB；708 个根里 501 个是 internal；11 个 legacy 根只为生成产物而存在 | 中 | `packages/contracts/src/artifact-documents.ts:171` |
| C12 | 横切代码大量复制粘贴：8 个 `*-idempotency.ts` 用了 3 种请求哈希规范化方式；重试循环至少 4 份；请求头解析 9 份；`privacy()` 16 份 | 低中 | 领域层 / API 审查 |
| C13 | 死代码：4 个空壳包；前台样张约 6.9k 行（其中 `motion.css` 被全局引入公开页却从未使用）；后台 `/advanced` 约 6.5k 行（界面无入口，但可直接访问）；前台根路由 `page.tsx` 永远走不到 | 低 | 前端 / 领域层审查 |

### D. 工程效率与流程负担

| # | 问题 | 证据 |
|:--|:--|:--|
| D1 | **证据入库形成自我强化的膨胀**：`check:ui-composites` 和 `check:ui-motion` 会校验已入库证据里的源码指纹。源码一改门禁就变红，只能重跑浏览器、再把新证据入库。单个提交 e65c9ffd 插入 372 万行，其中 99.8% 是证据 | `scripts/check-ui-composites.mjs:24,766-781` |
| D2 | **门禁越来越慢且不稳定**：完整 `check` 从 175 秒涨到 2,144 秒，出现 exit 1 和间歇性超时（根因记为 UNKNOWN）。P5/P6 已不再整条跑，改为"分段覆盖" | `phase-4-commerce.md:274`；`phase-5-operations-payments.md:79` |
| D3 | 14.8 万行验证脚本**没有类型检查**，其中有手写 PNG 解析、用正则解析 git 输出，还有 69 条 AST 形状断言（等于把实现写了两遍） | `scripts/verify-ui-motion-browser.mjs`（5,383 行）；`scripts/check-ui-interactions.mjs` |
| D4 | **治理文档人已经读不动**：MASTER.md 80KB，单行最长 2,060 字；各 phase 卡合计 581KB；大量篇幅在声明"不声称什么"。文档之间已经漂移，例如 `current-overview.md` 停在 09-17 | `docs/progress/*` |
| D5 | 状态语义混乱：10 个 IN_PROGRESS 没有一个在真正执行，都是"本地已验收、在等外部条件"；BLOCKED 一直是 0 | `MASTER.md` |
| D6 | 提交粒度过粗：P2-04 之后基本是一个任务一个巨型提交，36 个提交各改动超过 100 个文件 | git 历史 |

---

## 6. 离上线的真实距离

**工程侧，需要写代码：**
1. 生产组合根：把 `local-experience-runtime.mjs` 里的完整接线，改写成类型化的 `src` 生产组合，同时去掉 Test 组合对生产 dist 的污染（B1–B4）。
2. 首个真实 PSP 适配器，外加凭证解析器、webhook 端点接线、conformance 测试和 sandbox 联调（B2、B3、B5）。
3. 真实邮件服务适配器（B5）。
4. 缓存策略与 CSP（B7、B8）。
5. 可观测性：配置 OTel 导出、补齐日志事件枚举、让健康检查反映真实依赖状态、配置告警（B9）。
6. 部署流水线与真实 staging 的 plan/apply（B10）。
7. 并发与数据库运维修复（C2、C4、C5、C6、C7）。
8. 把 i18n 审校闸门前移到构建期（B6）。

**外部侧，需要你或业务方决策（MASTER.md 里全部是 OPEN）：**
- 品牌、Logo、字体和摄影授权
- 经营主体、KYC 和收款账户
- 首发国家、币种和支付方式
- 选定哪家 PSP，以及商户和 sandbox 账号
- 管理员身份源和 MFA
- 法律、税务和退款政策
- 履约 SLA 和客服承诺
- 邮件、观测和备份供应商
- 七语言关键文案的人工译审
- 真人读屏和真机验收

**判断**：按原计划推进，P6-05 / P6-06 仍会继续产出"本地证据"，但对以上两类缺口几乎没有推进。**项目真正的瓶颈已经从"写功能"变成了"打通生产路径"和"拿到外部决策"。**

---

## 7. 需要你拍板的决策

1. **备份和推送**（最紧急）：
   - 选项 a：直接推送全部本地分支。可行，约 0.5 GiB，会有 50MB 文件警告。
   - 选项 b：先做一份外部备份（例如 `git bundle`），再决定推送策略。
   - 这涉及对外操作，也和项目 SKILL.md 的"禁止 push"相冲突，需要你明确授权。
2. **是否沿用 Codex 那套治理流程**：Phase/Lane、证据入库、S.U.P.E.R 十项检查、非作者复核。
   - 我的建议是**大幅简化**：保留合同先行、测试先行和真实集成测试；停止把证据提交进 git，改用 CI artifact；拆出 `LOCAL_ACCEPTED` 和 `BLOCKED_EXTERNAL` 两个状态；把门禁控制在 10 分钟以内。
3. **下一阶段的主线**：
   - 我建议暂停 P6-05 / P6-06 的本地证据工作，转向"**生产路径打通**"（第 6 节工程侧第 1、4、5、7、8 项）。这几项不依赖任何外部决策，现在就能做。
   - PSP 和邮件服务等你选定供应商后再接。
4. **业务规则的真相源定在哪里**：
   - 我建议**承认数据库就是规则的真相源**，删除 domain 里那些没有被调用的状态机和对应的虚假覆盖率门禁。
   - 不做大规模重写：把规则搬回 TS 的收益，远小于风险。
5. **仓库瘦身**：删除 Codex 检查点 ref 后执行 gc；把 `output/` 移出 git；执行 `git worktree prune`。这些都是**不可逆操作**，需要你单独确认，并且必须在备份之后做。

---

## 附录：核实说明

以下高危结论由审查者**亲自读代码或运行命令核实**：

- A1 未推送提交数 66
- 最大文件 51.5MB
- 3 个 worktree 指向 `/Users/mario`
- B1 生产组合根的内容，以及 local-experience 使用 `createTest*`
- B2 支付组合在无 provider 时 `return undefined`
- B4 管理后台模式闸门
- B6 i18n 全部 DRAFT，且生产开启 `requireApproved`
- B7 123 个 `force-dynamic`
- B9 日志 allowlist 会改写未知事件
- C1 domain 状态机缺 CANCELED→OPEN，且生产调用为 0
- C2 两处锁语句
- C9 限流键
- 第 2 节代码分类统计

其余条目来自 6 路并行审查，均附有文件和行号证据，但没有逐条二次复核。数据库计数（表、触发器、函数）来自对迁移 SQL 的统计。

C2 的"同一事务内锁升级"依据的是审查报告中的调用链，**尚未通过并发测试复现**。
