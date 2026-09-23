# P5-08 本地体验规格复核

状态：`REVIEW_OPEN_PENDING_END_TO_END`。本报告是当前源码的规格与安全边界复核，不是完整本地验收、云部署或生产发布批准。

审查者：Codex `/root/p508_iac`。依据 `docs/FAN_SUPPORT_PLATFORM_SPEC.md`、P5-08 原任务、`docs/plan/p5-08-local-deployment.md`、`docs/runbooks/local-experience-readiness.md`、ADR-007/016。审查限制为本轮统一本地体验与离线基础设施入口，不增加其他阶段范围。

## 作者边界

本审查者未实现 root 的启动器/状态/基础服务编排，也未实现 runtime/services 的业务组合，已完整阅读本轮 `scripts/*local-experience*.mjs` 和 `apps/api/scripts/local-experience*.mjs` 中的实现、专项测试与集成/浏览器入口。文末记录本次源码快照。

本审查者是 `infra/opentofu/**`、离线检查脚本/runbook，以及后续被 root 委派的 `apps/api/scripts/local-experience-browser-operations.mjs` 的作者。**这些文件不获得本报告的非作者实现批准**；root 已独立阅读支付 UI helper 并报告未发现问题，仍须统一真实浏览器执行。此处仅核对 IaC 输出与文档是否如实标明范围。

## 规格逐项核对

| 必需范围 | 当前实现与判断 | 证据边界 |
| --- | --- | --- |
| 同一持久 PostgreSQL 和媒体 | supervisor 统一建立基础设施并传递同一业务数据库与 S3 引用；API、独立 Worker 使用同一事务存储。媒体源/派生文件保留于实例目录，停止不清数据。 | 代码与独立专项用例符合；最终上传文件、业务记录及重启比较须实际验收。 |
| 实际本地 OIDC | 真 TLS discovery/JWKS/授权码/PKCE/token exchange；固定签名 key，真实生产 OIDC adapter 验证返回身份；平台权限从业务 PG 读取，IdP 不颁平台角色。界面明确 synthetic identity/simulated MFA。 | Node 24 下实际 TLS 与 canonical adapter 用例通过；浏览器完整身份路径仍需最终报告。 |
| 上传可见、可购 | API 组合既有资源/内容/发布/购物车/结账用例；Worker 处理真实字节、私有源与 checksum 派生图。新艺人只补明确 TEST 合成履约配置，走加密与审计，不放宽生产预检。 | 正常内容/订单合同仍在；真实浏览器上传、购买证据不能由健康检查替代。 |
| 首次首页 | 仅在无既有发布头、无不属于本次计划的草稿时，用实际已发布艺人及独立桌面/手机主图通过正常 HTTP author/review/validate/publish。保存计划、记录并撤销临时会话；发布以版本零 CAS 防止覆盖并发用户发布。 | 新专项用例通过；此前 `WAIT_INITIAL_HOMEPAGE` 失败保留，需新端到端结果关闭。 |
| TEST 支付与可信入账 | 持久 TEST PSP 托管页不收卡数据。结果经 HMAC 签名 webhook 发往既有 ingest；成功接收才存投递回执，失败可重试。浏览器回跳没有直接写 PAID。退款亦经实际签名证据。 | 组合没有绕过最终态合同；需最终购买/回调/退款和重启同实例证据。 |
| 独立 Worker | 独立 child process 经 IPC 接收配置，运行既有 pg-boss/可靠事件与媒体处理；API 不重复启动 management processing。Worker 停止导致状态检查 degraded。 | 专项用例及代码符合；健康端口仅存活证明，不代表所有队列业务已验收。 |
| 私密信息与邮件 | support intent/KMS 用实际 envelope adapter 的 TEST 依赖；稳定 master/MAC keys 不因重启变化。邮件仅本地捕获，PG 中 AES-GCM 加密，访问经片段 token 换 HttpOnly/Secure cookie；截图入口拒绝私密面板与已填私密字段。 | KMS 重启/绑定、mail AEAD、TLS/OIDC 用例通过。最终 mail→安全查单及秘密扫描须 root 补齐。 |
| 日常停止、重启、重置 | 稳定实例 ID/端口/密钥；checkout 所有权锁；逆序关闭并保存 stop 结果。reset 要完整实例 ID、相同 ownership、无 supervisor/postmaster 记录和已停止且绑定路径相符的 S3 容器；失败保留数据。 | 已修复下述清理失败缺陷，相关隔离用例通过。 |
| 支付配置独立审核/发布/回退 | API 使用既有 local admin payment configuration、真实 provider directory 及刷新逻辑。管理者/复核者是不同 PG 身份，日常通过本地 OIDC 登录。 | services 正补统一浏览器流程；新增 helper 不是执行证据，也不在本报告自审范围。 |
| 七语言与双视口 | 主浏览器脚本使用实际上传后的礼物/管理页、七语言、390×844 与 1440×900、reduced motion、键盘、axe 和布局检查。 | 只有完成并通过的最终报告才能满足交付；不能把计划覆盖当已通过。 |

