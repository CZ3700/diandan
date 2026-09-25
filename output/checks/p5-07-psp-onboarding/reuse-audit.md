# P5-07 conformance 与灰度演练复用审计

Reviewer：`/root/exception_storage`，2026-09-22；基线 `e818577617078fc70436d87a5e70f183d8aecd7c`。只读规范、现有源码和已验收证据；未跑构建、Next、PG/HTTP 集成，未改实现/进度、未领取第二 Task。此报告是演练设计输入，不是新演练已通过的证据。

## 最小复用方案

1. 直接运行 `runPaymentProviderConformance(createFakePaymentProvider())`，保留完整 `payment-provider-v1` 的 15 cases，核对七操作集合。已有 fake `index.test.ts` 和 gateway `conformance.test.ts` 可回归；后者通过 CA 验证 TLS 接独立 TEST 上游，并有五种语义错误反证。`runLegacyWebhookParserConformance` 只有旧解析拒绝兼容检查，不替代新 webhook ingress 验签。
2. 真实分级演练优先复用 `withOrderAccessFixture` + `createAdminPaymentConfigurationFixture`，共用真实 PG/TLS S3/OIDC、两个独立 API 子进程/独立 pool、持久 TEST PSP。新 runner 可复制旧 runner 的小型生命周期装配，协议另成一模块，不再启动 Admin/Next 浏览器。
3. 复用 fixture 返回的 `login/command/configurationDocument/waitForGeneration/nodes/restartSecondNode`。每阶段走正式 `save → submit/approve → validate → publish`；首次七语由七名已授权独立 reviewer 批准，之后相同文案用原审核继承路径。每阶段存 revision/publication/generation、实际 PG 两级 basis points、双节点观测和耗时。停止保留非空路由包；回退对历史 revision 用 `mode:ROLLBACK` 获取新 validation，再发布新单调 generation。
4. 主放量用账户 500→2500→10000，规则保持10000，这才分别表示约5%/25%/100%。同一组真实创建的 checkout 在每阶段跨两API、七种 presentation locale 重查，并用当前不可变 rule UUID 算 PG/Domain 双桶结果。每阶段要有拒绝/准入并各做一次真实 create；不要伪造 session UUID 或仅改响应证明资格。概率 cohort 需要有界生成，失败报可复现身份集合；若只做很小随机样本，不能把实现正确性等同实际比例精确等于5%。
5. 补独立两级 AND 向量：账户5%×规则5%交集约0.25%，含 provider 通过但 rule 排除、反向、等于边界拒绝、两者通过。规则版本新UUID会重新分组；不能承诺新 revision 的 rule 桶单调继承。账户桶可在同账户固定，而各阶段新 rule 都100%时不会影响主放量群组。
6. 在切配置前通过真实 PSP 接受后丢响应创建原账户 A 的 UNKNOWN。停止/改到 B 后，走原公开 recovery 或 P5-06 reconcile；比对原 attempt/provider/environment/adapter/config-rule版本/key、原 PSP 对象及调用计数。关闭只阻止新 create，不禁 webhook、查询、退款、reconcile。重新启动API/Worker后再恢复，并确认没有第二付款/退款/履约/通知。

## 现有验收能复用到哪里

