# P5-04 本地实施准备审计

日期：2026-09-21；只读源码基线 `bfe259a`。本报告仅是确认排期后的准备材料：未领取 P5-04，未实现代码，未运行测试、构建、数据库或浏览器服务。新增文件仅为本报告；所述通过结果均来自已保存历史验收，并非本次重跑。

## 范围与进入条件

- `docs/plan/task-breakdown.md:140`：P5-04 依赖 P1-03/P4-04，范围是 PaymentCapability、规则版本、健康熔断与 provider conformance，最低证明为确定性及替换 adapter 不改 Domain/UI。
- `docs/progress/phase-5-operations-payments.md:18`：当前 PENDING；ADR-015 只提前允许 P5-01→P5-02。扩大本地排期提案未接受，不能以本报告解除 Phase/依赖门。
- SPEC §13.1/13.4：先部署 adapter，PG 决定资格；只在创建前选路，已有或 UNKNOWN 支付固定账户；语言不是市场/路由输入。§13.2 的配置编辑/发布/回退和七语标签管理主要由 P5-05 承接。
- 已读 P4-04 两份 `final-verification.md`（`output/checks/p4-04-payment-runtime/`、`output/checks/p4-04-payment-connectors/`）、phase-4 对应记录及 `docs/operations/payment-connectors.md`。其明确保留真实 PSP、持久配置管理/广播与 USDT 专属 mapper 等余项；P4-05 后续已完成的订单入账不能再按旧检查点文字算作当前缺口。

## 已有成果：直接复用，不重造

| 能力 | 实际实现入口 | 已有验证入口与边界 |
| --- | --- | --- |
| 能力/端口合同 | `packages/contracts/src/payment.ts:120` 的 `paymentCapabilitySchema`；`payment-port-contracts.ts:103,341,493` 校验命令、响应及 market/country/currency/action/金额关联；`packages/payment-port/src/index.ts:63` 为七操作端口，webhook verifier 独立 | `packages/contracts/src/payment-runtime*.test.ts`、`packages/payment-port/src/index.test.ts`；旧 v1 webhook parser 是兼容面，不能重新并入生产端口 |
| 纯确定性选路 | `packages/contracts/src/domain-rules.ts:94–219`；`packages/domain/src/payment-routing.ts:93` | `payment-routing.test.ts` 覆盖资格/健康/稳定次序/完整整数优先级/UNKNOWN 固定；`payment-routing.property.test.ts:64` 已有排列不变属性测试 |
| checkout 可用方式 | `packages/application/src/payment-runtime-capabilities.ts:47,98,151`：PG 资格与已部署 provider 同时成立，实际调用 `getCapabilities`，交集 action 和方法，返回 PG 已批准标签 | `payment-runtime.test.ts:254,273,310`、`payment-runtime-provider.test.ts:177`；country 必须显式，普通 GET 不创建或对账 |
| 创建时再次校验 | `packages/application/src/payment-runtime-create.ts:52`；`packages/persistence-postgres/src/payment-runtime-write.ts:31` | 先按永久回执恢复，再看最新规则；首事务重验 publication/config/rule、账户/商户/健康、金额/币种、country 和 device，冻结 attempt。`database/migrations/0026_payment-runtime.up.sql:105` 再以约束检查 |
| PG 配置真相与发布版本 | `packages/persistence-postgres/src/payment-runtime-config.ts:10` 读取唯一发布 head、不可变 manifest/config、路由、实际账户与最新 APPROVED locale 标签 | `apps/api/scripts/payment-runtime-config-fixture.mjs` 按原数据库约束建立 TEST 发布包；`payment-runtime-config-postgres.mjs` 检查真实表/头/审核/事件；不能说数据库只存在空壳 |
| 健康事实及约束 | `database/migrations/0005_payments-reliable-events.up.sql:19,41,1020–1093`：账户 HEALTHY/UNAVAILABLE、只追加有序事件、version/head 一致性约束 | `packages/persistence-postgres/scripts/payment-runtime-health-fixture.mjs:5` 是明确 TEST-only 写入；其 `.test.mjs`；`apps/api/scripts/payment-runtime-retry-protocol.mjs:107–143` 已验证改健康不改旧 attempt、不重复创建 |
| 部署目录及连接热投影 | `packages/payment-gateway/src/registry.ts:80`；`packages/application/src/payment-runtime-provider.ts:62`；`apps/api/src/payment-runtime-composition.ts` | 原子接受完整新快照，保留历史账户，不允许同 revision 漂移、删除历史连接或动态代码；registry/directory/factory tests 已覆盖。它只是可信投影消费者，不是 author/publish/广播服务 |
| 网关真实传输 | `packages/payment-gateway/src/client.ts:235`、`factory.ts:8`；固定 HTTPS/凭据引用/严格绑定，不自动重试变更 | `client.test.ts`；`http.test.ts:239–302` 已有真实受信 CA 的七操作、断连/超限/超时/重定向/TLS 负例。不能把“补 TLS 七操作”再次列成全新工作 |
| 共用 provider conformance | `packages/testing/src/conformance.ts:563`；`fixtures.ts`；返回可序列化的逐 case 报告 | `packages/payment-fake/src/index.test.ts:29` 已调用并要求 15 cases，覆盖七操作及 capture/refund/replay/conflict/上限/认证对账；legacy parser 另一个 suite |

