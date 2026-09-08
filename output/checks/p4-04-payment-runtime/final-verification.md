# P4-04 本地支付运行时检查点

状态：本地 TEST 检查点通过；原检查链 38 个步骤均有实际通过证据，包含分段复验，不是单条 `pnpm check` exit0。P4-04 保持 IN_PROGRESS，Lane A 由 `/root` 持有；首个批准 PSP 的实际 sandbox 尚无输入或证据，不能由独立 TEST 服务替代。P4-05 未解锁，项目仍为 25 DONE / 2 IN_PROGRESS / 22 PENDING = 49。

## 实现与边界

- 七语言结算页承接既有真实购物车、订单预检、明确政策确认和待付款订单；支持明确选择国家、支付方式、托管跳转、返回查询与未知状态恢复。刷新和切换语言保留服务端 checkout、金额、币种与 attempt。
- PostgreSQL 第一事务保存永久幂等收据、冻结 provider/account/environment/rule/locale/command、唯一活动 attempt、lease、历史与 outbox；外部 PSP/KMS 在事务外，第二事务按原 claim fencing 保存结果。已提交但响应未知时，只读回原收据或恢复原 attempt。
- 普通 GET 与回跳没有支付或对账副作用。UNKNOWN 只走经过认证并审计的 reconcile；可信查询确认仍待用户操作后，仅按原 external reference 取回原动作。可信成功证据保存后仍为 EVIDENCE_PENDING，订单 PAID、库存 commit/release、成功页、查单与通知保留后续任务边界。
- 独立 TEST PSP 使用 HTTPS、独立 PostgreSQL 与独立进程，普通测试只操作合成数据。正常支付配置依照 draft/validate/publish、七语言合成独立审核、健康事件、发布 head 与 outbox 约束创建；不关 trigger，不 seed 订单或支付结果。生产组合不导入 Fake；缺少部署注册 adapter 与有效配置时不可付款。
- 运行配置、恢复步骤及反代要求见 `docs/operations/checkout-payments.md`。

## 已完成的定向证据

- Application / Domain / contracts / PG / API / UI 的有效 RED→GREEN 和非作者复核分别保存在当前目录原始日志及 `application-independent-review.md`、`root-followup-independent-review.md`、`psp-independent-review.md`、`postgres-implementation.md`、`storefront-implementation.md`。
- 539 合同根、92 OpenAPI 路径、171 公开 components；原有 502 根、87 路径、161 components 不变，见 `contract-compatibility.json`。原 0001–0025 共 50 个 SQL 文件不变，见 `original-migration-compatibility.json`。
- 真实 PostgreSQL 26 迁移 / 168 表往返通过；37 条运行时 SQL 的实际 PREPARE 与 domain[] 映射共 39 项断言；认证 UNKNOWN→REQUIRES_ACTION 的动作守卫 10 项通过。该守卫 probe 是隔离表边界证据，完整审计/FK/outbox 另由实际 HTTP 链路证明。
- 原字体生成器使用固定字体源重新生成中日文 UI 字符子集；字体测试通过，完整浏览器仍按最终字体复验。
- 最终真实 HTTP/PG/TEST PSP/Chrome 入口 `run-2026-09-08T19-28-30.305Z` exit0：5761 准备 + 1316 运行时/浏览器 = 7077 断言，另 8 项 0026 带数据拒退与 30 表哈希不变。31 cases 为 14 完整购买、14 新访客空态、2 键盘、1 语言切换；71 PNG、57 axe 零 violation/零 incomplete、0 pageErrors。见 `api-browser-evidence.md` 和 `api-browser-final-verification.json`。部分 full-page PNG 记录滚动后的 sticky 位置，不称所有图片为页面顶部默认布局；root 实际查看 pt 桌面 review、ja 手机 ready 等最终图片。
- 两个真实事务成功提交后由测试 wrapper 注入结果未知，分别覆盖 beginCreate 与 settleCreate，110 断言。正常 HTTP 读取/原 key 恢复均保留原 order/attempt，每个 TEST PSP 创建共一次；这是提交响应边界注入，不能称为真正数据库网络断线。独立 PSP 的接受后断开响应及新 PID 重启则为实际进程/HTTPS 故障。

## 真实失败与修复记录

