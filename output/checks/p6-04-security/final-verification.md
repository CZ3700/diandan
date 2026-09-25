# P6-04 明确范围的本地安全检查

状态：**ACCEPT（明确范围的本地安全检查）**。P6-04保留响应头加固、云端与正式服务验收而仍IN_PROGRESS；Lane D释放，P6-05仅有限本地故障注入READY。原两轮FAIL保留，以独立逐项矩阵和源保护补验为准；不授予完整安全或生产放行。

## 输入与范围

- 分支 `codex/p6-04-security`，基线 `e65c9ffde4e9651c7c3b6e86df6426db05fbf410`。执行登记开始 `2026-09-24T11:21:26.012Z`。
- 最终候选执行源 `0d523ce1fd33903d1ca1a01c6cc47f8b91099229ab92d8cbd081798faa15313b`；2,834 执行文件、2,921 选定文件。原直接依赖 P5-06 的 69 个相关输入已再次逐 SHA 核对。
- 自有源码副本、独立 PostgreSQL 18.6、TLS S3、TEST OIDC/PSP/邮件与真实 Chrome。Node 24.20.0、pnpm 11.25.0、Next 16.3.6。实例与资产均为合成 TEST；无外部目标扫描、真实资金、云 apply 或 Git push。
- 执行计划和逐命令退出状态：`run-owned.mjs`、`run-1/report.json`、`run-continuation.mjs`、`run-2/report.json`；两份源码清单见各自 `source.json`。这是 P6-04 安全相关的有限回归，不是 P6-01 原五组全量重跑。

## 修复与结论边界

| 项目 | 原问题与处理 | 可接受的声明 |
| --- | --- | --- |
| 已公布的 Next 依赖漏洞 | 原 16.3.4 在官方 Critical 通告影响范围；前台/后台/lint plugin 与 lock 同步 16.3.6。CI 新增已知通告版本门，仍执行原 npm audit。 | 影响版本已移除；未发现当前源码使用 ImageResponse 的攻击可达路径。不把 npm feed 的零结果当成通告不存在。 |
| RUM 整窗拒绝服务（Medium） | 两条合法匿名冲突记录使旧 CLI 中止；新 v2 隔离冲突 key 全部窗口记录，保留正常观测，窗口和行明确 DEGRADED，不判预算通过。 | 监测可用性修复；匿名样本仍不可信，CLI exit 0 只表示报表生成，不是 field 验收。旧 v1 原值/语义保留。 |
| 差异化限流（Medium） | 公开购物车/登录请求可反复触发持久化，已有全局 WAF 未区分六类操作；补充按 viewer IP 的六类规则、显式阈值与窗口，保留 global 和 count→block。 | 批准的 CloudFront→private ALB 架构配置缺口已补；本地直连应用仍不经过 WAF。实际云阻断、共享 NAT、PSP 重试容量与传播延迟未验收。 |
| TEST 邮件 GCM 加固 | Node 可接受正确 tag 的短前缀；解密固定 16B，正确旧密文格式不变，4/8/12/15B及篡改拒绝。 | 仅 TEST 存储防御加固，无已证明远程数据库改写/利用链；生产 KMS 既有 tag 固定切片仍为16B。 |

原 707 JSON Schema 定义、207 OpenAPI schema、129 路径逐值一致，只新增内部 `RumReportV2`。证据 `contracts-preservation.json`。业务合同、历史迁移、付款最终状态来源、用户布局与日常管理步骤未改变。

授权/CSRF/token/金融审查见 `auth-review.md/json`；内容、链接、SSRF、PII与 RUM 见 `content-review.md/json`。扫描与非作者复核分别见 `scans/scan-final-report.md`、`scans/independent-change-review.md`、final scan report 的 IaC 段及 `scans/independent-iac-final-evidence.json`、`final-source-review.md/json`。

## 已执行验证

