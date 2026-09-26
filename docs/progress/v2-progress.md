# V2 进度记录

> 方案：[2026-09-26-v2-launch-plan.md](../plan/2026-09-26-v2-launch-plan.md)
> 状态：`DONE`（完整验收）· `LOCAL_ACCEPTED`（本地完成，等外部条件）· `BLOCKED_EXTERNAL`（等外部决策/资源）· `IN_PROGRESS`
> 规则：每条不超过十行；验证产物在 `output/`（git 忽略），这里只记结论。

## R0 地基清理 —— DONE（2026-09-26，分支 `v2/r0-foundation`）

| 条目 | 状态 | 结论 |
|:--|:--|:--|
| R0-1 决策落盘 | DONE | ADR-018 Accepted、ADR-019 新增、方案 §7 记录用户批复（c3be1b5） |
| R0-2 远端备份 | DONE | 45 个分支全部推送 origin，66 个仅本机提交已备份 |
| R0-3 仓库瘦身 | DONE | 53G→7.1G；归档 `C:\Users\admin\Desktop\xiadan-archive-20260926\`（含 gc 前 .git 备份）；checkpoint ref 删除+gc，.git 2.0G→533M，fsck 干净 |
| R0-4 忽略与换行规则 | DONE | .gitignore 忽略 output/、生成合同、凭证扩展名（a1a7c20）；.gitattributes 统一 LF，research/root-evidence 保留原始 CRLF（fa0d2e5） |
| R0-5 Windows 开发环境 | DONE | 便携 Node 24.20.0（官方 SHA256 校验）+ corepack pnpm 11.25.0（`source ~/.tools/xiadan-env.sh`）；Mac 带来的 node_modules 不可用（空文件链接+darwin 原生包），frozen 重装 45 秒 |
| R0-6 门禁 Windows 可移植 | DONE | 修复真实缺陷：corepack 无 shell 启动、设计门禁路径比较（原在 Windows 上漏检=假绿）；夹具 junction、符号链接/POSIX-only 测试在 Windows 精确跳过、bootstrap 导入超时（fa0d2e5） |
| R0-7 证据出库 | DONE | UI 门禁本地只查结构，CI/`--require-browser-evidence` 强制；入库证据已过期（Next 16.3.6 后未重生成）；6,464 个证据文件移出跟踪、464 份 md 摘要保留（46197f5） |
| R0-8 治理对齐 V2 | DONE | 规范 4.0.0（§0.2/§2.2/§16.3）；AGENTS/CLAUDE/SKILL 改为 V2 入口、解除 push 禁令、简化进度记录；MASTER 加 V2 指引 |

**R0 验收**：`pnpm check:dev` 通过（workspace/边界/format/lint、typecheck 64/64、test 64/64、build 36/36）；完整 `pnpm check` 链 24 段中 22 段通过、`test:postgres`/`test:s3` 因本机无 PostgreSQL 18 与 S3 模拟而跳过，由 CI 承担。

**遗留说明**：
- `output/` 另有约 2 万个被全局规则（`*.log`、`dist/` 等）忽略的历史本地文件，从未入库、不在已确认的删除清单内，未处理。
- Linux CI 基线（草稿 PR #13，run 36202613265）：security、operations 通过；quality、journey、commerce、catalog 失败。失败点分别是 UI 复合组件浏览器校验（360×800 英文 Hero 失败态布局偏移超过 1px）、本地体验在 Linux 上启动失败（supervisor 日志未随产物上传）、订单前台夹具的"每日礼物发布"媒体处理失败（`MEDIA_FAILED`）、catalog 详见产物。这些失败所在的脚本和代码 R0 都没有改动：R0 对回归框架的唯一改动 `resolveSpawnCommand` 在非 Windows 平台原样返回命令。回归矩阵加入 CI 后从未在 GitHub 上跑过，这是首次在 Linux 上运行，暴露的都是既有问题。修复单独立项。

## R1 生产就绪 + 支付预置 —— IN_PROGRESS（分支 `v2/r1-production`）

顺序见方案 §6 与 §3：R1-1 生产组合根 → R1-3 Stripe 适配器 → Airwallex → 其余条目；可并行的纯前台减摩擦项见 §4（1/2/4/5 项）。R0 的 Linux CI 基线：草稿 PR #13（`v2/r0-foundation → main`，2026-09-26 用户确认开启）。

**2026-09-26 用户决定**：沙盒与外部配置类工作（PSP 沙盒联调、邮件服务商、OIDC 身份源、云 apply、商户号激活）延后到最后，先完成站点核心功能。范围与顺序见 `docs/handoff/2026-09-26-core-features-first.md`；R1-3/R1-3b 的沙盒联调随之延后。同日用户批准交接文档的全部建议：核心功能的范围与顺序（F1→F2→F3）；本机先试便携 PostgreSQL，不可行时开草稿 PR 跑 CI。

| 条目 | 状态 | 范围与结论 |
|:--|:--|:--|
| R1-1 生产组合根 | LOCAL_ACCEPTED | 生产 API 注册全部路由依赖：admin 18 组、SEO、webhook（已部署验签器目录，未知端点在内存 404、不查库）、P5-05 支付目录（部署账户 + 数据库发布激活）；配置组"全缺=不可用、部分缺=启动失败"，淘汰静态绑定键；API 共享 3 个连接池（引用计数关闭）、单个 KMS/S3；worker 补管理中心任务循环。Test/Local 组合迁入 `src/testing/`，`pnpm deploy` 实测产物不含 `dist/testing`，导入图守卫经变异验证；29 个脚本 50 处导入改路径，静态校验 114 处 dist 导入全部可解析。`check:dev` 通过（api 84 文件/338 测试，worker 14/46；一次重跑前 persistence-postgres 3 个既有慢测试在负载下超时，单跑与重跑均通过）。未覆盖：真实 PostgreSQL 与浏览器集成（本机无 PG，交 CI）。遗留：`pnpm deploy` 安装阶段因 lighthouse→@sentry 缺 `@opentelemetry/core` 对等依赖失败，R0 版本同样复现，Docker 镜像构建会在此处失败 → R1-9 |
| R1-3 Stripe 适配器 | IN_PROGRESS | 新增 `packages/payment-stripe`（设计见 `docs/plan/r1-03-stripe-adapter.md`，API 版本钉死 `2026-08-26.dahlia`）：Checkout 托管页七操作 + `stripe-signature` 验签；Stripe ID 以 `_`↔`.` 可逆映射进平台引用；退款"先查后建"、无外部引用对账（metadata 检索 + 近 48 小时会话扫描）把 24 小时幂等补成持久幂等；传输失败或 5xx 在写操作上一律转对账。`PaymentConnectorFactory` 与凭据回执校验上移到 `payment-port`，网关行为不变。生产接线：`PAYMENT_SECRET_*` 环境凭据解析、`FAN_SUPPORT_PAYMENT_WEBHOOK_ENDPOINTS_JSON` 端点目录、签名头按适配器声明放行。验证：payment-stripe 29 测试、api 85 文件/343 测试、`check:dev` 通过。待办：沙盒联调（`pnpm --filter @fan-support/payment-stripe sandbox`）需用户在 `.env` 提供 `STRIPE_TEST_SECRET_KEY`；webhook 实收需 Stripe CLI |
| R1-3b Airwallex 适配器 | IN_PROGRESS | 新增 `packages/payment-airwallex`（设计见 `docs/plan/r1-03b-airwallex-adapter.md`，API 版本钉死 `2026-08-21`）。按官方文档核实后纠正调研记录两处：①托管页只能由浏览器 SDK 打开，所以端口动作改为 `PROVIDER_COMPONENT`（`airwallex-hpp`），前台补组件分派，SDK 在点"去支付"时才按需加载，token 解码也懒加载；②重复 `request_id` 返回 `duplicate_request` 而不是重放，恢复改为按 `merchant_order_id`/退款 metadata 反查。登录 token 进程内缓存、并发共用、401 换新重试一次；金额按主单位小数精确换算，非整数最小单位视为畸形；webhook 用 `x-timestamp`+正文 HMAC 验签，退款/争议事件直接带 intent，无需反查。生产接线同时部署 Stripe+Airwallex，webhook 放行两家验签头；client_secret 只有 60 分钟有效，所以部署 Airwallex 时 `actionTtlMs` 超过 55 分钟会导致启动失败。验证：适配器 38 测试（6 处变异均被抓到），前台 518 测试、api 接线测试通过。待办：沙盒联调（`pnpm --filter @fan-support/payment-airwallex sandbox`）需用户注册 Airwallex 沙盒并在 `.env` 提供 `AIRWALLEX_TEST_CLIENT_ID`/`AIRWALLEX_TEST_API_KEY`；需实测回跳是否追加参数、SDK `env` 取值、凭据格式 |

## R2 并行减摩擦项（方案 §4 第 1/2/4/5 项，与 R1 并行）

实现记录见 `docs/plan/v2-friction-items.md`；附录顺序 2→1→5→4。

| 条目 | 状态 | 范围与结论 |
|:--|:--|:--|
| §4-1 同意框合一 | LOCAL_ACCEPTED | 一个勾选框，旁边一句带全部政策链接的同意语（链接展开结账概要里的政策全文，点击不会勾选）；每个政策的 key/版本仍分别提交，合同与同意哈希不变；七语文案 DRAFT，审校哈希已更新；回归脚本选择器兼容。欧盟 extraConsents、德国付款按钮文案延后到对应市场上线。浏览器实测交 CI |
| §4-5 状态四态化 | LOCAL_ACCEPTED | `@fan-support/orders` 新增粉丝映射（全部 500 种状态组合穷举测试）：已付款→准备中→已送达时间线，付款确认中/已退款/已取消替换时间线，部分退款附说明；核查暂停显示"准备中"，争议不出现在文案中，争议期间不给进度承诺；四个规范状态轴保留为 data 属性，回归脚本不用改。"退款中"需要读模型提供进行中退款标记，列为后续 |
| §4-2 价格直显（第一阶段） | LOCAL_ACCEPTED | ADR-017 增补：只有一个已发布市场且只有一个币种时即为作用域，显式选择优先，不从语言推导。礼物详情先流式输出内容，价格与加购面板在原市场选择的 Suspense 位置流入，读价格失败时回退为市场选择；艺人页目录唯一市场时直接显示价格。保持"页壳/内容先于商业上下文"的流式保障（首版入口等待方案破坏了它，已回退）。第二阶段（/gifts 与首页目录带价、规范 URL、页眉/页脚隐藏地区入口）已随 F1-3 完成 |

## R2 站点核心功能 —— IN_PROGRESS（2026-09-26 起，顺序 F1→F2→F3，分支 `v2/r1-production`）

范围与顺序见 `docs/handoff/2026-09-26-core-features-first.md`；沙盒与外部配置类工作延后到最后。

| 条目 | 状态 | 范围与结论 |
|:--|:--|:--|
| F0 本机 PostgreSQL 验证能力 | DONE | 便携 PostgreSQL 18.6（EDB zip，SHA256 `fbe23da2…52f8c`，EDB 不发布校验和且 zip 内二进制未签名，信任锚为 HTTPS 官方源）解压到 `C:\Users\admin\.tools\pgsql-18.6\pgsql`，`POSTGRES_TEST_BIN` 写入 `xiadan-env.sh`。修复原生框架真缺陷：PostgreSQL 在所有平台用正斜杠写 `postmaster.pid` 的数据目录行，原代码逐字节比较导致 Windows 上拒绝清理集群；改为 `path.resolve` 归一化比较并补单测。`postgres-integration.mjs` 在 Windows 通过；persistence-postgres 完整 `test:postgres` 链 47 段全部通过（约 40 分钟，日志在 `output/checks/f1-postgres-windows/`）。API/浏览器级集成仍需 S3 模拟，交 CI |
| F1-1 虚拟礼物自动履约 | LOCAL_ACCEPTED | 设计 `docs/plan/f1-01-virtual-gift-fulfillment.md`。迁移 0038：`order_items.gift_kind` 购买时快照（结账写入 + 回填）；两个履约触发器放开 VIRTUAL 行 SYSTEM 直达 PENDING→DELIVERED（留言审核独立）；`notification_source_authority` 排除系统送达、`notification_order_snapshot` 带 giftKind。领域新增 `SYSTEM_DIGITAL_DELIVERY`；支付写入同事务数字送达并写审计/事件/outbox，自身预占失效的数字行随实物行 ON_HOLD；聚合推导抽成共享模块。后台：数字行无 PREPARE/DELIVER/HOLD，RESUME 即送达，已送达仍可审核留言，详情显示数字凭证提示（七语言）。查单 API 与邮件变量带 giftKind；前台纯虚拟订单两步时间线与三条七语言文案（审校哈希更新）；通知模板 v2（v1 归档按字节可复现，历史/身份/审校夹具齐全）。夹具默认礼物改为实物，`admin-orders-fixture.mjs` 新增混合与纯虚拟用例。验证：domain 222、persistence 752、i18n 62、contracts 527、storefront/admin/api/application 相关套件通过；本机真实 PG：迁移往返 + 目录快照（38 迁移）、回滚前缀守卫 53/53（含 0038 down/up）、支付 SQL 参数推断；`check:dev` 前五段通过，test 段因并行负载 5 个既有慢测试超时，`turbo run test --concurrency=1` 69/69 与 build 38/38 通过。未覆盖：API 混合订单用例与七语言浏览器验收（需 S3），交 CI 草稿 PR |
| F1-2 订单公开短号 | LOCAL_ACCEPTED | 设计 `docs/plan/f1-02-public-order-number.md`。迁移 0039：`orders.public_order_no`（`FS-`+6 位 Crockford base32，CHECK+UNIQUE+NOT NULL），列默认值 `generate_public_order_no()` 取强随机字节并对已提交冲突重试，既有订单逐行回填，`guard_order_transition` 自动保证不可变，通知快照带短号，有冻结通知变量时拒绝回滚。合同 `publicOrderNoSchema`/`normalizePublicOrderNo`（大小写、空格、连字符、可省前缀、O/I/L 读音相近字符）。查单详情与后台订单/财务/异常显示短号，UUID 只留在 URL、API 与 `data-order-id`；后台订单与财务按口述短号精确搜索、片段子串搜索。邮件 v2 在首次发布前原地修订显示短号（v1 归档字节不变）。F1-2b：`POST /api/v1/order-access/locate` 只凭本浏览器该订单的有效会话把短号解析为 publicOrderId（只读、不发凭据、共用 READ 限流），查单入口接受短号或 UUID，失败沿用现有文案。验证：contracts 533，持久化/应用/API/前台/后台/i18n/worker 相关套件通过；本机真实 PG：迁移往返与目录快照（39）、回滚前缀守卫 54/54、新脚本 `postgres-public-order-number.mjs`（升级回填、默认值、重复/格式/不可变拒绝、财务口述短号搜索、会话定位语义、回滚拒绝与 down/up，已并入 `test:postgres`）、查单 SQL 参数推断 18 条；两次提交的 `check:dev` 前五段均通过（typecheck 69/69），test 段各有负载导致的 5 秒超时（既有测试，单跑通过），串行复跑 test 69/69、build 38/38。未覆盖：API 级协议与浏览器用例（需 S3），相关脚本已改（定位用例、按短号查单、口述短号搜索、改用 `data-order-id`/链接片段定位），交 CI 草稿 PR |
| F1-3 首页改版、四分类、价格直显第二阶段 | LOCAL_ACCEPTED | 设计 `docs/plan/f1-03-home-categories.md`。F1-3a（86f12dd）：两个公开目录接口加 `kind` 筛选并带出每个礼物的分类（日常文档优先、其次修订资料，早期 v1 修订为 NULL；唯一键联表、分页前过滤，无迁移），应用层与路由逐条复核，OpenAPI 重生成。F1-3b（af5bb73）：首页满屏海报（桌面整屏构图、左下文字叠渐变遮罩；手机按已发布构图原比例不裁切）与四分类磁贴（链接 `/gifts?kind=`，随页壳输出），两个目录的 `kind` URL 状态、类型筛选、卡片分类标签，七语言文案 DRAFT、审校哈希更新。F1-3c：唯一市场时 `/gifts`、首页与艺人页目录在各自 Suspense 内原位带价，回退为纯内容目录；隐含作用域不进链接与 canonical；页眉抽屉与页脚地区入口按上下文隐藏；ADR-017 增补更新。验证：合同 535、application 645、api 348、storefront 823、i18n 63；本机真实 PG：新脚本 `postgres-gift-kind-directory.mjs` 40 项（v1/v2/v3、文档优先、两个目录分页前过滤），既有 gift-browse 803、strict 69、catalog-directory 315；本机假 API 夹具 + Chrome（产物 `output/checks/f1-03/`）：390×844 与 1440×900，en/zh-CN/th/vi/es/pt 截图与 DOM 检查（ja 只测流式计时），唯一市场/多市场/上下文故障三模式，上下文延迟 3 秒时内容 0.2–0.8 秒先出、价格约 3.6 秒到，链接无隐含市场，键盘焦点与减少动态效果正常，无溢出与控制台错误。三次 `check:dev` 前五段均通过，test 段为既有负载超时，串行复跑通过（持久化包 3 个冷启动超时，`--maxWorkers=12` 765 全过），build 38/38。未覆盖：API/浏览器级 CI 脚本；`local-experience-browser.mjs:433` 与 `accessibility-flows.mjs:170` 在唯一 GLOBAL 市场夹具下仍等待礼物详情的地区选择（价格直显第一阶段起即冲突），CI 首跑需更新 |
