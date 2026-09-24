# P6-04 最终独立技术验收

结论：**接受本轮有限本地安全范围，保留 Low 与外部门；不授予完整 Phase 6、生产或远端 CI 放行。** 核对时间 2026-09-24T12:28:43.157Z。

原 run 1、run 2 报告仍为 FAIL，不能称作两次全流程 PASS。run 1 的真实 RUM 看板定位器失败已由最小 harness 修复及全套新 RUM 验证。run 2 所有实际执行命令通过，但末尾源保护检查因用户实例正常 dev 启动改写两份 next-env.d.ts 的自动类型路径而失败。已保留原生成字节/差异，root 仅恢复与冻结快照及 HEAD 一致的原字节；原 verifyRegressionSource 与本复核者全文件哈希检查随后均通过。最终接受基于逐项命令和单独源保护复验，原 FAIL 不改写。

## 输入与最终接受矩阵

sourceHash：`0d523ce1fd33903d1ca1a01c6cc47f8b91099229ab92d8cbd081798faa15313b`。2,921 选定文件、2,834 执行文件；root 与隔离 workspace 均逐 SHA 零差异。相对 run 1 的完整清单仅 rum-browser.mjs 变化，无增删。定位器修复仍检查原 INP 提示，并新增 CLEAN 42/0 断言。

06–09、11–15 不消费该脚本，复用原通过结果。第10步现有测试直接导入该脚本，**拒绝原 run 2 reusedCommands 中第10步的复用**；本复核者在冻结 run 2 workspace 用 Node 24.20.0 新执行 9 文件、37/37 tests。未重复未变 PG 套件。以下15项均实际 exit 0；每项报告与日志路径、完整 SHA-256、源清单 SHA、sourceHash 和起止时间见相邻 JSON 的 acceptedCommandMatrix。01–04 是隔离副本建立、索引、冻结和 frozen install，原 run 2 记录均通过。

| 步骤 | 实际来源 | 报告 | 日志 |
| --- | --- | --- | --- |
| 05-development-quality | 新执行 / run 2 输入 | [报告](run-2/report.json) | [日志](run-2/05-development-quality.txt) |
| 06-dependencies | 复用 run 1 | [报告](run-1/report.json) | [日志](run-1/06-dependencies.txt) |
| 07-security-regressions | 复用 run 1 | [报告](run-1/report.json) | [日志](run-1/07-security-regressions.txt) |
| 08-contracts | 复用 run 1 | [报告](run-1/report.json) | [日志](run-1/08-contracts.txt) |
| 09-ci-policy | 复用 run 1 | [报告](run-1/report.json) | [日志](run-1/09-ci-policy.txt) |
| 10-performance-tools | 新执行 / run 2 输入 | [报告](run2-performance-tools.json) | [日志](run2-performance-tools.txt) |
| 11-infrastructure | 复用 run 1 | [报告](run-1/report.json) | [日志](run-1/11-infrastructure.txt) |
| 12-order-access | 复用 run 1 | [报告](run-1/report.json) | [日志](run-1/12-order-access.txt) |
| 13-admin-access | 复用 run 1 | [报告](run-1/report.json) | [日志](run-1/13-admin-access.txt) |
| 14-admin-finance | 复用 run 1 | [报告](run-1/report.json) | [日志](run-1/14-admin-finance.txt) |
| 15-admin-exceptions | 复用 run 1 | [报告](run-1/report.json) | [日志](run-1/15-admin-exceptions.txt) |
| 16-rum-browser | 新执行 / run 2 输入 | [报告](run-2/report.json) | [日志](run-2/16-rum-browser.txt) |
| 17-seven-locale-journey | 新执行 / run 2 输入 | [报告](run-2/report.json) | [日志](run-2/17-seven-locale-journey.txt) |
| 18-artifact-boundaries | 新执行 / run 2 输入 | [报告](run-2/report.json) | [日志](run-2/18-artifact-boundaries.txt) |
| 19-built-artifacts | 新执行 / run 2 输入 | [报告](run-2/report.json) | [日志](run-2/19-built-artifacts.txt) |

源保护补验：[source-restoration-check.json](source-restoration-check.json)。本复核再次检查2921文件；未放宽保护函数、断言或阈值。

## 原件、真实集成与保护

- PG/HTTP 查单6,859、后台权限含浏览器859、财务6,164、异常操作6,161断言各自通过；包含共享setup，数量不相加。
- 新 RUM 七语言×两尺寸：14正向及14敏感排除场景，42个真实204，Cookie/Referer/Authorization全缺省，查单上报尝试为零。v2 CLEAN42、全部 LOCAL_ONLY；两端各23筛选、空窗检查和6截图通过，人工读看390空窗/1440全表。JS gzip156,692 B仍超出150,000 B SHOULD建议；保留此观测，不授予field/真机性能预算验收。
- 新购买旅程14场景各十步骤、28切语、14离站前same-purchase、2失败/取消恢复、无效locale404均通过；44截图、171 evidence checks。抽查泰语移动checkout隐私遮罩及葡语桌面paid-order。自有 TEST 实例stop/reset通过，dataPreserved=false；未reset用户实例。
- run 1的62与run 2的108归档文件，逐SHA与原workspace原件相同（相邻JSON完整170条）。默认归档不包含CLI HTML，independent-run2-rum-review.json另绑定其原件SHA。
- 独立重哈希8,457原未跟踪文件，零变化；受保护私有配置SHA与开始相同。root正常重启后四服务ready、两站严格TLS GET200、实际Next16.3.6、reset=false。没有声称全部业务数据库逐行比对。
- 原707 JSON Schema定义、207 OpenAPI schema、129路径逐值不变，仅新增内部RumReportV2；database76文件无增删改。非作者源码复核未发现新增运行时循环或需解除冻结继续补修的缺陷。

## 作者分离与限制

本复核者是edge作者，**不独立签验自己的edge**。该部分引用security_scans独立源码/真实方法路径核对、21输入SHA和18真实离线mock-run复核。mail由security_scans实现、本复核者独立审查；root依赖/CI/RUM由两名非作者交叉审查。授权/CSRF/token/支付/退款/webhook及内容/SSRF/PII报告均列入相邻JSON的证据SHA清单。

Semgrep OSS部分解析及跨文件覆盖限制保留，零audit不等于无漏洞。run 2唯一脚本delta扫描退出0、零候选/解析错误，不扩大为整仓无漏洞保证。复核末尾重复读取大合同曾触发16MiB ENOBUFS；已改用先前完成且输入未变的独立逐值比较，不将工具失败冒充产品验证。

保留Low：统一CSP/Permissions-Policy及nonce/hash基线待补，公开staging/P7前关闭；ECS task-definition部署最小权限待实际账户核对。正式IdP/MFA、KMS/IAM、邮件、PSP sandbox/真实小额、WAF/private origin、共享NAT/PSP重试与传播延迟、人工语言/读屏、真机/真实用户p75、staging/远端CI均未代签；部署前重核后续Next通告。直连本地TEST API绕过WAF、无等效应用操作quota的风险仍保留。

本报告接受冻结技术实现和明确范围的本地证据。最终进度文档、暂存范围secret scan和本地提交由root收尾；已核对 final-secret-precheck.json/txt：首轮自有暂存范围按原secretlint规则 exit 0，日志SHA一致；最终进度/新证据暂存后仍需root执行closing check。没有push或云apply。
