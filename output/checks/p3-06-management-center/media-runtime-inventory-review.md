# 管理媒体、价格/库存及本地运行复核

`/root/storefront_read` 的有界只读复核；未启动 Next、浏览器或真实 PostgreSQL。媒体、价格/库存 helper、运行脚本由 root 实现，daily publication 窄 port 由 directory 实现。复核中发现的管理 LIST/提交问题随后经 root 分配由本文作者修复，因此该部分是作者验证，不能冒充独立验收。

## 实质发现与处理

1. **已有库存 item 的策略变更会违反真实数据库约束。** 最初只更新 variant.policy，非 TRACKED helper 直接返回，现有 item.policy 未变；0002 的 deferred consistency guard 会拒绝。管理合同现新增 `inventoryPolicyLocked`，提交时检查实际 item 并以 `INVENTORY_POLICY_LOCKED` 提前拒绝，API 返回 private 409。UI 由 e2e 明确说明且只锁策略，其他编辑保持可用。directory 在最终发布事务再次验证，防止提交后创建库存 item 的并发变化；不放宽旧 guard。
2. **零库存新礼物无法再次补货。** 原 helper 合理地不制造 delta=0 ledger，但 LIST 只通过 balance 找库位，导致新礼物 inventory=null/canEdit=false。现在在没有 balance 时，仅从当前 gift head 对应的 daily manifest、同一 SUCCEEDED operation 及精确 publication/revision result 中恢复已发布的库位设置；该设置还必须指向真实 ACTIVE location。数量仍读真实 balance 或零；不读取任意最新、失败或未发布 operation，不从默认库位猜测。零数量也在提交时校验真实 ACTIVE location；最终事务由 directory 再查。无新表、无虚假流水。
3. **调试日志包含原 SQL 片段和数据库错误 message。** 数据库错误文字可能包含输入值，与原注释“安全诊断”不一致。已报告 root；最新源码已删除原文，仅持久化固定操作枚举和 SQLSTATE。本文不删除或重写此前合成夹具诊断，也未读取其中业务值。
4. **日常礼物类型回读使用了旧 profile。** directory 独立指出原 LIST 只取 legacy gift_kind，会把日常 WISH 等类型显示为 OTHER，编辑时可能改错。已按当前 daily document 的真实 giftKind 优先、legacy profile 后备修正一行 SQL；`daily-gift-kind-list-red.log` 1 项有效失败，`daily-gift-kind-list-green.log` 最终 PG **15 tests PASS**，对应 format/lint exit 0。此后未自行重构建，root 已知下一轮应刷新 PG dist。

## 未发现其他需要立即修改的问题

- 媒体检查发生在长锁之外，注册、真实 job 引用和 checkpoint 在事务内；每个阶段重新加载当前授权/fence。来源绑定 checksum/object key/size/MIME，已过期或拒绝权利不自动改为 APPROVED。实际操作者确认仅为当前原图的权利依据，不借审核账号。加工失败仅在用户显式重试时创建新 generation。
- 原图及衍生 asset/job/metadata 均为真实资源引用；CONTAIN 用途尺寸由既有媒体管线处理。最终 publication 仍完整检查当前媒体、来源链和权利，不依靠此前 READY 字样绕过当前证明。
- 价格 helper 复制当前完整价格簿并改一个实际 variant，发布精确返回的 revision/hash；库存使用实际 ledger 差额/版本并保护 reserved。两者与内容 head/operation complete 共用调用者事务，不另行 COMMIT。未改变原价格时间窗政策，也未宣称可在无效价格簿配置下直接上架。
- TEST 操作者实际拥有所需媒体/价格/库存权限，管理能力另真实授予。前置合成夹具的旧审核流程与用户的单人日常操作分开；简单提交没有轮换角色。窗口注入的是 TEST 会话的 HttpOnly cookie，不是验证过生产登录。
- session/CSRF/对象存储凭据只在运行时保留，任务存 actor/session ID、原文意图及摘要、checkpoint 和 lease 摘要。真实业务持久层仍是 PostgreSQL，图片仍为 S3 兼容存储。
- 当前 `--serve` 使用可清理的临时 TEST PostgreSQL/S3，约 110 分钟后或停进程会清理；它不能作为正式运营内容长期保存的环境。root 已在交接文档明确这一限制，本轮未扩建生产部署。

