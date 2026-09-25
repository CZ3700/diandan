# P5-01 管理中心登录与人员权限

本地范围验收完成，P5-01 DONE。基线 `270253c`，本地分支 `codex/p5-01-admin-access`，授权与范围见 ADR-015。未 push、merge、部署或连接生产身份/商户。

## 交付范围

- 从原有一个管理中心登录与退出，七语言、会话失效及错误恢复；艺人/礼物/海报短表单保持。
- 真实 OIDC discovery、授权码、S256 PKCE、ID Token 签名与 nonce/issuer/client/auth_time/MFA 校验；只允许平台预授权身份，角色只来自当前 PostgreSQL。
- 一次性浏览器绑定、短事务挑战领取、事务外授权码兑换、服务端 session/CSRF 摘要、当前及全部会话撤销、不可变审计。会话与权限在每次操作时重新读取。
- 新 0030 迁移；18 个新增 v1 合同，606 个旧合同对象与旧 OpenAPI 保持，0001–0029 共 58 个 SQL 保持。
- 仅 development 的 LOCAL_OIDC 组合；首版支持 RS256 与无 query 的回调地址。生产 IdP/MFA、人员预授权、账号恢复、紧急访问、密钥管理和正式 UAT 仍是上线前事项。

## 已保留的问题与修复证据

1. 持久层真实 RED：锁等待后过期、linked session 不可变、撤销逐会话审计、自身关联及未来撤销时间。最终 PG 115、受影响 unit 40、30 migrations / 175 tables 往返通过；原命令 stdout 的如实转录见 `persistence-verification-summary.json`，没有伪造原始日志文件。
2. 浏览器第 1–3 轮：SSR 与 JS 请求正常但 HMR 握手拒绝。第 3 轮精确捕获 DEV_WEBSOCKET；只修复 owned Next 子进程的实际 hostname 与专用 DNS。没有放宽生产 Origin、CSP 或主机校验。第 4 轮已真实进入登录页。
3. 第 4 轮 native form 被拒绝：独立 TLS/Chrome 实验证明 no-referrer 下原生表单 Origin 为 null，同源 fetch 则匹配且仍不发 Referer。改为同源 fetch 取得严格的公共授权 URL 后跳转，浏览器绑定仍只在 HttpOnly Cookie；保留严格 Origin 和 no-referrer。证据 `native-form-origin-experiment.json` 及 browser-contract RED/GREEN。
4. 第 5 轮实际登录/退出成功，但浏览器已跳转后读取旧响应正文的观察失败。仅改测试，从真实身份供应商导航同步收集 state/nonce/PKCE 的内存 canary；不延迟 UI，不模拟登录成功。
5. 全仓门保留原失败：check:dev 第 1 轮停止于格式；第 2 轮 types 通过，tests 停在 config 依赖清单断言，已更新为实际新增 contracts 依赖并通过该包全部 179 tests。首次 check:contracts 捕获基线 P3 路由测试的完整 locale-keyed object，最小改为 typed Map 和存在性检查，仍由 SUPPORTED_LOCALES 驱动七语测试；19 tests 与原 checker 通过，未削弱门禁。
6. 默认镜像无 audit endpoint；仅本次命令使用官方 npm registry，最终 lock 的 high audit exit 0、无已知漏洞。安装时带入的无关 third-party-web 版本变化已撤回，frozen install 通过；只新增 OIDC 依赖及显式 workspace 依赖。
7. 原 management 回归首轮完成实际艺人上传/编辑、四类礼物、海报替换/恢复、七语后台、键盘与错误恢复，但停在旧粉丝页数量断言（87 PNG、86 axe 零问题）。该 P3 脚本仍预期 `Number.MAX_SAFE_INTEGER` 和“未实现购买”按钮；当前 P4 已使用 `CART_RUNTIME_MAX_QUANTITY` 与真实加购表单。只更新验证脚本，对齐合同并补键盘上限/复位、匿名空留言及加购入口检查；该内容夹具未组合 cart/checkout/payment，不能冒充交易验收。原失败目录 `output/checks/p3-06-management-center/run-2026-09-17T18-15-33.052Z-ab8f17fa/` 保留。

## 最终组合验收