`packages/payment-routing/src/index.ts` 目前只有 workspace boundary，不代表系统没有选路。将既有 Domain 算法复制到该包会制造双份规则；本任务没有依据要求搬迁。

## 已确认缺口与需要先定清的边界

1. **健康状态有消费和数据库约束，缺运行时自动观测/熔断/恢复闭环。** 对 `packages/*/src`、`apps/api/src`、`apps/worker/src` 搜索 `payment_provider_health_events`、`health_status`、`PaymentProviderHealth` 和 circuit：生产路径只读健康；写事件和账户的入口出现在 TEST fixture/约束脚本。`PaymentRuntimeRepository`（`packages/persistence-port/src/payment-runtime.ts:36`）也没有健康观测写入方法。`payment-runtime-execution.ts` 的网络不确定只推进自身 attempt/恢复工作，不更新共享 provider 健康。不能把 TEST 手工改健康称为生产自动熔断。
2. **部分灰度目前明确拒绝，尚不是稳定分桶。** Application `payment-runtime-capabilities.ts:58`、PG `payment-runtime-write.ts:80`、0026 SQL:127 同时要求 rule/provider rollout 为 10000；0–9999 不参与新付款。字段存在不代表 5%/25% 已实现。后续若启用须统一确定性依据、持久决策与三处一致校验，不能只放宽 UI 条件；旧合同/迁移不可原地改写。本切片建议暂不同时引入灰度。
3. **多候选主备选择需要明确运行时语义。** 纯 `selectPaymentRoute` 会对整组规则排序；当前 capability 用每次一个 rule 调它做资格判定，UI 再以 `capabilityId=rule.id` 选择一个 route。当前有效实现不能冒称已有“同一支付方式多商户透明主备切换”。补此行为前须先冻结方法/展示/账户选择合同，不擅改现有 capability ID 或在 create 发出后 fallback。
4. **共用 suite 已有，但本次未找到网关实际调用它的入口。** 源码中 `runPaymentProviderConformance` 的 adapter 测试调用仅见 fake；网关 TLS tests 自有七个响应 fixture，未复用 15-case 状态序列。可后续以可配置 fixture 和有状态 TEST TLS provider 接同一 runner，补“第二 adapter 同套认证”的证明；不要把原 TLS 测试删掉，或把 stateless canned responses 当退款幂等证明。
5. **配置发布缺口属于 P5-05，不能混入本任务重写所有支付。** PG 发布模型/审核/约束与 TEST seed 已有；真实授权写入用例、管理 UI 和多节点传播尚未接通。账户身份在当前数据库 guard 中不可就地改写；停用路由与健康状态也不能混为同一种配置操作。

## 建议确认后领取的第一个有限切片

**目标：同一 TEST 商户持续出现技术故障时，服务端按明确策略暂时停止向新结账提供该账户；健康恢复后重新允许，已有支付始终沿原账户恢复。** 这是 P5-04 的健康闭环检查点，不代表完整 P5-04 DONE。

1. 先定义独立兼容的内部“技术观测/健康策略/持久状态/结果”合同。边界限定账户+环境、受控操作与原因码、唯一观测 ID、可信服务端时间及策略版本；不含 provider 原文、邮箱、卡数据、凭据。具体字段与迁移由领取后的合同 owner 冻结，本报告不创建新 API。
2. 纯 Domain 决策仅消费已验证的有限观测和策略，不访问网络/时钟/数据库。区分技术不可用与普通拒付、用户取消、有效空能力列表、配置错误；不能把“付款未成功”统一计为渠道故障。阈值/窗口/恢复策略可验证且版本化，TEST 值不冒充正式商户策略。
3. persistence port 和 PostgreSQL 在单一事务内去重观测、锁账户/健康状态、保存计数或窗口事实、追加原健康事件并更新原 health/version；健康状态继续以 PG 为准，不引入进程内独立 circuit 真相。新迁移增量扩展，不重写 0005/0026 历史 SQL。精确使用旧 sequence/version/head 约束。
4. Application/组合层从受控 provider 调用收集有限技术结果；外部调用始终在事务外。恢复必须使用有界的安全查询/探测，不创建付款、退款或伪造成功证据；打开状态下仍须有明确恢复入口，不能因 capability 不再调用 provider 而永远无法恢复。新增 worker/探测只在该路径确有需要时接现有持久任务，不另起队列系统。
5. 直接复用现有 PG capability/create 资格判断，让健康转移影响新订单；回执重放、CREATED/UNKNOWN 恢复继续按冻结身份执行，不受新选路替换。先做真实 PG + 两个独立应用实例 + TEST TLS provider 的端到端验证，不引入管理 UI 或真实商户启用。