## 本作者库存修复证据

- `inventory-lock-contract-red.log` → `inventory-lock-contract-green.log`：新增字段/失败码有效 RED，合同 **15 tests PASS**。
- `inventory-lock-pg-red.log` 为旧行为诊断；首次 GREEN 尝试因 contracts dist 尚未刷新报未知字段，保留原日志。新 dist 后 `inventory-lock-pg-final-green.log` **13 tests PASS**。
- `inventory-zero-location-red.log` → `inventory-zero-location-green.log`：零数量也绑定真实库位；最终 **2 文件 / 14 tests PASS**。
- `inventory-lock-route-green.log`：真实 Fastify 注入，**3 tests PASS**，精确失败 schema/private cache/409。
- `inventory-lock-types.log`：PG/API 全类型 exit 0；`inventory-lock-lint-final.log`、`inventory-lock-format-final.log`：exit 0。

结论：媒体、价格及最新运行诊断未发现额外阻断；库存两个已知问题已由分工修复并交回 root 统一构建和真实验证。**整体验收仍未完成**，本记录不宣称真实管理链、故障恢复、全仓检查或生产发布已通过。

补充回读检查：艺人/礼物名称、说明、来源语言取当前 daily document；分类取同 revision leaf；价格与库存数字取当前真实业务表。多 market/currency 下原 LIST 总选字典序首价格 scope，可能使再次编辑回到另一个范围。经 root 明确授权，现改为取当前已发布 daily operation 的真实 market/currency 设置，并在当前真实价格簿中查询该范围；没有 daily 范围的 legacy 保持旧行为。所选范围的当前价格失效时返回 null，不静默换另一个市场。金额从未从 operation intent 回填。

该 scope 修改只有 `management-center-operation-read.ts` 与测试：`daily-price-scope-red.log` 1 项有效 RED；`daily-price-scope-final-green.log` 最终 **16 tests PASS**，包含 legacy null scope 回归；对应 format/lint/type 日志 exit 0。root 下一轮统一重新构建后才进入真实运行，本文不把旧 dist 的 runtime 结果当作新源码验证。

## 运行第十轮后的操作事件顺序修复（作者验证）

自然运行 `run-2026-09-07T22-42-41.039Z-09862a78` 的安全记录为 `UPDATE / 23514 / guard_management_operation:7`，首礼物停在 RUNNING v2、空 checkpoint。源码 UPDATE 不改该守卫检查的 immutable 字段，version 在锁定行上始终加一；自然记录没有保留新旧时间，因此只能将 `NEW.updated_at < OLD.updated_at` 识别为排除其它谓词后的匹配机制，不能宣称已测得系统时钟倒退。

受控探针 `packages/persistence-postgres/scripts/postgres-management-operation-clock.mjs` 运行完整原 0022 schema，真实授予 MFA 会话、management.direct 和原文 locale 权限，未 stub 或修改任何 SQL guard。它用较晚的 prior event 建立 RUNNING v2：原 raw UPDATE 实际触发 23514/原 guard，原编译仓储 checkpoint 实际返回 INTEGRITY_VIOLATION。最小修复只让仓储六处更新的事件时间取 `GREATEST(clock_timestamp(), updated_at)`；实时会话、权限、授权截止、租约和重试调度仍使用当前数据库 clock。没有扩大 lease，没有把事件时间当授权时间。

有效 RED 为 `operation-clock-repository-red.log`；此前 clock-red/diagnostic-red/seed-diagnostic/valid-red 为探针准备过程失败（审计与 grant 的独立 clock 不相等、参数类型冲突等），不是产品失败证明。`operation-clock-green.log` 为新编译适配器的真实 PG **12 assertions PASS**，覆盖 checkpoint/defer/fail 继续且版本只加一、保留较晚 prior time，以及撤销真实会话后仍拒绝修改。`operation-clock-unit-green.log` 为 **3 文件 / 19 tests PASS**；对应 build/type/lint/format 日志保留。探针最终使用 node 和现有私有 dist 模块，没有新增 tsx 依赖。

可重复命令：`mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test:postgres:management-publication`；新的时间探针已同时加入该定向入口和包内完整 `test:postgres`。本作者未重跑完整 PG 套件或浏览器，下一轮真实链由 root 统一执行；S.U.P.E.R #10 仍 PARTIAL。
