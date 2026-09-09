# P4-04 通用支付接入检查点

状态：通用支付接入本地检查点验收完成；P4-04仍IN_PROGRESS，真实商户 PSP 与资金验收未完成。

## 范围

- 新 payment-gateway 模块：静态工厂、全量已发布配置投影原子装配、历史连接保留；Application/API 可读取运行中新增目录。没有新增 PG 商户发布入口或后台表单。
- 通用自有协议：七支付操作、配置来源的卡品牌/3DS/捕获 profile、凭据引用解析/轮换、总截止、HTTPS/响应边界与严格关联、独立 Standard Webhooks 候选验签。
- USDT：独立网络/token/精度/确认数与报价/认证观察合同，BigInt 精确金额和入款时序评估。当前通用 HTTP 工厂只 CARD/LOCAL_PAYMENT，USDT 需专用 mapper、持久 quote/attempt 关联与真实渠道验收后启用。
- 金融权威、PG 路由、订单金额/locale/attempt冻结、UNKNOWN不换路、私密字段、库存与P4-05边界不变。

## 定向结果

均使用 mise exec node@24.20.0 -- corepack pnpm：

- 新网关完整包：8 文件 / 97 测试，exit 0，gateway-final-tests.log。包含作者24、registry30、stablecoin40、factory2与出口1。
- contracts 的 connector/stablecoin/artifact-registry：3 文件 / 53 测试，exit 0。
- Application payment-runtime：3 文件 / 30 测试，exit 0；API composition：5 测试，exit 0。
- 相关4包 typecheck、相关3包 build 与范围 lint/format exit 0；workspace 4 apps/32 packages/36 units 与 adapter边界通过。
- 原P2-04/P2-05采集器通过，结果 browser-refresh.json。P2-05原 moderate/incomplete及physical-device门继续保留，不新增真机证明。首次P2-05因并行施工期间工作区状态改变被原守卫拒绝，冻结后原命令复验通过；没有改守卫或替换通过结果。
- secret scan 与 npm官方registry high audit exit 0。

## 兼容与源

539旧合同根逐对象一致，新增11内部根至550；92旧paths/171旧public components逐对象一致；全部52份旧SQL字节一致，未新增迁移。详情 compatibility.json。

1998 实现输入冻结，SHA `dcaf38f0a4cb8e926b3477c4db212a24d46085a6fd248dbe290e733e10c27ea2`，源清单 source-final.json。最终1998实现文件集合及字节均与冻结一致，初始2361未跟踪文件逐SHA完整保持。详情 source-protection-final.json。原后台Next测试曾自动改写两个route/root-params类型导入为dev路径；已归档并精确恢复，见 generated-type-provenance.json，不宣称过程中零暂态变化。

## 原整仓门

原单条 pnpm check 在1350.252秒 exit1，旧checkout daily READ_OPERATION被FORBIDDEN拒绝。真实failure.json为ASSERTION/ERR_ASSERTION、7161断言；外层仅有RUNTIME/null。只读定位到management.direct角色/权限JOIN未命中，尚无候选行/授权时间证据，无法确认根因，更不能推断是宿主时钟。未改旧授权、时限或checkout源码；原入口同源码107.775秒复验exit0。

- 原检查展开38步骤全部取得通过证据，见 gate-coverage.json。**不是单次完整check exit0**。
- checkout复验：20cases/195请求，5760准备+1645协议=7405断言，另8项拒退；payment-runtime：5761准备+801协议=6562断言，另8项拒退及30表保护；真实独立HTTPS TEST PSP的11项测试包括丢响应/持久状态/进程重启/托管返回。真实PSP sandbox仍false。
- 实际26迁移/168表往返、原PG/API/TLS S3门通过；媒体worker423断言通过。
- 首次后缀执行器使用裸sh导致prettier不在PATH，exit127；仅恢复原pnpm脚本的本地bin环境后执行原命令，无项目脚本/依赖/源码修改。
- 质量门format/lint、类型61/61（29缓存）通过；首次全仓测试60/61通过，旧artifact-documents确定性生成测试7224ms超过原5000ms。源码与阈值不改，原turbo test复验61/61（60缓存）通过；构建36/36（31缓存）、adapter边界与32个实际Node出口通过，最后4命令20.742秒exit0。这项间歇时限风险保留，不声称根治。
- 精确命令/各段退出和缓存见 check-full-result.json、check-remainder-result.json、quality-final-result.json、quality-recheck-result.json；原失败日志均保留。

## 流程与风险

合同拒绝非法配置、API动态目录、adapter边界、静态工厂与三位作者的行为均保留有效RED→GREEN。初次相对日志路径/中间品牌类型与并行源码尚未存在等开发失败保留，不当成产品回归或隐藏。详见各范围验证记录。

S.U.P.E.R 10项在本轮本地范围通过；第10项采用原38门的逐步通过证据，明确保留原失败及分段复验范围。见 final-independent-review.md。仅本地提交、不push/PR/merge/部署。

不包含真实PSP/sandbox/3DS或卡网络资格/USDT链上收款、Secret Manager具体云adapter、PG商户配置author/publish/广播或管理中心入口、P4-05支付终结/库存/查单通知、正式资产译审/新真机验收。旧发布授权/CLAIM_WINDOW/合同测试时限间歇风险不因本轮成功重试而宣称根治。