## 发现与处置

### 已修复：停止失败后可能删除仍运行 PostgreSQL 的数据

初版 supervisor 即使某资源 close 失败也删除锁，CLI 只以控制端口消失认定 stop 成功，reset 未检查 postmaster。`pg_ctl stop` 失败而 S3 已停时，后续 reset 可删除活数据库文件。

当前 `apps/api/scripts/local-experience-supervisor.mjs:92` 先写匹配 run 的结果且只在零 cleanup failures 时删锁；`scripts/local-experience.mjs:216` 调用 stop-result 校验后才报成功；`scripts/local-experience-reset.mjs:35` 拒绝存在 postmaster 记录的实例。新增回归同时验证失败停止、失败存储删除、外来容器/挂载、错误确认与并发实例保护。审查者独立运行相关用例通过；没有执行破坏性故障演练。

### 已修复：统一验收命令的 PostgreSQL 路径前提不一致

`scripts/verify-local-experience.mjs` 直接运行 PostgreSQL 与 services 集成脚本；`local-experience-postgres-integration.mjs:13` 和 `local-experience-services-integration.mjs` 的 CLI 必须有 `FAN_SUPPORT_LOCAL_POSTGRES_BIN`。普通 `local:start` 则能自动发现已安装的 Homebrew/既有 PG18，当前本地 runbook 将环境变量描述成其他安装路径才需要。

因此原实现只按文档使用已安装 PG18 并执行 `pnpm verify:local-experience`，可能在第一项 PG 集成前失败。root 已导出 `resolveLocalPostgresBin` 并让验收入口复用、通过 `commandEnvironment` 把发现结果传给每个子进程。审查者用空环境对象实际调用自动发现并执行只读 `postgres --version`，得到 PostgreSQL 18.6；本项关闭。

### 待 root 处置：局部浏览器诊断不能报告完整 PASS

新增 `--defer-poster` 和 `--poster-only` 诊断路径可复用已上传的真实内容，但当前仍共用 `status=PASS` 且报告无 mode/scope。后者跳过交易、取消与支付配置，前者跳过海报；重启分支还对 `canceledOrder` 和 `paymentConfiguration` 使用可选判断，旧 facts 缺这些字段也可通过部分读回。

统一 wrapper 默认完整路径不主动选择这些标志，但独立诊断报告仍有被误用的风险。已通知 root：明确局部结果与 scope，最终验收拒绝 partial；重启读回强制本轮必需 facts/版本。保留诊断能力无需放宽完整验收。

### 尚未关闭：完整同实例端到端验收

审查时安全读取到六个已有 browser report，均为 `FAIL`；阶段包括早期 LOGIN、INITIAL_CONTENT、UPLOAD_ARTIST 和 WAIT_INITIAL_HOMEPAGE，最新已结束报告为 `test-p508-1790082938821/report.json`，337 assertions，尚未完成矩阵。错误是已有进行中修复，不另造新的业务缺陷。

交付前仍须最终通过上传→真实选购→托管 TEST 付款→签名入账→邮件安全查单→留言审核→准备/送达→退款；另按 readiness 覆盖取消、支付配置独立身份审核/发布/回退。停止再启动同一实例后须比对原配置/密钥/媒体并从实际 UI 读回订单、退款、取消与最终支付配置头。失败与恢复证据保留；旧阶段临时夹具结果不替代这次组合。