持久观测失败不能吞掉原支付结果、把一次已发出的创建当作未发出重试，或覆盖可信 reconcile。具体 fail-closed 与恢复顺序应在合同阶段用失败测试冻结；此项比添加笼统“重试三次”重要。

## 必须先写出的失败行为

- 同一观测重放不重复累计/追加事件；同 ID 不同账户、环境或内容拒绝；未知版本和非 allowlist 原因码拒绝。
- 技术错误达到策略门槛才转 UNAVAILABLE；拒付、取消、有效空能力或配置错误不被误计为整个 PSP 故障。
- 两实例并发观测、响应丢失重放与进程重启后，账户 version、事件 sequence、窗口事实保持一致，回滚无半条健康状态。
- 过时/乱序观测不能用旧成功清除较新的故障；时钟回拨/边界、策略版本变化有明确可重现结果。
- 能力列表读取后、beginCreate 事务前熔断，新创建必须被原数据库最终检查阻止且 PSP create 为零。
- 已发出创建/UNKNOWN 在熔断后仍只恢复原 account/attempt/key；另一个健康账户出现也不能重新路由或重复扣款。
- 新结账不能把熔断账户展示为可用；其他健康账户不被连带误熔断；环境隔离。
- 恢复探测并发有界、不会产生资金动作；到期/失败保持不可用，满足恢复策略后事件与 head 同事务恢复。
- 健康记录异常不能把 mutation uncertainty 变为明确失败后再次付款；日志/错误/观测表不保存敏感 provider 原文。
- 如扩展共用 conformance：故意错误关联、修改 command、重复退款产生新结果、超额退款或错误恢复账户的 adapter 必须失败；原 fake 15 cases 保留。

## 确认后的验证入口（本次均未运行）

统一前缀 `mise exec node@24.20.0 --`。先新切片的 RED→GREEN，再按实际改动扩大；当前 P3 性能采样期间不执行这些命令。

| 层 | 现有精确入口 |
| --- | --- |
| Domain 选路/属性 | `corepack pnpm --filter @fan-support/domain test`；重点 `src/payment-routing.test.ts` / `.property.test.ts`，保留无网络与 coverage 门 |
| provider/能力/恢复 | `corepack pnpm --filter @fan-support/application test`；重点 `payment-runtime.test.ts` / `payment-runtime-provider.test.ts` / `payment-runtime-directory.test.ts` |
| 同套 adapter 认证 | `corepack pnpm --filter @fan-support/payment-fake test`、`--filter @fan-support/payment-gateway test`、`--filter @fan-support/testing test`；新 gateway runner 接入后不可仅靠自身 canned response |
| 既有健康约束/SQL | `node --test packages/persistence-postgres/scripts/payment-runtime-health-fixture.test.mjs`；`node packages/persistence-postgres/scripts/postgres-payment-runtime-parameters.mjs`；迁移与新健康 PG 集成另由切片补齐 |
| 原真实支付运行时 | `corepack pnpm --filter @fan-support/api test:postgres:payment-runtime`：原 build + TEST runner tests + 配置 PG + `payment-runtime-http.mjs`，保留健康变化与旧 key 恢复证明 |
| 受影响 UI | 若能力显示/选择语义改变，运行 `corepack pnpm verify:payment:browser`；原 `--production --ui` 是本地生产构建 TEST 流程，不是生产支付 |
| 最后统一门 | `corepack pnpm check:dev`、合同新鲜度/adapter/artifact 门、受影响完整 PG/HTTP 回归及暂存后的秘密扫描；非作者复核/S.U.P.E.R，记录实际缓存与未跑范围 |

## 仍不能宣称完成的外部项

首个实际 PSP 的批准及资格、真实账户/sandbox、官方协议与签名映射、实际 3DS/卡网络、供应商幂等期限、退款与对账、真实小额/灰度；USDT 专属报价/持久关联/网络确认；正式 Secret Manager、生产云与真实监控阈值。Visa/Mastercard 不是本仓库两套通用 REST API；现有网关是自有规范化协议。新健康或 conformance 本地检查点不会把 P4-04、P5-04 或 Phase 5 自动标 DONE。
