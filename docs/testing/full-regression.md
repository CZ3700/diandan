# 完整本地回归

入口：`mise exec node@24.20.0 -- corepack pnpm verify:regression`。

该命令冻结当前已跟踪及新增源码，在仓库同级的 `.fan-support-regression/` 创建独立工作区（避免嵌入 node_modules，并沿用 Docker 可见的项目父目录），仅在该副本建立初始 Git 提交，执行 frozen/offline 安装和五组回归。Git 已识别的删除不复制，复制过程中新发生的文件缺失仍报错。它不复制 `.env`、用户的持久体验数据库、密钥、旧证据或参考素材。每个数据库、S3 和 TEST PSP 都由测试创建；失败保留日志与证据，临时 PG/S3 按原 harness 清理，失败的连续购买组保留自有持久实例数据，绝不 reset 用户实例。

运行前需要 Node 24.20.0、pnpm 11.25.0、已缓存锁定依赖、Docker、Chrome/Chromium；使用 `POSTGRES_TEST_BIN` 指定 PostgreSQL 18 原生二进制目录，所有临时库与连续购买实例采用同一套工具。原生模式仍逐次创建新集群、随机凭据与 loopback 端口，并严格按运行归属清理；不接受已有数据库连接。未配置时临时库沿用 Docker，连续购买组仍需要本地 PostgreSQL 18。`verify:regression` 入口将旧专项工具目录兼容归一化，但多个不同目录、空值、相对路径均直接拒绝；启动、执行或清理失败不切换数据库重跑。`report.postgresSelection` 记录本轮选择，已有 `postgres-environment.json` 由真实执行入口提供类型和版本。独立运行旧专项脚本仍沿用其原选择方式，本统一规则仅由回归入口保证。此能力不改变业务 SQL、事件时间或断言，也不证明历史 Docker 时间约束失败已解决。首次正常执行 `pnpm install --frozen-lockfile` 后，隔离副本使用 `--offline`，不自行选择或升级依赖。

`--plan` 只输出计划；`--suite quality|catalog|commerce|operations|journey` 只运行指定组，结果明确是部分覆盖；`--output 新目录` 设置证据位置，已有目录拒绝覆盖。所有命令固定，不接受任意脚本或数据库 URL。默认顺序执行并在首次失败时停止，后续组保持 NOT_RUN。

读取源仓库、准备副本及执行套件均移除继承的 `GIT_*` 环境覆盖，防止 `GIT_DIR`、`GIT_WORK_TREE`、`GIT_INDEX_FILE` 或注入配置把操作指向其他仓库；原仓库 HEAD、索引和未提交内容不受影响。

| 组 | 实际执行范围 |
| --- | --- |
| quality | 先构建依赖并检查回归工具，实际重跑组件与动效浏览器证据，再运行原完整 `pnpm check`：schema、适配器、Domain 属性/覆盖率、七语消息、实际 PG/API/S3/Worker、格式、静态检查和四应用构建 |
| catalog | 七语前台与 SEO/cache、礼物、简单管理中心海报发布/历史恢复、事故英文回退与精确失效 |
| commerce | 多艺人购物车、支付创建/回跳、历史订单与安全查单的真实浏览器矩阵 |
| operations | 登录与人员权限、订单审核/准备/送达、取消/全额与部分退款/拒付、支付配置、异常重放 |
| journey | 七语 × 390×844/1440×900，从首页连续游客购买、托管 TEST 付款、可信确认、邮件安全查单；深链语言切换、失败/取消恢复 |

每轮目录包含 `plan.json`、`source.json`、`report.json`、`steps.json`、逐命令日志及 `artifacts/`。`sourceHash` 绑定实际复制的执行输入；文档和进度文字不计入执行指纹。`report.workspace` 指向保留的副本，`artifacts` 中只收集原输出目录的 JSON/PNG/Markdown/文本证据，不归档私有运行状态、数据库、HAR、密钥或原始 `.log`。

组件验收含真实 Chrome 200% 浏览器缩放，Linux 需要图形显示环境。无显示服务时使用 `xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" pnpm verify:regression`；CI 已安装并配置。质量组重新生成当前副本的 P2-04/P2-05 证据，不复制或改写历史指纹。

连续购买组使用生产编译的 storefront 与隔离 TEST 运行时；管理中心保留受限的本地开发身份流程。入口每轮创建新实例；编译模式检查 LOCAL_TEST 环境以及 `test-regression-*` 名称和长度，普通 `local:start` 行为不变。启动取消会先终止自有编译进程，再完成逆序清理，不会在取消后继续启动服务。

管理中心媒体准备的各段数据库事务及最终发布事务，只对 port 明确标记为 `TRANSACTION_ABORTED` / `RETRY_SAME_COMMAND` 的已回滚错误做最多三次总尝试。等待位于事务外，每次重新读取权限、租约和持久 checkpoint；图片外部检查不重做。未知提交保持原恢复路径，不自动重放。连续购买前会从真实 PG 礼物 head 找到本次操作，核对唯一商品/价格/回执、精确媒体 checkpoint 以及每次发布的七語 outbox/purge 数量；这不等于每次运行都实际触发了数据库重试。

付款正文取证范围在报告中明确为 `RETURN_AND_EXPLICIT_PRE_DEPARTURE_CURRENT`：每个场景离开前主动读取 CURRENT，验证 HTTP 200、完整合同、交易身份与金额；回跳阶段读取实际 attempt body。所有匹配的 attempt GET 无论阶段都检查 HTTP 状态。普通本地体验观察器仍默认读取所有阶段正文，不对跨文档导航中无法保留的旧响应正文作已验证声明。