1. `run-2026-09-08T18-34-14.486Z`：capabilities 503。实际 SQL 复现 node-pg 自定义 domain[] 返回字符串；只在读取处转换为 text[]，保留数据库域类型与约束。
2. `run-2026-09-08T18-44-18.317Z`：捕获后的立即恢复断言失败。后续增加只读 PG due/lease 观察、等待自然到期后一次恢复；原失败未保存足够状态，不能声称其精确根因已证实。
3. `run-2026-09-08T18-48-56.101Z`：HTTP 协议到可信成功证据通过，Next 健康检查失败。修正 TEST 构建产物运行环境组合，并重新构建 API/UI 依赖闭包，确保 config allowlist 的实际 dist 更新；生产发布规则没有放宽。
4. `run-2026-09-08T19-00-17.159Z`：协议包含取消重试和健康变更通过；首个浏览器加购失败。无 Cookie 的真实编译 Next HTTPS 探针复现 403。BFF 增加精确配置 Host/X-Forwarded-Host/X-Forwarded-Proto 的私有反代入口匹配后仍 403，实际 Request 字段又证实 TEST gateway 的 fetch 改写 Host；换为 node:http 转发，保留原字段白名单、请求上限和认证门。有效真实 server RED→GREEN 验证 UTF-8 body、状态、独立 Set-Cookie 和 Authorization 不透传；最终同一类 HTTPS 探针得到既有未登录分支 404 CART_NOT_FOUND。`https-origin-final.json` 保存结果，原两次 403 证据保留。
5. 定向 lint 预检发现协议等待变量初始赋值无用途；范围限定为 TEST 脚本清理，原失败保留 `lint-before-final.log/json`。
6. `run-2026-09-08T19-18-28.749Z`：实际协议包括两次 COMMIT 后响应边界故障共 801 协议断言通过（另 5761 准备断言），首个浏览器已完成加购→结算→UNKNOWN 自然到期恢复→托管跳转，3 axe 零违规/零 incomplete、0 pageErrors。TEST PSP 原生表单返回 403；独立真实 PSP/PG/Chrome 最小 probe 确认 `Origin: null` 与 hosted HTML 的 no-referrer 相关。仅 TEST hosted HTML 改用 strict-origin，API 与跳转响应仍保留 no-referrer，原 exact Origin/CSRF 校验不放宽；随后 CSP form-action self 曾阻止跨站 303 回跳，严格增加唯一已验证 returnOrigin 后，最终 19:28:30 浏览器完整通过；原 exact Origin/CSRF 不放宽。旧浏览器的四张截图只证明已经到达的步骤，不当作完整流程通过。
7. 非作者复核发现无 Cookie 直接打开 checkout 会反复显示错误。只在 current INVALID_ACCESS 后读 cart，且只有明确 CART_NOT_FOUND 才显示空态；其他错误保留，无初始化 POST 或清 Cookie。有效 4 FAIL→20 PASS、types/format/lint 通过，非作者 ACCEPT；该版本已纳入 19:28:30 完整浏览器，14 个无 Cookie 空态全部通过。
8. 首条原全仓 `check-full-1` 在 14.272 秒 exit1：原合同检查发现 TEST 配置 seed 重复维护完整 locale map。只删除该手写表，复用已声明依赖的 `loadStorefrontCopy` 与 `SUPPORTED_LOCALES`，从既有 `checkoutMethod`/`checkoutTest` 读取 TEST 显示名和提示；没有改检查器。原合同门 4.541 秒 exit0，两个 seed 单测、format/lint 及真实正常配置 PG 1.582 秒通过（1 publication/head、7 translation、21 review、0 order/attempt），非作者 ACCEPT。所有产品输入不变；第六轮浏览器的方式文案属于旧 TEST 数据，不冒称为新 seed 文案的浏览器复验，原全仓后缀中的 20:11:47 真实 HTTP 使用新 seed 复验通过。