## IaC 入口与生产边界

- `infra/opentofu/stack/outputs.tf` 的 deployment manifest 明确为 reference-only，`cloudEvidence=false`；JSON schema 固定 false，示例仅合成账户/digest。实际 schema 正则能匹配该示例，未误把输出视作云部署证明。
- `scripts/check-infrastructure.mjs` 区分 `STATIC_ONLY` 与真实本地工具检查 PASS，并在控制台/结果保留 `cloudEvidence=false`。根 README 和 offline runbook 都说明只做隔离、backend-disabled、mock/non-refreshing plan，首轮下载不等于连接 AWS 账户。
- `docs/runbooks/infrastructure-offline.md` 的“密钥和运行时组合”明确当前生产业务 composition 尚未验收；TEST/LOCAL_OIDC/TEST PSP/TEST mail 不能用在 staging/production 冒充真实服务。后续须实现并评审身份/MFA、KMS、PSP、通知、DB role 与业务 Worker 装配，容器健康不替代业务 smoke。
- 同一 runbook 保留账户/域名/成本/授权、真实 cloud plan/apply、DNS/TLS/IAM/KMS/WAF/告警、干净 staging smoke 与二次无漂移 apply、恢复/回退及真实资金门。计划和当前 phase/MASTER 仍以 P5-08 `IN_PROGRESS` 表示，不能据此直接线上部署。
- Worker 的现有 CDN purge 只定位 application distribution：`publication-runtime-write.ts:39` 生成 locale/目录/政策/media metadata 页面与 sitemap/SEO 路径；现有 adapter 只有单个 distributionId。派生图按 master/variant checksum 不可变寻址，现合同未生成媒体域 `/processed/v1/…` purge。此时没有证据支持给 media distribution 扩权；将来字节撤销清退需独立业务合同，不能仅补 IAM。

## 本审查实际验证

执行：`mise exec node@24.20.0 -- node --test scripts/local-experience*.test.mjs apps/api/scripts/local-experience*.test.mjs`，退出 0，**46 tests / 46 pass / 0 fail**；后续首页代码变动后单独重跑 `local-experience-homepage.test.mjs`，**8/8 PASS**。这批包含隔离的真实 HTTP/TLS/OIDC，但没有启停正在运行的用户/验收实例、没有执行云 API/apply、没有真实资金或外发邮件。

本审查未运行全仓构建或冒领 root 的最终 browser/restart 结果。新增 payment UI helper 仅完成 Node24 syntax、ESLint 与 Prettier 检查，真实行为和非作者 review 由 root/services/runtime 继续验收。

结论：本地业务组合、权限和持久性边界在已审源码中成立，曾发现的危险 reset 路径与验收 PG 路径差异已修；未发现其他已证实的业务实现阻断。**完整本地交付仍待统一浏览器/重启证据与局部报告口径闭合，本报告目前不能标 ACCEPT 或通知可直接线上部署。**

## 复核快照

以下仅为源码/文档 SHA256，不包含实例状态、私密内容、凭据或密钥文件。

记录时间：2026-09-22T13:25:05.045124+00:00；共 74 个文本文件。变动后的文件须重新核对；helper 为本审查者作者范围。

