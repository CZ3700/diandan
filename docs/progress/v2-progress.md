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
| F1-4 送达证明照片 | LOCAL_ACCEPTED | 设计 `docs/plan/f1-04-delivery-proof.md`。F1-4a（7d93b3b）：迁移 0040 三张只追加表（上传预留、照片关联、撤回），延迟触发器在提交时重验会话/MFA/权限/审计/操作回执，拒绝虚拟行，每行未撤回照片不超过 3 张，有照片时拒绝回滚；照片在 API 内同步核验（魔数/MIME/像素/最短边 320）、自动转正、丢弃全部元数据，重编码为 display 1600 与 thumbnail 480 两个 WebP，只存私有 source 桶 `fulfillment-proofs/v1/`，不经 CDN；后台五个动作（预留上传、完成上传、附加、撤回、查看；查看只给履约与经理权限，预签 GET 至多 300 秒）；查单读模型只带已送达实物行的未撤回照片，粉丝经 API 字节代理按会话读取（共用 READ 限流）。F1-4b（54a803f）：后台送达面板（隐私提示、0–3 张、隐私确认，先上传附加再送达）、已送达行补传、经理撤回（批准范围外的补充，只隐藏不删除），七语言。F1-4c（01da78c）：前台同源 BFF 图片代理与查单页照片区（缩略图即对话框触发），七语言文案 DRAFT 与审校哈希，WAF 路由补 locate 与照片路径，本地体验 CI 端到端，运维文档。验证：contracts 544、media-image 76（EXIF/GPS/方向去除实测）、application 657、persistence 788、api 352、admin 226、storefront 828、i18n 63；本机真实 PG：新脚本 `postgres-delivery-proofs.mjs` 53 项（已并入 `test:postgres`）、迁移往返与目录快照（40）、回滚前缀守卫 59/59（含 0040 down/up）、查单 SQL 参数推断 19 条；前台生产构建 + 本地 TLS 边缘 + 假 API（产物 `output/checks/f1-04/`）：7 语言 × 390×844/1440×900，虚拟行无照片区，缩略图与大图解码，键盘可达、焦点可见，Esc 后焦点回到缩略图，竖图不越界，减少动态效果时过渡 0s，无溢出与控制台错误。三次 `check:dev` 前五段均通过，test 段为既有负载超时（F1-4a/b 后台 `center.test.tsx`，F1-4c 前台 specimen/RUM 4 个），串行复跑 69/69、build 38/38。未覆盖：API 协议（经临时 S3 与处理器实传照片）与浏览器级 CI 脚本，交 CI 草稿 PR |
| F1-CI 草稿 PR #14 CI 验证 | DONE | 2026-09-27 用户批准开草稿 PR #14（`v2/r1-production`→`v2/r0-foundation`，只跑 CI 不合并），5 轮后按用户决定关闭，R0 既有失败转入“CI 四组回归失败修复”。第 1–4 轮（run 36266273118/36268725200/36271614715/36275249318）后：Security、operations（F1-4 后台送达面板与经临时 S3 实传照片协议、七语言后台浏览器、财务/支付配置/异常）、journey（七语言完整购买，首次在 CI 通过）全绿；commerce 的 cart、payments 与 catalog 的 fallback-seo、storefront-seo-cache、gifts（首次通过）已过。已修真问题：①0038/0039 回填只停了不可变守卫，`order_items`/`notification_runtime_state` 上的延迟用户触发器仍排事件，已有订单或通知的库升级报 55006（空库往返测不到）→ 回填期间 `DISABLE/ENABLE TRIGGER USER`，新增 `postgres-backfill-upgrade.mjs`（0037 历史升级到 0040，已入 `test:postgres`）；②`@fan-support/orders` 只被 storefront 依赖，18 个启动前台的脚本构建过滤漏掉它，生产 `next build` 失败 → 加 `storefront^...`；③后台订单浏览器脚本仍用 UUID 比对 F1-2 后显示的短号；④`gift-storefront-browser` 未选市场断言按 ADR-017 增补改为不带价内容目录 + `/region`；⑤本地体验 S3 容器在原生 Linux Docker 写不了 0700 绑定目录 → Linux 下 `--user uid:gid`（journey 由此首次启动）；⑥Hero 失败演示按钮点击后文字变长折行。另：`local-experience-browser.mjs`/`accessibility-flows.mjs` 不在 CI 回归计划内（F1-3/F1-4 交接误记为 CI 覆盖）；前者带显式市场参数不受唯一市场影响，后者已适配。①quality 的 `ui-composites` 在 Linux 字体下 `stress-320x800-pt` 的 Hero 加载→就绪增高 20px（就绪态长葡语文本超过 544px 最小高度）：用户 2026-09-27 决定压力格只查无溢出/无截断，已实现为压力格的就绪 Hero 只许向下增高、位置与宽度仍 1px 内（失败态与常规视口不变，单测含 CI 实测值与变异验证），尚未经 CI 复核；遗留（R0 既有）：②commerce orders（每日礼物 GIFT_PRIMARY）与 catalog management-publication（艺人 PORTRAIT 等）媒体任务间歇 `STORAGE_UNAVAILABLE`，临时 S3 卷扩到 512m 未解决（容量假设不成立）；第 5 轮（run 36277447348）诊断：处理器的 PUT 经临时 S3 夹具的 TLS 代理连续返回 502（代理只在上游连接出错时回 502，即 versitygw 中途断开），母版体积约 2.8MB、7MB 的对象都曾成功写入，排除 4MB 请求体上限；疑为 keep-alive 复用竞态或容器资源限制，需代理上游错误码或容器日志再定。它挡住了 F1-2/F1-4 粉丝查单页的 CI 验证。第 4、5 轮 payments 通过（含迁移回滚保护，证实 0038/0039 修复）；journey 第 5 轮偶发失败（内容全部发布，泰语页等待图片解码超时），第 3、4 轮通过 |