- `check:dev`：原 format/lint、64 类型任务、64 测试任务、36 构建通过；真实 frozen install 与 pinned patch 配套。
- `security:dependencies`、`security:regressions`、合同新鲜度、CI 策略、性能工具及 OpenTofu 离线验证通过。OpenTofu 1.12.6 / AWS provider 6.66.0；bootstrap 1、registry 1、stack 16 个 mock 场景，21 输入 SHA。真实 AWS 未调用。
- 真实查单 PG/HTTP 6,859 断言；后台登录权限含浏览器 859；财务 PG/HTTP 6,164；异常操作/重放 PG/HTTP 6,161，均通过。它们包含正常和拒绝路径，不把预期 401/403/409/429 或数据库防线拒绝误报为测试失败。
- 独立源码复核 32 定向测试通过；另外有作者针对性测试和扫描者交叉复核。数量不与全仓任务相加，以免重复计数。
- run-2原完整check:dev再次通过；真实RUM七语言双端、42指标组、46筛选/6截图与空窗口整体验收通过。第10工具测试因import改动脚本单独在冻结run-2副本重跑37/37通过，见 `run2-performance-tools.json`。fresh购买旅程14场景×10里程碑、28语言切换、失败/取消恢复2、14独立邮件安全查单、171 evidenceChecks及44截图通过，页面错误0；内容上传准备为573断言/PARTIAL_PASS，不把它当后台履约全量UI验收。原adapter边界和32个Node导出检查通过。

## 扫描覆盖和工具失败保留

Semgrep 1.157.0 OSS，官方规则固定 `a84ff9cc2453ca91d581380de4b8b3f272f6f4be`，494 配置规则/482 实际执行；2,535 技术源和额外1个扫描选择文件。最终原始130候选（3 ERROR/114 WARNING/13 INFO）保留，不把误报清零。11个部分解析诊断覆盖15处行位置，已逐行人工核对，主要是 Actions 表达式、TSX 测试 URL 与 type-only re-export；不声称完整 AST 覆盖或跨文件污点证明。源码没有上传扫描服务。

最终 npm audit 628 依赖、各级报告0；原 secretlint/边界规则不变且通过。已知 Next 通告单独核实并升级。run-1完整扫描后仅RUM浏览器脚本有定位修正；当前扫描覆盖为原2,535技术源完整扫描加该1文件精确差异扫描（168适用规则、0发现/解析错误），与run-2逐SHA绑定，见 `scans/scan-delta-run2-report.md`。具体扫描清单、原始 SARIF、规则哈希、退出状态和分类见 `scans/`。

所有真实 RED 和工具启动失败均保留：Next 两条版本回归 RED；RUM 真 CLI/聚合/合同 RED；邮件四种短 tag RED；IaC 六类规则缺失的 mock RED。早期 engine/config/server-only/依赖镜像超时、未缓存 metadata 的 offline install 失败不冒充代码回归失败或成功；官方 registry frozen install 后通过。Semgrep 首次非法规则选择 exit7、随后零目标 exit0 都标无效；有效扫描以明确 project-root 非零目标执行。

## 保留项与上线门

本次有限范围未确认剩余 High/Critical 代码利用链；这不是整个系统无漏洞的保证，也不代表完整安全或发布门通过。

1. **Low / SPEC15 基线待补**：普通前台、后台和支付页尚未完整覆盖统一 CSP / Permissions-Policy；nonce/hash 脚本策略未完成。现有输入清洗/编码有证据，但不能以它们冒充安全响应头。归属后续 P6-04 续验，必须在公开 staging / P7 放行前与真实 Next/PSP 回归一并关闭。
2. **Low / 云权限待核**：ECS task-definition 注册的资源约束与部署角色最小权限需结合当前 AWS 能力和实际账户再验；不以静态 mock 代替已应用 IAM。
3. 正式 IdP/MFA、KMS/IAM、邮件、PSP sandbox/真实小额、外网不可绕过 origin、WAF实际流量与完整 staging 门保持。上面的本地直连无 quota 复现和 WAF 近似执行边界明确保留。
4. Next 官方 9月23日预告计划9月30日另发安全版本，当时尚未公布影响范围；部署前或披露后须重新核实，不能安装未发布版本或预判已经修复。依据链接见 `docs/operations/security-checks.md`。
5. 原 P6-02 真人读屏/人工语言、P6-03 真实用户 p75/真机、P6-01 远端 CI及其他阶段原外部门均未代签。

## 数据保护与收尾

