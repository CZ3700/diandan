# P4-03 最终独立验收

**ACCEPT。** 原单条 `corepack pnpm check` 实际 exit 0，2026-09-08T14:47:39.818Z → 15:11:42.141Z，用时 1442.42555 秒。证据为 `check-full-1.log/.json`，不是局部 PASS 字样或替代后缀；独立监控已结束。该结论是本轮本地任务验收，不是生产发布。

## 完整覆盖与冻结源

- `gate-coverage.json` 由原 root check 和 PostgreSQL/S3 完整嵌套 scripts 派生，30 scripts / 125 记录步骤全部 PASS，包括正式注册的 outbox-event-time、全部 PG/HTTP/S3、prettier、eslint、typecheck、test、build、adapter boundaries 与 31 package exports 的 build artifacts。125 是脚本中的步骤记录数，不是 125 个互不相关的全新进程。
- 保留原 Turbo 缓存：最终 typecheck 60/60 成功、56 cached；test 60/60 成功、56 cached；build 35/35 成功、35 cached，remote caching disabled。这些是含依赖的任务数，不是单元测试数；没有声称全部重新执行。
- 额外 `security:secrets` 实际 exit 0，35.738 秒，`secrets-final.json`；它是独立附加检查，不伪称原 check 的子项。
- 审阅者独立重算全部 1856 个当前文件 hash，并用同 scope 的 Git tracked/untracked 源路径集合核对：changed/added/removed 均空；与 `source-final.json` 和 `source-after-all-checks.json` 完全相同，SHA-256 `cd848a5ab50fd8f629c5a668068acde7465295827133c0d84507d148b3f0c95e`。6 个 gate manifest hash 也未变化。
- Admin Next dev 临时生成改写由 root 完整归档后恢复；审阅者独立确认当前 next-env 字节 SHA 与冻结项相同。见 `admin-next-env-transient.txt`、`admin-next-env-restore.json`，未将恢复当成产品逻辑修改。
- 独立以内存读取 Git 基线 `059dd9d70ab9212db9670a0e2fc47fcef460dbb0` 比较：48 个旧 up/down SQL 文件逐字节不变；468 个旧 JSON roots 逐值不变（当前 502）；旧 OpenAPI 152 schemas / 84 paths 逐值不变（当前 161 / 87）。没有重新生成 artifacts 或修改旧根。

## 最终实际 HTTP 与边界

以完整 check 内的 `run-2026-09-08T15-08-09.257Z/protocol-results.json` 为最终来源：5760 setup + 1643 protocol = 7403 assertions，20 cases / 195 cart-checkout 请求；setupRequests 1902、protocolOperatorRequests 87 分开记录。另实际 0025 拒退 8 assertions，21 表 before/after 计数与 hash 完全相同。定向第五轮 7404 仍保留为独立历史；到期轮询的自然计数差一不改变覆盖。

真实覆盖：七语历史订单、中文 daily source provenance、价格 1500→1637 及原车显式确认恢复、同键并发与丢响应恢复、TRACKED 同库存聚合与非库存重复售卖、quote 真实到期、状态失效、私密最小响应、精确 durable fulfillment event 和破坏性退库拒绝。最终 result 标明 ownedFixtureCleanupAttempted=true、browserStarted=false；本审阅者未创建服务或浏览器。

实际 PostgreSQL、TLS S3、TEST KMS adapter 与原生 HTTP 已验；实际 AWS KMS、checkout 浏览器 UI、PSP、扣款与生产发布未验。P4-03 为预检/订单创建，支付及后续 UI、既存 P3 人工/上线门不在此被宣称完成。

## 审阅者界限与 S.U.P.E.R

审阅者是新 contracts/domain/port 的作者，该部分自身验证不冒充独立验收；独立源码复核覆盖 Application/API/PG/0025 与真实 HTTP oracle，并结合 PG 作者对领域库存分配的独立复核。各早期 HTTP FAIL、canonical 字符串静态审查漏判、探针夹具错误和窄修证据保留在 `http-independent-review.md`，不改写为成功。当前无未处理实质阻断；未追加功能或无关重构。

| #   | 检查                                                        | 结论 |
| --- | ----------------------------------------------------------- | ---- |
| 1   | 新模块职责明确                                              | PASS |
| 2   | 解析、纯决策、事务编排、存储与公开投影分别承责              | PASS |
| 3   | Route → Application → Domain/Port → Adapter，无反向业务依赖 | PASS |
| 4   | 无新增循环导入，完整边界门通过                              | PASS |
| 5   | 跨模块新对象由 versioned schema/port 定义                   | PASS |
| 6   | 合同可序列化，私密正文不进入普通公共 DTO/日志               | PASS |
| 7   | 地址、密钥、KMS 和事务时钟由配置/真实依赖提供               | PASS |
| 8   | 新运行依赖明确声明                                          | PASS |
| 9   | 仓储、KMS、transport 经窄 port 替换                         | PASS |
| 10  | 最终冻结源的全部本轮验证通过，缓存范围如实披露              | PASS |