| 入口 | 已有证明 | 本轮仍需补 |
| --- | --- | --- |
| `packages/testing/src/conformance.ts` | 15 cases；关联匹配、取消、可信capture、部分退款、原响应重放、退款冲突/超额拒绝、付款及退款核实 | 本轮实际调用与安全结果归档；不删失败case |
| `packages/payment-fake/src/index.test.ts` | TEST-only及15 cases；LIVE命令拒绝 | 新drill明确只TEST，无生产声明 |
| `packages/payment-gateway/src/conformance.test.ts` | 相同15case、七操作、真实TLS、五错误反证 | 仅属仓库通用协议，不等于任意商业PSP沙盒认证 |
| `payment-rollout-postgres.mjs` | 4099组TS/PG桶一致、严格边界、UUID大小写/非法scope、0034 DDL往返和原receipt guard | 不是整条checkout准入；没有逐阶段管理发布 |
| `payment-rollout-http.mjs` | 真实checkout的100%账户×50%规则，双API/七语保持、客户端造seed拒绝、两层PG防绕、0%停止和旧UNKNOWN恢复 | 未跑internal→5→25→100全梯度；两API同Node，别称部署级双进程 |
| `admin-payment-config-protocol.mjs` | 正式管理发布/七语独立审核、丢响应同键、真实双API子进程传播、旧A恢复、新B创建、0%停止、回退/重启/锁超时 | 可直接承接新梯度循环；原序列100→0→100不是完整五阶段 |
| `payment-rollout-publish-fixture.mjs` | 旧合法SQL publication用于停止测试 | 不作管理端发布权限/审批/同键证明；新演练用P5-05接口 |

## internal 的准确含义和当前权威差异

- 当前没有员工 audience/allowlist 或 `internal` 灰度模式；`payment_provider_accounts.status=INTERNAL` 是账户状态。Application `eligiblePaymentRoute` 只允许 INTERNAL+TEST；配置domain及0036发布SQL也拒绝 INTERNAL+LIVE。因此本轮 internal 应明确为隔离TEST环境/受控测试访问，不能称生产内部用户放量已实现。5%也不是身份授权。
- **已撤回的假设与真实边界**：`payment-runtime-write.ts` 的 `beginPaymentCreate` 与0034 receipt guard只显式检查账户status属于INTERNAL/ACTIVE；Application、配置Domain、0036发布SQL及health context额外拒绝 INTERNAL+LIVE。最初怀疑 ACTIVE+LIVE 发布后改为 INTERNAL，但0005:3191 的 `payment_provider_accounts_identity_immutable_trigger` 同时冻结 `status` 与 `environment`，0006—0037没有替换该trigger，故该合法迁移路径不存在。现有正常发布拒绝 INTERNAL+LIVE；fake也拒绝LIVE。本轮未发现合法生产触发证据，不构成当前越权/本轮阻断，不建议新增迁移或修改旧SQL。通用静态registry/schema可表示LIVE，不等于当前已部署真实LIVE商户。若后续新增账户状态管理或真实LIVE binding，P6-04/实际接入应明确复核所有权威层对 INTERNAL+TEST 的一致性及转态权限；不可用绕过trigger的SQL制造当前漏洞结论。
- 已有两层比例保护可复用：`beginPaymentCreate` 从受权canonical checkout/route重算PG桶；deferred receipt guard在COMMIT再绑定真实session/account/rule。`verifyRolloutGuards` 第一轮只污染readprojection验证409；第二轮同时伪造一次admission结果验证真实COMMIT23514+全事务无痕+PSP未调用。此类隔离注入须单独注明，不冒充普通HTTP成功路径。

## 演练失败门与报告口径

拒绝跳阶段或把failed report当passed；审批缺失/过期校验hash/权限撤销/旧版本/同键异body/客户端seed均应失败。各阶段双节点传播≤60秒，停止与回退计时从真实命令开始，明确fixture轮询1秒而生产默认10秒。用原幂等恢复，永不换key试探不确定请求；保留早期失败和cleanup。

输出只保留安全ID、版本、桶、数量、耗时、断言与源码SHA，不存 session/CSRF/token/merchantAccount/credentialRef/原webhook或私密正文。标明真实PG/双API/持久TESTPSP与无真实资金、非商业sandbox、无生产apply。本轮没有产品UI改动时不必重复原七语浏览器矩阵，但七语路由不变仍可走HTTP验证。

`P5-07` 原最低验证就是 fake完整conformance/灰度和商户决策门；代码→商业sandbox→真实小额→生产灰度应成为手册阻断清单，不以未接多余真实渠道另造本Task的完成要求。