| 文件 | SHA256 |
| --- | --- |
| `apps/api/scripts/local-experience-bootstrap-policies.mjs` | `05bda3cfcea714b299ddcd249467749878e5e79a4a012a9e6b256b44627bef8c` |
| `apps/api/scripts/local-experience-bootstrap-postgres.mjs` | `a56734b1d205aa76b91a67ce696bab09a8a2403e2cc5f05d453dba469719f91b` |
| `apps/api/scripts/local-experience-bootstrap-state.mjs` | `718bfed7a2f76b2bbc35d1c06cd856e5ab33622e6b08ec2c60cf65a8ea3bbc13` |
| `apps/api/scripts/local-experience-bootstrap-state.test.mjs` | `db1a457df7ca68f1566464f94cffa7e05ae6f6be421a3a56cc6bb7729f5c1579` |
| `apps/api/scripts/local-experience-bootstrap.mjs` | `7f23b1b47e0d4b6f999b516a0a83f4df2bbea62fa4b59412bbf83c7d725316c0` |
| `apps/api/scripts/local-experience-browser-cancel.mjs` | `888fe9402fd1256b6f8b4b0ad714885d92518688315f5b1c16ca2606d42adddd` |
| `apps/api/scripts/local-experience-browser-operations.mjs` | `11e1a459325a77f618ba71ea31b9cb0ea9ed11d707db4c08a177edc4c764f025` |
| `apps/api/scripts/local-experience-browser.mjs` | `4fdafa888eeea03ee3f7402f419a745dc446b1d2d09fe448e8abfc267a7f9864` |
| `apps/api/scripts/local-experience-config.mjs` | `5aa9850e8e7c8586df4bd335a07d2a04451c2665cc5d383cbd4165ec83c92f94` |
| `apps/api/scripts/local-experience-control.mjs` | `a30805800aad339e6fc9f2d1bae1e4dcbd82939047fd15c5b965efeeeb6471cb` |
| `apps/api/scripts/local-experience-control.test.mjs` | `4143fbac67f036fc794c7af9225f81c459229f3c418765628fe2159461d89aba` |
| `apps/api/scripts/local-experience-dns.mjs` | `2bd5bd3fcbcf5a469b3af9b80bb243cc8811ce99431fcf2f2edd0f5ac473e647` |
| `apps/api/scripts/local-experience-health.mjs` | `0d5ac89b648675a7b0fa2a272b84647e43e57becb591af7b0977d763fa32cf78` |
| `apps/api/scripts/local-experience-health.test.mjs` | `9adf6afd564f41c4e7a27267f5db05b45be28ab89aa2ce0d3d26750b828dea71` |
| `apps/api/scripts/local-experience-homepage-integration.mjs` | `9625848e20ef0d8ed5b9835e055420a45190d6cefff24a63cf6c190d4c5babdc` |
| `apps/api/scripts/local-experience-homepage-media.mjs` | `b965df3a8b35224fd540ecb00fc38a4e1b6f1d5d163888cbf9effbafc2eda3ea` |
| `apps/api/scripts/local-experience-homepage-plan.mjs` | `ba41b67c1533a46dc16b6732dd7f2e6cb4920cacdfdb31deb3eb9a5da8dbda76` |
| `apps/api/scripts/local-experience-homepage-publish.mjs` | `fd34e166c97e162b662b7187202910d0cc7e46d4feabb1a45506ccd87765cd73` |
| `apps/api/scripts/local-experience-homepage-sessions.mjs` | `0e85ab04b5b073e521f7419e7d8cae33c1aded16b86e3f0af3637242689a7b46` |
| `apps/api/scripts/local-experience-homepage.mjs` | `a85eb8a60c7fd116e6c2804c1653dddc5c936f6cb089dce4bfb27d341bd64f24` |
| `apps/api/scripts/local-experience-homepage.test.mjs` | `4b1ce62b2126e28d5056c1b7ade156f324e06fa7d5a38be0888b50dd0a839f5a` |
| `apps/api/scripts/local-experience-infrastructure.mjs` | `497bbf34b83eac7188add787139a488268b840a4314ef29003efebef6e2fd0d0` |
| `apps/api/scripts/local-experience-infrastructure.test.mjs` | `bc6ffda56fc045757e3acc02aeee1014bf0fdee1c2d33ac1efe71739b0076376` |
| `apps/api/scripts/local-experience-kms.mjs` | `fccead1636f2342c6ae83799da8a74bc3d75dac87ab7be96dc82b2ce8df01380` |
| `apps/api/scripts/local-experience-kms.test.mjs` | `d5039f7e47915c23c9a074c3829b21e393b5ead00a34312c75a72ef1c9377566` |
| `apps/api/scripts/local-experience-lifecycle.mjs` | `8422cbe2da10e4e4db1ef057abded86ab80efa33b0ad5c7bc0799038459d8e2a` |
| `apps/api/scripts/local-experience-lifecycle.test.mjs` | `d70176f3deddabf8f1f4e853d8415a95ad35d93fddc630436ba3726b9858473b` |
| `apps/api/scripts/local-experience-media.mjs` | `e0f17e5374a47b8aa1b3f881bbac08c7b3cec8439c1298a2547a64e7f77e1185` |
| `apps/api/scripts/local-experience-postgres-integration.mjs` | `0bbe7e92db9e74838575764ff53155c4f97ef5f4fbba939d5d07c2179481c09f` |
| `apps/api/scripts/local-experience-postgres.mjs` | `d8fb86e75fd00bf50c192e9313678779d7cf42fa536e3ae06a044d820a702b1a` |
| `apps/api/scripts/local-experience-provisioning.mjs` | `b83900aafddaf51c5124b57607c51f47a907c5ead1f801ae73fc117d865e0a2b` |
| `apps/api/scripts/local-experience-provisioning.test.mjs` | `fde86a38a3cbab0a330cdb1befb2e4d51e18898b03312072d1fc9e69ba1399ce` |
| `apps/api/scripts/local-experience-runtime-config.mjs` | `f154a5b7ec5c9d4863dd2f35dfe9e9c442c9d71891d923b1666c2016d45a375c` |
| `apps/api/scripts/local-experience-runtime-config.test.mjs` | `be8d92768c2997034c94167262701ad6f116551149b4baf7c834d878ebce43a7` |
| `apps/api/scripts/local-experience-runtime-media.mjs` | `dd8971cd1205c8577c8dab0ebe223908c1f37dc73b88f2b2917ac87b3ef2f9af` |
| `apps/api/scripts/local-experience-runtime.mjs` | `6d43caee68019d00d4661306db81996d15dc6f2d4730636afd1f4b81fec1a72f` |
| `apps/api/scripts/local-experience-services-common.mjs` | `507dfeb5d1427995dbf0dc8336e096097a87c981643c25fd75d1e44cb32214cf` |
| `apps/api/scripts/local-experience-services-integration.mjs` | `4fc5648cb1fb6b59c629559edec0c14503aa53095e35da7b70db6e1d9b185f77` |
| `apps/api/scripts/local-experience-services-mail-store.mjs` | `3e1cb883fbc9d56750803d46d2ffcf98da6dfb824004377127ac8118e13d5fbd` |
| `apps/api/scripts/local-experience-services-mail.mjs` | `a62fa0ae25c656d766c026216a4a472d29f3ffd48945a07c028e701af8369753` |
| `apps/api/scripts/local-experience-services-oidc.mjs` | `352da9999c1b56dd8e5a04fa5161d04564eba6d0f12d17dc383d92a224c65d69` |
| `apps/api/scripts/local-experience-services-oidc.test.mjs` | `54397e36d87b74b02092cd1326dc9ae5eb6c8fdf4f3e38c7a6848ae27246e4a4` |
| `apps/api/scripts/local-experience-services-psp.mjs` | `5c489296f8f13238d93c1b7ae3eed142a24ed77e6922c7ad0628a1d7a3477c92` |
| `apps/api/scripts/local-experience-services.mjs` | `b55d201445afefbfcf4744335fd5f550458c273e8fadaff617aa808347eeb618` |
| `apps/api/scripts/local-experience-services.test.mjs` | `95e5f1bc3a632504602b020f47eccf2cbf03b8ac6c1aed3d5abe3e244ad71138` |
| `apps/api/scripts/local-experience-storage-reset.test.mjs` | `aa7fcb1783426159538f049ef9d54eb86449eff48a257643b97c45098d9d5d1d` |
| `apps/api/scripts/local-experience-storage.mjs` | `22d8f4df2026cb843b011e2c396b0bcd36b0ca41dced8d60eea0ff8299e0484a` |
| `apps/api/scripts/local-experience-supervisor.mjs` | `40fb2c3adb55f03810ce44673fe62182f0f8424cea2e0d6bf65e93563bdd7502` |
| `apps/api/scripts/local-experience-tls.mjs` | `350b46733d36dbe9690251e8ecfa02bb5f02ad9a278e0617ca4b8ed927f4363d` |
| `apps/api/scripts/local-experience-tls.test.mjs` | `a7ed865b69a00ce3632870b7c8df5ed86df65e9ec647f4aa54ae691545411504` |
| `apps/api/scripts/local-experience-web-config.mjs` | `07889a6e935685fba8d98f660b4b2c212c6bf4e0937bc5799b9d9d7661ffa6e4` |
| `apps/api/scripts/local-experience-web-config.test.mjs` | `f5a3eb9025f8bbf7547bbd6c7b595ce2f7efd1dc79ae13b6475d23e8b61f17d4` |
| `apps/api/scripts/local-experience-web.mjs` | `6dc2e7304fc39fa3931ed1fea62313b368ddb9ff5707b30e1654ec5cb8aaf3b7` |
| `apps/api/scripts/local-experience-worker-process.mjs` | `9a49892c83f59b9d441d3edc20b7fcdf64da7163cd3e61fd7c0f44d9433b7e13` |
| `apps/api/scripts/local-experience-worker.mjs` | `13542cd7ce516e1299c442372e61af472fa27e9fc92c76ee58a6d6aaa9c786c4` |
| `docs/plan/p5-08-local-deployment.md` | `8bae2dc88d7f46d97ce45936569495d181240253031d32e6a66507af23c41fb7` |
| `docs/runbooks/infrastructure-offline.md` | `aa4e44102cad1ee4891f2062ef92a62f9c09f98d5e2dba300baa586025b5a721` |
| `docs/runbooks/local-experience-readiness.md` | `18d7e4c4ccb751ab39c1c9d42c4f2ca53efa33dd2fe9b42289396d4c22101788` |
| `docs/runbooks/local-experience.md` | `6aa2a0e2ad91dc48b246eb166deb7b1be5e3f452e53c6526af482297a6fa4dac` |
| `infra/opentofu/README.md` | `fa54fbfc19bf76c03097260b3c9c1424a692899a77b8598d3fc8883c5f5ad750` |
| `infra/opentofu/deployment-manifest.schema.json` | `cd736aba2a86558132a0dc5045c89c1b9f30a6b089551007074be098327554f0` |
| `infra/opentofu/stack/outputs.tf` | `f874f02aea921ed82e626d9e21ca0ad7720a5be5e66d6408d665b98d4aac506d` |
| `scripts/local-experience-acceptance.mjs` | `1ab004676bc508d7887aba163e62c8bd2403da8c4ce8a166517345a2bcc241e9` |
| `scripts/local-experience-acceptance.test.mjs` | `99d3517b33ef951ebea49f274706cc5bbf0247c727e72a8e56a65c0304c0d68a` |
| `scripts/local-experience-lock.mjs` | `8a7c4ad3e570e4e6886fb2498f1f7b826dc2f008d32b1ac059186ff96766ea32` |
| `scripts/local-experience-lock.test.mjs` | `74658fa4c6e2c21a5a55d2f024820b7619481aadc7b0a41fbcfee28c3e742e47` |
| `scripts/local-experience-reset.mjs` | `aeaabee6d78a153313890c14c8cb513cef8c6213f8aa73c3f08c11ddbecb9490` |
| `scripts/local-experience-reset.test.mjs` | `77e14299706c23dfef1d17995d43c716e4f13c0d5a6a222141fd84bb44254b6f` |
| `scripts/local-experience-state.mjs` | `1c3c930bb06096275831818a02d7517c57a0c930b4b136b642706f168e061ec0` |
| `scripts/local-experience-state.test.mjs` | `107f595a98f82a9d9a0f0a95fbb53003d410672edb16fd544a7b8b172dd8b400` |
| `scripts/local-experience-stop-result.mjs` | `724f76aa8ad914afb66a70f4e9912eca4b8b53bc2db4cde152d47279c092040b` |
| `scripts/local-experience-stop-result.test.mjs` | `c6e3e9e5f1b81028403cb7f2b266c9096503d6dc9472b4247a1e3bb7525365a2` |
| `scripts/local-experience.mjs` | `efd3e2d7faa1ab02c578b5e724ffdaf0049f11b4df6bc26e1f107d1ec098b151` |
| `scripts/verify-local-experience.mjs` | `fda58ef7a9004dd0fd5bd7f066c555700e0a6f2d450b33d2a9eb4f08e6ab7cbd` |
