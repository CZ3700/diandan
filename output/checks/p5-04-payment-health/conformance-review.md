# Gateway shared conformance 补齐

范围：`packages/payment-gateway/src/conformance.test.ts` 与该包 `package.json` 的 `@fan-support/testing` devDependency。未修改 client、共享 suite、Domain/UI、历史 TLS tests 或任何生产实现；root 统一维护 lockfile。

## 实际测试对象

- 直接调用现有 `createGatewayPaymentProvider`，再交给 `runPaymentProviderConformance(provider, fixtures)`；未包装或转发 FakePaymentProvider，也没有复制共享 suite 的判断规则。
- 共享 fixture 只替换网关账户、卡方式、return/cancel origin 和 external reference；15 个原场景、金额、幂等键、审计 ID 和执行顺序不改。
- HTTP 经现有 `harness.tls.ts` 的 node:https 服务、独立 TEST CA、精确 SAN 和 `rejectUnauthorized: true`；系统信任不变。服务端按实际七操作命令维护支付、取消、捕获和退款记录，重放读取已有回执，冲突/超额由记录判定，不按调用次数返回预制的15份成功响应。
- 正向用例要求共享 15 cases 全过、恰好15个真实 HTTP请求覆盖全部七操作，并验证方法/路径/Authorization/merchant/protocol、实际幂等请求头及 instrument。取消后的退款不被接受，捕获付款只保存一笔退款且金额不重复累计。
- 五项负例分别注入错误关联、退款回放漂移、忽略幂等冲突、忽略退款余额和复用对账 event ID；真实 gateway 与原共享 suite 必须拒绝对应场景。生产代码没有增加故障开关。

## 已执行结果

| 入口 | 结果 | 记录 |
| --- | --- | --- |
| 定向 prettier --write 两个自身文件 | exit 0 | `conformance-format-initial.log/json` |
| gateway test src/conformance.test.ts | exit 0；1 文件 / 6 tests | `conformance-initial.log/json` |
| 新测试文件 ESLint | exit 0 | `conformance-lint.log/json` |
| gateway typecheck | exit 0 | `conformance-typecheck.log/json` |

这是对已有 gateway 的新增认证覆盖，首次真实运行直接通过，没有观察到产品 RED，也未人为制造 fixture 失败。五个故障拒绝用例均是通过的负向验证，不能将其宣传为产品先失败后修复。

未运行全仓 build/check、合同生成或其余 gateway tests；与 health/client 的其他并行改动合并后的验证由 root 统一完成。该受控 TEST 上游仅证明本仓库通用 gateway 的端口/传输及 shared suite 行为，不证明任何真实 PSP、商户资格、官方 API 映射、真实退款、3DS、卡网络或资金验收。S.U.P.E.R 在本子任务只涉及测试隔离、显式 devDependency、序列化端口和边界不变；完整 P5-04 验收由 root 汇总，不能据这6个 tests 标整个任务 DONE。