- `corepack pnpm check:dev` 第 3 轮及最终轮均 exit 0。最终源代码候选的全仓格式/lint/typecheck/test/build 通过：typecheck 63/63 tasks（62 cached）、test 63/63 tasks（62 cached）、build 36/36 tasks（36 cached）；此前第 3 轮缓存分别为 4/31/31。任务图包括依赖 build，不能把 task 数写成单测数。最终日志 `check-dev-final.log`，摘要与 SHA 见 `final-gates.json`。
- 登录第 6 轮 `node apps/api/scripts/admin-access-http.mjs --ui` exit 0，`integration-2026-09-17T18-14-37.530Z/validation.json` 共 859 checks。真实 Chrome 152.0.7977.84 的 `browser-access/results.json`：537 assertions、21 cases、34 PNG/34 axe，violations/incomplete/pageErrors/observationFailures/unexpectedRequests 均为 0；七语 390×844 和 1440×900，以及 MFA/签名/交换断线、撤销、503、退出失败重试。六项资源清理全部通过；原生 API/Next 日志先停服务再对所有已知凭据逐值检查，未持久化 raw logs。
- `node scripts/check-adapter-boundaries.mjs` 与 `node scripts/check-build-artifacts.mjs` exit 0，32 package exports 可被 Node 导入；浏览器诊断/DNS 的 3 项 Node tests exit 0。
- `corepack pnpm check:contracts`、最终提交集合的 `corepack pnpm security:secrets`、`git diff --cached --check` 均 exit 0；最终锁的 `corepack pnpm audit --registry=https://registry.npmjs.org --audit-level high` exit 0，无已知漏洞；`corepack pnpm install --frozen-lockfile` exit 0。
- 完整 `corepack pnpm verify:management-center` 第二轮 exit 0：真实 PostgreSQL/TLS 对象存储/worker/API/Next 协议 7,345 checks，浏览器 1,481 assertions、7 cases、98 PNG/98 axe、7 次实际上传和 10 次操作、70 个公开页面，0 violations/观察失败/pageErrors。覆盖艺人、四类礼物与价格、海报替换及历史恢复；摘要及原路径/SHA 见 `management-regression-summary.json`。既有粉丝艺人照片叠字有 1 个 color-contrast incomplete（6 nodes），属于 P3 人工验收待续，不作为自动违规或已完人工验收；本夹具未组合交易，`commerceTransactionVerified:false`。
- 非作者复核：application/合同/API、持久化/迁移、OIDC adapter、BFF/UI 和旧管理验证脚本均 ACCEPT。最后 OIDC 审阅核对固定库的显式签名校验；旧管理脚本只对齐当前合同并增强检查，没有冒充交易验收。
- 最终 2,268 项源输入 SHA `ca3403c0e8056211bdb202b24b752f4a689a05e0c92b83e485bfdd9e34c8fc98`，复查无变更；原 4,633 个未跟踪文件重新逐项读取全部保持。见 `source-fingerprint-verification.json` 与 `preexisting-final-check.json`。后续只归档文档及证据，没有变更已验收源码。

## 复用入口与边界

运行方式、配置、六角色矩阵及恢复方式见 `docs/runbooks/admin-access-local.md`。以下命令均从仓库根目录运行，前缀 `mise exec node@24.20.0 --`：

- `corepack pnpm check:dev`：全仓 format/lint/typecheck/test/build，不等于完整 `pnpm check`。
- `corepack pnpm verify:admin-access:browser`：真实本地 TLS 身份源、PostgreSQL、API、Next 和 Chrome。
- `corepack pnpm verify:management-center`：原有图片上传、处理、发布和海报历史恢复。
- `corepack pnpm --filter @fan-support/persistence-postgres test:postgres:admin-access`：真实会话/并发/审计约束。

浏览器使用 Chrome 的手机尺寸模拟，不是本轮实体手机或读屏人工验收；自动 axe 不替代人工译审。新登录验收不上传图片，必须与完整管理回归分别报告。原始运行日志只在内存检查，不持久化授权码、令牌或私密内容；截图仅包含合成公开夹具和空管理视图。P3-06 性能与人工验收、P4-04 真实商户验收、云/staging 和发布门仍保留。

## S.U.P.E.R 与进度收口

| 项 | 结果与依据 |
| --- | --- |
| 1 单文件单职责 | PASS：合同、编排、OIDC、SQL、BFF Cookie 与界面分层 |
| 2 单函数职责 | PASS：begin/callback/logout 与 create/claim/complete/reject/revoke 独立，网络在 SQL 外 |
| 3 单向依赖 | PASS：Browser/Route → Application → Ports → Adapters，boundary checker 通过 |
| 4 无循环 | PASS：全仓 workspace/domain graph 门通过 |
| 5 schema 合同 | PASS：新增 18 个 v1 roots，606 个旧 roots 与 OpenAPI 保持 |
| 6 可序列化 | PASS：边界仅 versioned JSON；provider/SQL 对象留在 adapter |
| 7 环境隔离 | PASS：身份源、域名、密钥、TTL、MFA 策略来自配置；LOCAL_OIDC 仅 development |
| 8 显式依赖 | PASS：固定 openid-client、workspace 依赖和 frozen lock 通过 |
| 9 可替换 | PASS：IdentityProvider、AdminAccessTransactionManager 与独立 transport 隔离 |
| 10 验证 | PASS：受影响测试、全仓开发门、真实 PG/HTTP/TLS/浏览器、管理回归均通过，人工/生产门单列 |

`compatibility-super-review.json` 保留当时的 PENDING_FINAL_INTEGRATION 历史快照；该待办由本报告最终同候选结果闭合，不重写历史。P5-01 本地范围 DONE、Lane C 释放；P5-02 直接依赖 P5-01/P4-05/P4-06 全 DONE，转 READY。全局 28 DONE / 2 IN_PROGRESS / 1 READY / 18 PENDING = 49。交接见 `p5-02-handoff.md`，在本检查点尚未领取。仅本地提交，提交号以 Git 记录为准；不 push。