9. `check-full-2` 在 474.458 秒 exit1：原 publication-runtime 的 request16 `/admin/content/publication/validate` 200→403，发生在授权事务内、幂等或发布写入前，没有捕获权限查询行数或 locale 授权结果。原脚本续验 `check-resume-1` 又遇到已有 purge `CLAIM_WINDOW` 23514，`check-resume-2` 在 request1300 `/admin/content-review/read` 200→403。三次确切根因未确认，不能用历史时钟观测替代本轮证据。CLAIM_WINDOW 事务回滚，没有外部 purge 或支付数据写入；可能延迟清缓存。
10. 一次有界 publication 诊断启动器 51.112 秒 exit0，原始业务 HTTP 子进程实际完成 12,826 断言 / 1,462 请求。父进程 CLI `--import` **没有继承到实际 HTTP 子进程**，因此该结果是原脚本无改动复验通过，零授权诊断证据；不称已定位或修复间歇错误。原同源 25/25 构建和这次原子脚本合并覆盖该节点，见 `publication-auth-review.md`。
11. `check-remainder-1` 原剩余 API/支付/S3/format/lint/types 通过后，全仓测试的既有合同确定性测试 5169ms 超过原 5000ms。409/410 通过；非作者核对渲染算法没有新循环，schema 体积相较基线增加 1.05%。保持源码、测试和超时限制，原 `turbo run test` 复验 7.431 秒通过 60/60（59 缓存）；只确认复验结果，不把耗时波动当作已修复问题。
12. 随后的原构建 35/35 通过，构建后 adapter 门发现 `query-layer.d.ts` 暴露 `drizzle-orm/node-postgres` 类型。非作者定位到本轮新增但无外部消费者的 `createPaymentRuntimeRepository` barrel export，收回该导出并增加私有入口负例；原正式事务 manager 接线保留。有效 RED→GREEN、3 文件 30 测试、PG types/build、原 adapter 门与格式/lint 通过，未改检查器。公共 index 构建字节改变，支付业务实现、SQL、界面均未改变。

## 最终门

- 最终字体对应的原 P2-04 collector 29.347 秒 exit0，16 scenarios / 18 PNG / 10 axe 零 violation、4 incomplete；P2-05 collector 37.756 秒 exit0，8 scenarios / 22 PNG / 3 axe，保留原 3 moderate 与 3 incomplete、blocking 0、physical-device gate。原 72 项共享证据先归档，未更改阈值或替换采集器。
- 设计基础 41 tests 与静态门、全仓格式、lint、secret scan 25.794 秒 exit0。默认 npm mirror 无 audit endpoint 的实际错误保留；仅本条命令指定官方 npm registry 的 high dependency audit 1.259 秒 exit0，未修改用户 registry 配置。
- 浏览器冻结 1979 项实现输入，SHA `5d43c607c9ca945792c88cea1f697116946df6e5ce986de3c6ee182e1918c5ed`。之后仅上条 TEST seed 一文件收敛；该轮 1979 项 SHA `aa99ed9495f50a24d28ffc4cc2cccad59d45d6ff10b413a6998bbc84ef99c2c1`，精确差异见 `source-before-full-2.json`。原 P2 门在新完整入口继续通过，未因该无关 fixture 重复采集。
- 原完整链 38 个步骤全部覆盖，见逐命令 `gate-coverage.json`：`check-full-2` 通过原前缀和 PG/API 至 publication-preflight；publication 原前置构建与实际无改动 HTTP 子进程合并通过；`check-remainder-1` 通过后续全部 API、支付、TLS S3、格式/lint/types，保留合同超时失败；最终 `check-quality-final-2` 原 7 项质量后缀 33.910 秒 exit0，类型 60/60（56 缓存）、测试 60/60（57 缓存）、构建 35/35（33 缓存）及 31 Node 出口全部通过。不是单条完整 check exit0，没有改原命令、阈值或跳过失败节点。
- 最终冻结 `source-final.json`：1979 项，SHA `88c0bbbac1a1299885cafc7f27dd8999f4197518e55e0fcb4dd8f13dd80ee744`；相对上一轮仅 PG index 与其负例两文件，原 index 恢复基线字节。所有受影响消费者由最终全仓类型/测试/构建重验；不声称旧浏览器截图来自这个新公共导出构建。
- 最终 secret scan 25.264 秒 exit0。原后台 Next dev 曾仅自动改写 next-env 两条类型导入，保存暂态后精确恢复，见 `admin-next-env-restoration.json`，不称全过程零漂移。两份旧 P3 报告仅时间/耗时变化，归档新输出后恢复基线原件，见 `existing-report-restoration.json`。2349 原未跟踪文件、50 原 SQL、502 原合同根/87 路径/161 components 均独立复核保持。
- S.U.P.E.R 10 项在本地检查点范围通过。非作者最终复核见 `final-independent-review.md`；真实 PSP、P3-06 未完验收及生产门仍保持原边界。

## 保留风险

无实际 PSP sandbox/小额收款、生产账号/部署、云对象存储/KMS、正式资产/译文、手机/VoiceOver 或新的性能验收。P3-06 的原性能与人工验收继续保留。原有历史并发/自然墙钟间歇失败不因本轮通过而宣称根治。用户原有 2,349 项未跟踪文件已于 20:18:20Z 再次逐 SHA 校验，全部保持；原 P2 共享证据已先归档再采集。仅本地 Git 检查点，不 push、PR、merge 或部署。
