# 管理中心付款、退款与对账（P5-03）

本入口用于本地 `LOCAL_OIDC`、独立 TLS TEST PSP 和临时 PostgreSQL 验证。它不代表真实 PSP sandbox、真实退款、正式 IdP 或生产发布通过。沿用管理中心登录和原订单；不增加另一套后台。

## 日常操作

1. 在管理中心打开订单，查看「付款与退款」。具有 `orders.read` 的人员可读取；资金操作还需要平台 `finance.manage` 权限和有效 MFA 会话。
2. 退款选择「退还全部剩余金额」，或逐件填写部分金额。核对原币种、金额和原因，勾选确认后提交。界面显示请求已登记，最终结果来自原支付账户。
3. 「退款处理中」显示未完成的金额占用；成功退款另计入「已退款」。待确认请求持续占用余额，不能因为超时认为没有退款。处理中也暂停该订单的准备、送达和恢复操作，既有交付历史不改写。
4. 网络断开、响应丢失或刷新后，使用「恢复原请求」。浏览器按当前管理身份和订单保存同一个请求及幂等键，不保存凭据或粉丝私密内容。无法保存恢复记录时暂停新的资金操作。
5. 已登记且仍待确认的退款，使用「核对支付方结果」。后台仅向原账户查询原退款；不自动创建新退款。支付渠道被停用、轮换配置或不可用，都不能把历史请求换到另一个账户。
6. 未付款订单可申请取消。仍可能收费的订单先核对或取消原支付尝试，取得可信终态后才释放库存与结账资源。收款先到达时保持已付款，后续按退款流程处理。
7. 「对账」列表可按订单号搜索，筛选退款、拒付和待对账记录。拒付状态来自可信支付证据，后台不能手动把它改为胜诉。OPEN/LOST 暂停额外退款及交付；可信 WON 后可按现有权限和审核条件继续操作，不自动交付。

## 实现与诊断入口

- 公共合同：`packages/contracts/src/admin-finance.ts`；内部领取/租约/结果合同：`admin-finance-persistence.ts`。
- 纯状态判断：`packages/domain/src/finance-evidence.ts`。解析合同不等于认证证据，持久层还必须验证存储的可信来源。
- 应用：`packages/application/src/admin-finance.ts`、`admin-finance-runtime.ts`、`admin-finance-events.ts`。外部 HTTP 在事务之外；事务先保存请求、收据和租约。
- 持久层：`packages/persistence-postgres/src/admin-finance-*.ts`；新增迁移 `database/migrations/0035_admin-finance.up.sql`。
- 管理界面：`apps/admin/src/management-finance/`；五个专用 API 操作通过现有 BFF，不在浏览器保存数据库或支付密钥。
- `admin_finance_operations` 保存恢复进度和租约；`admin_finance_receipts` 保存管理员幂等请求；`admin_finance_application_receipts` 保存证据处理结果；`admin_finance_application_schedule` 为早到证据安排重试。
- 不直接更新状态、删除审计、重置 UNKNOWN 或回滚非空资金历史。恢复由原命令及持久任务完成。需要人工处置的矛盾证据保留 REVIEW，不猜测资金结果。

## 复验

运行时前缀统一为 `mise exec node@24.20.0 --`，pnpm 为仓库固定版本。

```sh
mise exec node@24.20.0 -- corepack pnpm check:dev
mise exec node@24.20.0 -- corepack pnpm check:contracts
mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/postgres-integration.mjs
mise exec node@24.20.0 -- node --test packages/persistence-postgres/scripts/notification-rollback-prefix.test.mjs
mise exec node@24.20.0 -- node --test apps/api/scripts/admin-finance-disputes-psp.test.mjs
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test:postgres:admin-finance
mise exec node@24.20.0 -- node apps/api/scripts/admin-finance-http.mjs
mise exec node@24.20.0 -- node apps/api/scripts/admin-finance-http.mjs --auth-stress
mise exec node@24.20.0 -- node apps/api/scripts/admin-finance-http.mjs --ui
```

HTTP 与浏览器夹具创建临时 PG、对象存储、真实 TLS OIDC 和独立持久 TEST PSP。浏览器验收脚本要求覆盖七语言、390×844 和 1440×900；截图只用合成数据，不读取粉丝私密内容。命令可能涉及应用构建，避免同时启动多个对同一个 Next 目录的构建。

本轮原始日志与 RED→GREEN 记录在 `output/checks/p5-03-refund-operations/`；实际 HTTP/浏览器每轮结果在 `output/checks/p5-03-finance/integration-*/`。每份结果注明真实基础设施、TEST PSP、实际检查范围和失败阶段；只以最终已运行的门禁与独立复核作为验收依据。

本机 PostgreSQL 曾实测出现墙钟回拨：刚发行的会话被正确判定为未来会话，或登录完成时间早于已领取时间而被数据库拒绝。`--auth-stress` 专门验证连续登录和权限读取。finance TEST 夹具只对本次有效登录等待真实 PG/Node 时钟越过原持久时刻及500毫秒余量；按原授权 state 精确匹配 token 阶段，首个会话 GET 匹配实际签发凭据，使用6秒单调期限并在结束后卸载。不会改写时间、放宽生产权限/TTL或重试401；无效、撤销、过期、MFA/CSRF异常仍走原拒绝流程。该本机正例就绪等待不代替 staging 的系统时钟与身份验收。

## 本机虚拟数据库时钟异常时的隔离复验

本轮独立测量确认 Colima guest 的 CLOCK_REALTIME 会在同一 SQL 内回退约0.2秒，固定单CPU也未消除；因此上述登录前置等待不能保证事务内墙钟单调。不要通过改写时间、移除约束或重试被拒绝的身份操作来掩盖环境问题。

finance TEST 入口支持显式选择正常安装的 PostgreSQL18 工具目录：

```sh
ADMIN_FINANCE_TEST_POSTGRES_BIN=/absolute/path/to/postgresql18/bin mise exec node@24.20.0 -- node apps/api/scripts/admin-finance-http.mjs --ui
```

未设置时仍使用原 Docker 临时PG。设置时仅接受工具目录，不接受已有数据库地址或数据目录；每次创建新的私有临时集群、随机密码和loopback端口，使用SCRAM认证，结束时核对本次目录/进程归属并停止清理。工具不可用或归属不符会失败，不自动连接其他数据库。对象存储/TLS IdP/独立持久TEST PSP和全部浏览器断言保持；管理中心运行 Next dev + LOCAL_OIDC，本地生产build单独验证。

本机原生18.6工具准备、版本、临时集群正常/失败清理和时钟对照见 `output/checks/p5-03-refund-operations/native-postgres-tooling.md` 与独立review。这只是本地隔离运行方式；虚拟机本身的阶跃校时原因、staging时钟/身份与正式部署仍需各自验证。

## 保留的外部验收

真实商户/批准 PSP 的 sandbox refund、资金规则和事件映射、真实小额资金、正式消费者政策、关键七语人工译审、生产身份/密钥、多进程 staging 与发布演练仍需对应证据。七语新增资金文案保留 DRAFT 评审清单，不能把自动测试作为人工译审。P5-05 配置发布与 P5-06 通用异常工作台按各自依赖后续开展。
