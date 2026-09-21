# 支付健康与稳定灰度的本地复验

本入口使用仓库拥有的临时 PostgreSQL、S3、HTTPS TEST 支付进程和合成账户。通用 gateway 的认证服务也仅用于本地规范化协议验证；它们不代表真实商户、Visa/Mastercard 网络认证、USDT 专属接口或真实资金验收。

## 运转方式

- 首次部署给每个账户和环境明确提供 `PaymentHealthPolicy`。API 的 `FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON` 必须与已部署绑定完整对应，PG 保存不可变版本；重复启动只验证同值，不自动覆盖策略。后续运营发布属于 P5-05。
- 技术失败在 PG 时间决定的固定窗口中累计，普通成功不清窗口，业务拒付、取消、停售和配置错误不计技术故障。达到阈值时同事务追加健康事件并暂时停止新付款资格；实际新创建仍在数据库里重验。
- API 既有恢复循环独立调用有界健康探测；无待恢复付款时也能探测。PG 跨实例领取、代际、租期、账户版本和策略版本共同约束结果。仅用先前实际结账产生且当前发布配置仍允许的 `GET_CAPABILITIES` 上下文，不拼凑金额/市场，不调用任何资金操作。失败和成功的有效探测留存受限证据，过期成功不能恢复渠道。
- 健康写入故障关闭新付款资格，但已发出的创建或可信对账继续原结果落库；不得把监测失败当作未扣款后再创建。不可达 adapter 的探测有本地截止时间，迟到响应被忽略；不具备 abort 的 adapter 请求仍由其自身传输截止时间清理。
- 健康事务默认共享 3 秒总截止时间，覆盖连接领取、SQL 和提交；超时连接销毁，提交中断仍按结果不确定处理。部署代码可通过 `paymentHealthTimeoutMs` 在 100–30000 毫秒内调整，不改变资金事务的超时策略。恢复循环每轮最多初始化一个健康策略，失败账户轮转，避免大量配置账户串行阻塞原付款恢复。
- 空能力列表表示通信成功而无可选产品；全部停售或金额不适用属于业务结果，不新增技术故障。已熔断账户只接受成功探测恢复，业务不可用结果继续保守等待。账户健康与路由启停始终分离。

## 灰度规则

服务端授权后的 checkout ID 分别与 provider account、route rule UUID 进入 v1 稳定算法。两个桶各在 0–9999，分别小于各自发布比例才有资格。0 全关、10000 全开；两个层级都为 5% 时交集约为 0.25%。它是非保密流量分配算法，不是身份凭证或人数配额。

同一 checkout/provider/rule 不因语言、重试、服务实例或比例阈值变化重新抽样。新发布若创建新 rule UUID，其规则桶可能改变；已创建 attempt、永久回执和 UNKNOWN 不重新分桶。Application、PG 首事务和延迟约束都分别重算；客户端不能提交自己的桶或种子。

## 复验命令

仓库根目录执行，Node 固定为 24.20.0：

```sh
mise exec node@24.20.0 -- corepack pnpm exec turbo run build --filter=@fan-support/api
mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/migration-manifest.mjs --check
mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/payment-health-postgres.mjs
mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/payment-rollout-postgres.mjs
mise exec node@24.20.0 -- node apps/api/scripts/payment-health-http.mjs
mise exec node@24.20.0 -- node apps/api/scripts/payment-rollout-http.mjs
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/payment-gateway test
mise exec node@24.20.0 -- corepack pnpm verify:payment:browser
mise exec node@24.20.0 -- corepack pnpm check:dev
```

真实 PG 灰度向量与迁移检查脚本、最终命令/计数、失败原始记录和非作者复核见 `output/checks/p5-04-payment-health/`。`check:dev` 不包含 PG/S3/浏览器，不能代替它们。旧 rollback probe 只允许明确列出的空迁移前缀，政策、观测或其他业务审计非空则拒绝回退；不要删除历史来通过检查。

## 诊断与后续

先核对绑定账户/环境、不可变政策版本和发布规则，再查看受限观察代码及探测来源。`POLICY_CONFLICT` 是配置漂移，不能靠覆盖旧行解决；没有安全上下文或路由比例为 0 时保持关闭，不能随便挑一个国家或金额发探测。已有付款问题通过原 attempt 的认证对账处理，不换 provider、不换支付幂等键。

0034 的回退需要与对应应用版本一起操作：新版付款创建依赖新增数据库函数。当前下迁移证据是隔离环境的 DDL 往返，不能据此执行生产回退；0033 一旦已有健康策略或观测历史会拒绝回退，必须保留这些记录。

正式策略阈值、已批准 PSP 的实际签名/能力映射、sandbox/真实小额、正式 Secret Manager、staging 与灰度验收仍按原任务完成。管理中心配置发布和退款/异常队列由后续 P5 任务接入，本阶段没有增加运营表单负担。