## 远程测试环境（TEST 适配器，非 staging）—— LOCAL_ACCEPTED（2026-09-27）

用户 2026-09-27 要求部署到自有云服务器上，以便在真实服务器环境中测试。用户决定采用"远程测试环境"：前台公开；后台、收件箱和 OIDC 身份选择页加 Basic Auth；服务器为 4GB。设计见 `docs/plan/remote-test-environment.md`，运行手册见 `docs/runbooks/remote-test-environment.md`。

| 条目 | 状态 | 范围与结论 |
|:--|:--|:--|
| RT-1 服务器与公网部署 | LOCAL_ACCEPTED | **服务器**：AWS Lightsail 新加坡，Debian 12，4GB 内存外加 4GB swap，静态 IP `18.143.148.122`。已安装 Node 24.20.0（SHA256 校验）、pnpm 11.25.0、PostgreSQL 18（PGDG）、Docker、Caddy；ufw 只放行 22/80/443。运行用户为 `xiadan`，代码经服务器上的裸仓库推送。**补丁**：本地体验新增公网模式。`local:start/prepare --public-base-domain` 在创建实例时固定对外地址为 `https://<服务>.<域名>`；内部调用直连回环地址，不经过边缘层；S3 服务端 SDK 走回环，预签名地址走公网 `s3.` 主机；DNS 预加载把公网主机名映射到各自的回环地址；`local:caddy` 生成边缘配置（Let's Encrypt、校验上游证书、保留 Host、Basic Auth 只加在后台、收件箱和身份选择页）。**排查结论**：Next 开发服务器总是用 `hostname\|\|'localhost'` 加监听端口构造请求地址（`render-server.js`），`trustHostHeader` 在开发模式下不起作用；所以两个应用分别监听 `127.0.0.2:443` 和 `127.0.0.3:443`，Caddy 只绑定 `127.0.0.1` 和内网 IP，并设置了 `ip_unprivileged_port_start=443`。**验证**：Linux 上本地体验单测 65/65 通过；新增运维走查 `apps/api/scripts/remote-test-walkthrough.mjs`，从开发机访问 `stg.kikikong.com` 全程通过，覆盖商城两种尺寸、后台 Basic Auth 与 TEST OIDC 登录、艺人/礼物/海报发布（经公网预签名上传和服务器处理）、下单、在 `payments.` 上完成 TEST 支付、订单已付款（显示短号），以及收件箱查单链接。**待观察**：①第 2 次走查时创建艺人偶发失败（第 3 次通过），原因未查；②订单页礼物图片在截图时刻仍是占位图（礼物详情页同一张图正常，疑为懒加载时序）；③Next 开发模式的"Issue"角标对测试者可见。性质：TEST 适配器环境，不能作为上线验收证据 |