最终保护检查 `protection-final.json`：8,457原未跟踪文件逐SHA不变，私有配置保持原SHA。原实例已正常stop/start载入Next16.3.6，四服务ready，两站中文页面经本实例CA严格TLS验证GET200，未reset。证据 `user-instance-refresh.json`；这不扩张为全部业务数据库逐行比对。首次暂存487个本轮文件，与原8457无交集；最终提交范围仍须收尾核对。

S.U.P.E.R 1–9 源码审查已通过：新增职责明确、旧计算复用、无运行时循环、跨模块 v2 严格 schema/可序列化、运行配置显式且边界可替换，无新增依赖/业务语义。第10项适用技术命令已通过；原外层源保护失败用同一验证器在精确恢复后复验通过，独立整体签署ACCEPT。原秘密扫描首次暂存后PASS；最终文档和证据收尾扫描见 `final-secret-check.json/txt`。S.U.P.E.R十项只对本轮明确范围成立。

P6-05原依赖及198次/193路径独立刷新见 `p6-05-readiness-final-run-2.md/json`。本轮接受后已在MASTER/phase登记有限本地故障注入READY、无owner/尚未领取；P6-06仍PENDING、Phase7仍LOCKED。旧候选报告保留其条件状态，不回写历史。

## run-1 失败与定向复验

run-1 的命令1–15通过，第16真实 RUM 的14采集场景通过但整体FAIL，17–19未执行。原错误保留，不能把采集通过替代整体验收。新完整性提示与原说明共享.notice，原单元素断言触发strict-mode；真实CLI文件复现见dashboard-red/error.txt。仅收窄原说明定位并新增CLEAN 42/0记录提示断言；原42行、23筛选×2、空窗、网络/页面错误要求保持。dashboard-green用原CLI文件通过双端全矩阵，6截图；不替代完整Next集成。run-2将冻结新输入并重跑完整质量、真实RUM、完整七语旅程和边界检查；run-1的6–9及11–15只有在全部输入比较证明仅非消费的RUM浏览器脚本变化后复用。独立复核发现第10性能工具测试实际import该脚本，因此原run-2报告将它列作可复用的声明不接受；保留原报告，并以同冻结副本单独重跑第10的证据覆盖最终验收矩阵。runner后续执行逻辑同步纠正。

## run-2 源保护失败及精确恢复

run-2执行的1–5、16–19全部exit0，其中完整购买旅程和新测试实例stop/reset成功；仅外层verifyRegressionSource在末尾FAIL，原report.json保持FAIL。根目录原用户实例正常dev重启自动把apps/admin与storefront的next-env.d.ts中两个类型导入由.next/types改为.next/dev/types；冻结副本2921个文件无漂移。差异见run-2-source-drift.json，生成字节已另存两个*-next-env-generated.txt。先断言当前仅路径替换且冻结值等于HEAD，再恢复这两个本轮自动生成文件；同一verifyRegressionSource分别检查根/冻结副本2921文件PASS，见source-restoration-check.json。没有改业务、合同、测试阈值或原结果，最终不称run-2原整轮PASS。run-continuation.mjs是纠正第10步归属后的后续复跑方案，原执行和补跑以报告/日志/最终命令矩阵为准。

run-1归档62文件、run-2归档108文件。新journey的reset仅针对test-regression-61e59f0c20bd4a13自有实例；原持久体验没有reset。真实RUM仍为LOCAL_ONLY，JS156692B超过150000B SHOULD建议，不能由采集接线通过推断真实性能预算通过。

## 最终接受矩阵与交付

`final-independent-acceptance.md/json` 已独立接受本轮明确范围，包含05–19的15项实际报告/日志SHA矩阵、源保护补验与170归档原件核对。根最终执行字节保持run-2 sourceHash，只有四份进度/排期文档在运行结束后同步当前状态，见 `final-inputs.json`。进度全局31 DONE/10 IN_PROGRESS/1 READY/7 PENDING=49。最终暂存必须排除8457原文件，closing原秘密扫描须exit0后才本地提交；该机械记录见 `staging-final.json`、`final-secret-check.json/txt`。没有push、远端CI、云apply或真实资金操作。
