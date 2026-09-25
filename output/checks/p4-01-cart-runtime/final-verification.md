# P4-01 整合验收

当前状态：本地技术验收通过，P4-01 DONE。原整条 full3 的退出码仍为 1；以下分段结果共同覆盖原完整门，不能写成一次整条退出 0。

范围：匿名购物车初始化、读取、原子加购与恢复；不包含 P4-02 前端抽屉/编辑、P4-03 结账预占或支付。原 P3-06 性能、人工运营、读屏及关键译审验收保留。

## 已有证据

- `check-dev-5.log`：原日常整仓检查 exit 0，类型 60/60、测试 60/60、构建 35/35；使用部分缓存，非冷构建。此为早期检查点；后续修改的完整验证见下方最终收口。
- `contracts-independent-compatibility.json`：421 个旧合同根、79 个旧路径、139 个旧组件、2 个旧头、4 个旧鉴权定义不变；增加 27 根、3 路径、6 组件、2 鉴权定义。
- `migration-catalog-moderation.log`：实际 PostgreSQL 23 迁移 / 159 表 up/down/up；历史迁移 0001–0022 不变，当前 catalog 仅两函数定义差异。
- `pg-parameters-green.log`：真实 PG 14 断言，初始化参数类型与精确微秒、过期不写入。`pg-moderation-green.log`：3 断言，PENDING 正常提交，真正 AUTOMATED 缺证据仍拒绝。
- `pg-targeted-moderation-final-green.log`：18 个仓储/事务/迁移测试通过。Application 423 tests、KMS 53 tests 与 API 定向 15 tests 已各自通过。
- `../p4-01-cart/http-2026-09-08T09-08-10.384Z/results.json`：第五轮真实 HTTP / PG / TLS S3 5978 断言（含准备）、1903 次准备 API 请求通过；29 次购物车协议请求覆盖断开响应、同键重试、并发、跨会话、七语言、当前事实拒绝和隐私；PENDING 与 DYNAMIC 两种真实拒绝回退通过。
- `../p4-01-cart/http-2026-09-08T09-17-42.544Z/results.json`：第七入口 6029 断言含准备、1905 准备请求通过，3 次不同礼物 / 独立空车、无公开预读、无加购重试的首次 ADD 均 200；后置深层读取亦通过。第四轮的 CONTENT_UNAVAILABLE 未定位，保留为间歇风险；第五轮通过不称根因修复。第六入口仅为 TEST 诊断模块 import 错误，无服务启动。
- `scan-local-commit.log`：最终代码冻结后的工作区密钥扫描 exit 0。`dependency-audit.log`：固定 npm registry 的 high 级审计 exit 0，No known vulnerabilities found。
- `ci-runtime-budget-red.log` / `ci-runtime-budget-green.log`：Quality 的 20→30 分钟预算与精确配置门同步；Security 保持 20 分钟，原检查不删，非作者复核 ACCEPT。没有运行远程 CI。

- `shared-ui-refresh-review.md`：原 P2-04/05 浏览器采集器均 exit 0；P204 16 场景 / 18 PNG / 10 axe，P205 8 viewport 场景加动效矩阵 / 22 PNG / 3 axe。P204 0 violations / 4 incomplete；P205 有既存 3 moderate heading-order violations 和 3 incomplete，原 critical/serious blocking 门为 0，未修改门。两个原 checker 复验通过。root 看过日文桌面与越南语移动代表图，布局未见本轮新增异常。
- ROOT 仅将 TEST fixture 测试改名为 `cart-http-daily-fixture.test.mjs`，内容 SHA 不变，使原正式 glob 自动发现；`http-helper-discovery.log` 6/6 Node tests PASS。改名发生于完整检查 PG 阶段、早于 API cart 和全仓静态/类型/测试/构建，P2 指纹不含 API scripts。当时 1734 实现输入 SHA `866cb70dbf86c4bf16e0dfe0528b456ccbb9a1a7d6eaaee46db8c9215cae3a5c`；最终输入见下文。

## 收口过程与保留风险

完整 `check-full-2.log` 在 476.27 秒 exit 1：旧 publication-runtime HTTP request 16 的 COMMIT 被 PUBLICATION_PERMISSION 拒绝；前置全 PG suites 已通过。原源定向 `publication-runtime-directed-1.log` 又失败于另一 CLAIM_WINDOW，均保留。只增加现有 TEST 查询的权限匹配计数与相对时间后，`publication-runtime-directed-2.log` 11243 断言 / 1276 HTTP 请求 exit 0，未声称修复。

