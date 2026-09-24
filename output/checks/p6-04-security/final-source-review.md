# P6-04 冻结源码非作者收尾复核

结论：本轮未发现需要解除冻结并补修的缺陷；必要修复已收敛，未提出纯风格重构。此结论针对 TEST mail GCM、RUM v2、root CI/依赖变更，**不构成 edge 的独立验收**：本复核者是 edge 作者，edge 由 security_scans 独立核对。没有修改冻结产品源码、合同或配置。

## 复核结果

| 范围          | 结论与证据                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST mail GCM | `apps/api/scripts/local-experience-services-mail-store.mjs:22` 的实际修复只有 `authTagLength:16`，阻止接受缩短标签。加密仍为随机 12-byte IV、AES-256-GCM、notification identity AAD；schemaVersion=1、iv/tag/ciphertext 序列化格式和正常 16-byte 标签保持。解密只在 final 验证后 JSON.parse，未放宽错误路径。8 条现有测试验证 4/8/12/15-byte 截断、IV/tag/ciphertext 篡改、错误 key/identity 和正常格式。 |
| RUM v2 聚合   | `packages/observability/src/rum.ts:144` 先验证既有窗口/输入上限，严格解析记录，只对 [start,end) 数据去重；identity 或相同 revision 的 value 冲突会隔离该 key 的全部记录，包括已见和后续 revision。其他 key 保留，整个窗口及所有行明确 DEGRADED，不产生预算通过结论。正常样本继续复用既有 p75/采样/来源/最低样本规则。                                                                                     |
| RUM 合同      | `rum-report-v2.ts` 是独立、内部 schemaVersion=2 报告；计数守恒、行总计、DEGRADED 与冲突一致性受运行时 refinement 约束，且禁止额外原 key/PII 字段。既有 RumIntake/RumObservation/RumReport v1 与 aggregateRum 未变。artifact-registry 仅新增 internal RumReportV2；没有订单、支付、退款、身份业务 schema 或 migration 改动。                                                                               |
| RUM 依赖方向  | rum.ts 将已定义 v1 schema 传给 factory；factory 对 rum.ts 的反向引用是 `import type`，实际编译的 rum-report-v2.js 只导入 zod，不存在新增 runtime 循环。observability → contracts，CLI → runtime exports 的依赖方向保持。                                                                                                                                                                                  |
| CLI / 看板    | 新 CLI 固定产出 v2，历史 v1 仍解码并注明 LEGACY。冲突报告只输出计数，stdout 始终 fieldAcceptance:false；CLEAN 明确不证明匿名数据真实。HTML 内嵌 JSON 转义 < 与 &，渲染使用 textContent，不把原日志/measurement key 注入 HTML。输入文件数/字节/行/记录上限、独占输出 wx、损坏日志 fail-closed 和错误不反射 PII 保留。                                                                                      |
| Next 修复     | 两应用、Next ESLint plugin 和 lock 一致固定 16.3.6；lock 变化限于 Next/env/swc/plugin 补丁。3 项 guard 检查版本范围、所有 Next resolution 和 manifest/importer 一致。官方公告确认影响范围 >=16.2.0 <16.3.6，修复版本 16.3.6；guard 的闭区间判断匹配该公告。                                                                                                                                               |
| CI            | security job 仍 frozen install、官方 registry 高危 audit、secret scan，增加 guard 与 security regressions；check-ci 同步强约束脚本/步骤，直接执行通过。security:regressions 先 build observability 及依赖，包含需要的 contracts 产物；mail common/OIDC helpers 仅内置模块，无遗漏 workspace build 依赖。未新增依赖或扩大权限。                                                                            |

Next 依据为 [Vercel 官方 GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)，本轮已在线核对。公告为 Node ImageResponse 接受攻击者 SVG 内容时的条件性问题；不能仅由安装受影响依赖推断仓库存在可利用 RCE。

## 收敛与可读性

mail 单点限制比额外手写标签格式规则更直接；RUM v2 复用 v1 shape 和最终聚合，避免复制 p75/预算逻辑。新增 identity/revision/quarantine 状态各自单一职责，先收集冲突、再过滤的双阶段流程保证较早记录不会漏隔离。新增 dashboard 三种完整性文案的局部表达式不构成必须修改的维护问题，冻结期不为纯风格扩大 diff。

保留的匿名 RUM 限制是产品明确设计：冲突可导致 DEGRADED，但不用于证明真实性或 release acceptance；此变更保障有冲突时仍可查看其他记录，未把匿名测量升级为可信数据。

## 本轮实际执行

所有命令直接使用 Node 24.20.0，没有 pnpm install、服务启动、PG 或浏览器负载：

```sh
mise exec node@24.20.0 -- node --test apps/api/scripts/local-experience-services.test.mjs
mise exec node@24.20.0 -- node --test scripts/security-dependencies.test.mjs scripts/render-rum-dashboard.test.mjs
mise exec node@24.20.0 -- node scripts/check-ci.mjs
```

- mail/local services：**8/8 PASS**，`final-review-mail.log.txt`。
- 依赖 guard + RUM CLI：**6/6 PASS**（各 3），`final-review-node.log.txt`。
- CI contract：**PASS**，`final-review-ci.log.txt`。
- contracts 两文件：**3/3 PASS**，`final-review-rum-contracts.json`。
- observability 两文件：**15/15 PASS**，`final-review-rum-observability.json`。

两个 Vitest 命令在对应 package cwd 使用 `mise exec node@24.20.0 -- node ../../node_modules/vitest/vitest.mjs run --config ../../vitest.config.ts --root .`，contracts 选择 src/rum.test.ts、src/rum-report-v2.test.ts；observability 选择 src/rum.test.ts、src/rum-v2.test.ts。合计 **32 项测试**及 CI contract 检查通过；该总数是本轮独立收尾样本，不和此前 360 项授权测试相加冒充去重总量。

## 边界与后续证据

本报告源码指纹见相邻 JSON。未执行 root 的 19-step 综合验收，也未将其标成通过；可在 runner 完成后独立核对其 frozen source 指纹、逐步命令退出码、真实 PG/browser 结果、清理及用户旧数据保护证明。edge 独立结论由 security_scans 提供。

补充证据可见性：`iac-final/` 的原 14 个 .log 始终在本轮新目录；`rg --files` 默认忽略 .log，因此另复制同名 .log.txt 便于交付。这不是日志丢失，也没有调用默认 CLI 改写旧 p5-08 证据。