归档器只限制路径和扩展名，不替代内容脱敏。各测试生产者必须先用字段白名单和截图遮罩保护私密输入，不能把任意原始请求、数据库查询结果或错误正文放进这些文件。

每组入口移除外部 `FAN_SUPPORT_*` 应用配置，再由自有夹具生成 TEST 配置；统一保留 `POSTGRES_TEST_BIN` 工具选择，只有 journey 同时接收等值 `FAN_SUPPORT_LOCAL_POSTGRES_BIN` 供持久实例启动器使用。内部启动命令保留夹具刚生成的完整环境。这样既不会沿用用户业务配置，也不会把工具参数误传给严格的页面运行时配置校验器。

`status=PASS` 仅表示所选择的组均成功。只有五组全通过且十四条覆盖齐全，`coverage.complete` 才为 true；不能用单组 PASS、`pnpm check:dev`、旧报告或部分浏览器里程碑冒充完整验收。`journey.evidenceChecks` 计已执行场景里程碑，不是内部 assert 的精确次数。报告中的商用 PSP、真实资金、云和人工验收字段保持 false。

五组也可按 CI 的独立 job 方式分别执行，再做明确的跨运行汇总。必须重新核对每轮与当前完整执行清单的路径、字节、mode 和新增/删除，绑定相同 sourceHash、原命令/阈值、锁文件及实际工具版本；每组只能选一个完整 PASS，五组共17条命令与14条路径不可缺少。索引须逐一关联原报告、日志、场景与哈希，并在调用覆盖聚合前拒绝重复组。原失败与单组报告保持原状；跨运行通过不能改称“默认单条全套运行通过”，也不能把未复现的历史故障宣称为已修复。原执行源码未变的已通过组可复用，修改影响范围必须重新验证。

## 十四条核心路径

映射唯一执行定义见 `scripts/regression-plan.mjs` 的 `regressionRequirements`。对应实现入口如下，诊断时先看所属组的首个失败日志：

| SPEC §18.2 | 证据入口 |
| --- | --- |
| 1 游客购买/私密留言 | `regression-journey-browser.mjs` |
| 2 多艺人独立归属 | `cart-storefront-browser.mjs` |
| 3 失败/取消上下文 | `regression-journey.mjs`、`payment-runtime-retry-protocol.mjs` |
| 4 旧价格/库存/艺人 | `checkout-preflight-changes.mjs` |
| 5 回跳先到、可信收款后到 | `payment-runtime-browser.mjs`、`regression-journey.mjs` |
| 6 十次相同 webhook | `order-payment-protocol.mjs`；真实邮件去重另由通知集成验证 |
| 7 退款/部分退款/拒付 | `admin-finance-protocol.mjs`、`admin-finance-browser.mjs` |
| 8 准备/送达和通知 | `admin-orders-protocol.mjs`、`notification-integration.mjs` |
| 9 停渠道保留旧付款 | `admin-payment-config-protocol.mjs`、对应浏览器 |
| 10 双端海报 60 秒可见 | `management-center-browser.mjs` 的 `posterVisibility` |
| 11 七语完整连续链路 | `regression-journey*.mjs` 的十四个场景矩阵 |
| 12 真实语言菜单保持交易 | `regression-journey-browser.mjs`、购物车/订单矩阵 |
| 13 SEO 及事故回退双向移除 | `storefront-acceptance-matrix.mjs`、`regression-seo*.mjs` |
| 14 locale 缓存/英文源失效/PSP UI 回退 | publication runtime、`regression-seo-purge.mjs`、`payment-runtime-protocol.mjs` |

未标包路径的脚本均在 `apps/api/scripts/`；通知数据库脚本在 `packages/persistence-postgres/scripts/`。

## 失败复现与覆盖门槛

Domain 测试由 `packages/domain/package.json` 启用 V8 branch coverage ≥90%。属性测试在 `packages/domain/src/test-support/property-parameters.ts` 固定 seed；fast-check 失败打印 seed、path 和反例。保留原失败日志与测试名，使用同一源码与参数定向重跑，不增加 timeout 或减少样本掩盖失败。状态机属性和付款状态机使用同一明确固定种子，领域测试不依赖网络。

七语 UI 文案比较 key、ICU 参数类型和选择结构；仅允许 locale 的 CLDR 规则可证明等价的简单数量占位差异。未知 schemaVersion、非法 locale、缓存跨语和不可信付款不能通过报告聚合被忽略。

## CI 与实际范围

CI 以五组独立 Ubuntu job 运行，固定 `Quality` 汇总检查只有在全部组成功时通过；任一失败、取消或跳过都会阻断。`Security` 保留独立依赖审计和秘密扫描。每个 job 即使失败也上传本轮公开测试证据，不上传私有实例目录。

浏览器安装采用 [Playwright 官方 CI 与浏览器说明](https://playwright.dev/docs/ci)，显式安装 Chrome 和 Chromium；原生 PostgreSQL 18 使用 [PostgreSQL 官方 Ubuntu apt 仓库](https://www.postgresql.org/download/linux/ubuntu/)。Ubuntu 24.04 自带 PostgreSQL 的版本不作为 18 的验收替代。

本地成功不等于实际 GitHub CI 通过，也不代表商户 sandbox、真实交易、物理手机、人工读屏/译审、RUM、云 staging、恢复或发布。远端同步仍遵循用户“先本地提交，最后集中推送”的选择，P6-01 在缺少原远端 CI 证据时保留 IN_PROGRESS。