`natural-clock-observation.json` 在独立临时 PG 只读事务中用 8 秒 / 183 样本测到自然墙钟倒退 1 次 / 544403 微秒；同一时间 Node Date.now 无倒退，最大查询 RTT 6239 微秒。未修改时钟、SQL 结果或业务参数，实例正常关闭。该观测不反推原失败的具体 grant 谓词，亦不证明生产时钟可靠。

第三次完整检查使用 `check-full-3.log`；最终实现输入 1734 项 SHA `57cf44e3d4e2667340912c102e217161de23906de19fae4e7aae478a5d076d65`。与上次仅新增上述 TEST 查询统计，已获非作者只读 ACCEPT；P2 指纹不涉及该 API 脚本。原始退出码、后缀验证与最终差异核对见下方最终收口。

所有运行均使用 Node 24.20.0 / pnpm 11.25.0。KMS 是生产适配器配显式 TEST 远程边界，不是 AWS/IAM 实测；没有 PSP、真实扣款、生产或新的物理手机证据。早期失败原文保留，没有删失败、改断言或降低门禁来冒称通过。

## S.U.P.E.R 整合检查

| #   | 结果 | 依据                                                                                            |
| --- | ---- | ----------------------------------------------------------------------------------------------- |
| 1   | PASS | 合同、纯决策、事务编排、私密加密、会话传输、PG映射与装配各自单责                                |
| 2   | PASS | 加购函数只编排一次原子加购；认证、重放、当前事实与视图分别封装                                  |
| 3   | PASS | Route → Application → cart/content → Port → Adapter，纯cart无服务依赖                           |
| 4   | PASS | 新合同/端口采用内向依赖和type-only引用，独立边界检查与非作者复核无循环                          |
| 5   | PASS | 跨模块值严格schemaVersion/Zod，旧421合同根兼容验证通过                                          |
| 6   | PASS | 公私有DTO可序列化，BigInt仅内部金额计算，client/KMS对象不出装配边界                             |
| 7   | PASS | 生产运行从既有环境配置读取市场/域名/密钥，固定值仅显式TEST夹具或有界TTL默认                     |
| 8   | PASS | cart/application/API/KMS所需工作区依赖和锁文件明确登记，无新增第三方版本                        |
| 9   | PASS | PG、KMS、HTTP经Port与装配替换；业务不依赖具体SDK/SQL                                            |
| 10  | PASS | 全部原前缀PG/HTTP/S3与未改的完整质量后缀通过；1734实现输入逐SHA不变，非作者确认分段覆盖完整原门 |

非作者复核：storefront_read 接受合同兼容、Application/KMS/PG/API/CI预算/TEST统计；storefront_directory 接受 root Application/KMS/生产装配与已读测试范围。没有用作者自述代替未完成的整仓门。

## 最终收口（2026-09-08T10:07:46.800105+00:00）

- `check-full-3.log`：1247.50秒，全部原前缀、PG/HTTP（发布12337断言/1406请求；购物车6029含准备/1905准备请求、6个Node helper tests）、S3与媒体恢复423断言通过，Prettier通过；仅output-only时钟诊断脚本两处URL no-undef导致整条exit1。
- 只增加 `import { URL } from "node:url"`，两处用途和采样逻辑不变；实际验证URL与原globalThis.URL是同一构造器，单文件format/lint通过，未覆盖原始自然时钟观测。
- `check-full-suffix.json` / `.log`：33.578秒exit0，命令逐字等于根check从Prettier至build-artifacts的完整原后缀。格式/lint、类型60/60（56缓存）、测试60/60（56缓存）、构建35/35（34缓存）、adapter与31真实Node出口通过。1734实现输入与先前PG/HTTP/S3时逐SHA完全相同，未重复未受影响的集成。
- 非作者storefront_read独立验证输入SHA、后缀原命令、两个退出码及覆盖范围，ACCEPT；S.U.P.E.R 10项通过。旧失败记录与当前环境时钟风险继续保留，未宣称根因修复。
- 原P2浏览器刷新、密钥扫描和依赖审计通过；此结果仅限本地TEST技术范围，P3未完验收、真实KMS/IAM、PSP、生产与当前物理手机证据不在本轮完成范围。
