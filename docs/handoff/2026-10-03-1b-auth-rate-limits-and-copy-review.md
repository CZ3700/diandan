# 交接：审计整改 1B（认证与限速）、CI-3，以及七语文案审校与批准

> 日期：2026-10-03
> 执行：Claude（Windows 端，Cz 会话）
> 分支：`v2/r1-production`。**本地 8 个提交领先 origin，尚未推送**（见“在途”）。stg 仍停在 `e07161fa`，本轮未部署、未改 stg 或生产。
> 冷启动顺序：AGENTS.md → [当前进度](../progress/launch-progress.md)（P-20261003 “上线文案审校”“审计整改 1B”两节）→ 本文件 → [文案审校结论](../analysis/2026-10-03-copy-review.md) → 主审本机的审计报告（`docs/analysis/2026-10-03-final-code-audit.md`，不入库）第 4、5 节
> 上一份交接：[2026-10-03-pre-launch-audit-and-gate-restore.md](2026-10-03-pre-launch-audit-and-gate-restore.md)

## 背景

用户要求按上一份交接继续推进上线前整改，并把七语言文案审校交给本会话，目标两条：保障销售转化、规避站点责任和风险。会中用户补充：政策正文由 Mario 编辑上传，我们只负责把后台功能做好。

## 已完成

| 提交 | 内容 | 验证 |
|---|---|---|
| 73c27927 | AUTH-01：绑定 TOTP 的账号，只有第二因素成功才清零失败计数 | PG 脚本先红后绿，161 项 PASS |
| d8b19c6f | AUTH-02：WAF LOGIN 作用域覆盖内置账号 5 个登录路由 | node 测试 3/3；本机无 tofu，未做 validate；**未 apply** |
| 18098c9f | TXN-02：`FAN_SUPPORT_TRUSTED_PROXY_CIDRS` + `request.ip` + BFF 转发 XFF | API/BFF/配置用例先红后绿 |
| 82062157 | CI-3：turbo test 透传 `VITEST_MAX_WORKERS`；本机环境脚本设为 4 | 之后三轮 `check:dev` test 步无超时 |
| 8049ebb3 | 商城 + 后台 i18n 文案审校；新增 6 键并接入组件；用户批准的显示修正 | 商城 1034、后台 721、i18n 74 项；浏览器 266/266 |
| de7c2e22 | 邮件模板 v3（v1/v2 保留历史重放） | i18n 通知 25 项（含 v3 历史快照） |
| 5b1ee806 | 写入批准记录：商城/后台 APPROVED@8049ebb3，邮件 v3 APPROVED@de7c2e22 | `check:dev` 全通过 |
| 93f988e7 | 进度登记 | — |

另外：1A 的 CI 37111257819 已全绿（含完整 `pnpm check`），上一会话已在 a3132d2f 记录。

## 关键决策及理由

- **TXN-02 用独立变量，而不是写进查单 JSON 配置**：可信代理是 Fastify 实例级设置（`trustProxy`），放进合同包的查单 schema 会牵动 53MB 的合同产物再生成。未设置时 `request.ip` 就是 TCP 对端，与旧行为完全一致。只接受精确地址或网段，拒绝 `true`、跳数、`/0`，IPv4 前缀不得短于 /8、IPv6 不得短于 /16，防止退化成“信任一切”。staging/production 配置了查单却缺该变量时拒绝启动（生产从未部署，不破坏现有环境）。
- **stg 依赖 Caddy 改写访客自带的 XFF**：Caddy 2.5+ 对不受信任的来源会覆盖 X-Forwarded-For，BFF 原样转发，API 只信任回环。生产应填 VPC CIDR + CloudFront origin-facing 前缀，否则桶会退化为“每个 CloudFront 边缘一个”。BFF 截断只从左侧丢弃，伪造前缀不可能挤掉右侧的真实地址。
- **文案不写死品牌和邮箱**：AGENTS.md 禁止硬编码正式品牌值，所以界面和邮件只写“联系我们的客服”，通过网站客服页联系。
- **邮件改文案必须新建 v3**：v2 已在 stg 发过，README 规定首发后冻结。v3 复用 v2 的布局和渲染器，变量哈希不变；PREPARING 邮件只写“已开始准备”，因为邮件可能被晚读或重放，不能承诺当前进度（v2 测试原本就有这一约束；英文初稿违反后已改）。
- **批准记录写法**：用户明确要求“去掉所有的审计标识字符，按正式上线水准发布”。所以记录写 APPROVED，审校人和译者都写 Cz（真实批准人），不加 AI 或草稿标注。`apps/admin` 里财务、支付、异常模块自带的文案清单不在本轮审校范围，**保持 DRAFT，不能顺手标批准**（只是测试证据，运行时不检查）。
- **用户决定**：艺人为官方授权，不加“非官方服务”声明；结账页不加未成年人提示；三类显示修正并入本批。
- **否决的审校建议**：心愿公开名输入框 `maxLength=80` 是有意设计（合同按 UTF-16 码元限 80、按字符限 40），不改。
- **门禁与文案编辑不能并行**：`check:dev` 运行中改 i18n 会污染测试结果（本轮踩过一次）。语言 agent 只把结果写到草稿区，由主会话统一写入仓库。

## 在途

- **推送被拦截**：`git push origin v2/r1-production` 被自动模式分类器判定为 “Production Deploy” 拒绝。按规则没有绕过。8 个提交在本地（73c27927 … 93f988e7）加本交接提交，需要用户自行推送或调整权限后再推。推送后看新一轮 CI，重点是 quality（完整 `pnpm check`）、journey 与 catalog（浏览器流程会经过新文案和新组件位置）。
- 没有改到一半的代码；工作区干净（本机审计报告除外，已 exclude）。

## 下一步

1. 用户推送 → 等 CI，把结果补进进度表的 1B 与文案两节。CI 若有失败，先看是否为新文案导致的断言（撇号会被 HTML 转义成 `&#x27;`，测试里要转义后再比）。
2. 用户批准后，新会话推进 **1C 交易正确性**（本机审计报告第 4 节）：TXN-01 拆锁加退避、TXN-03 第一步放宽可履约条件（业务决定 1：取消单行等于整行退款）、PAY-01/PAY-04 的非破坏性部分（退避、告警、重发）。`test:postgres` 全量约 40 分钟。
3. 生产变更（须逐项报出命令并确认）：WAF apply（AUTH-02，以及 ORDER_ACCESS 的 `waf_enforce`）；生产配置补 `FAN_SUPPORT_TRUSTED_PROXY_CIDRS`；`siteName` 设为正式品牌，Stripe 账单描述符与之一致。
4. stg 统一验收时：部署前冷备份；补做礼物袋、结账、订单页的七语视觉核对（本机缺 S3 模拟做不了）；stg 运行时会自动带上回环可信代理。
5. 交给 Mario 的事项：政策配置时，隐私政策更宜作为告知链接，不放进“同意”列表；`docs/analysis/2026-10-03-copy-review.md` 第 4 节列出的产品问题（暂缓订单显示为“准备中”、虚拟礼物留言如何转交、留言删改只是标签、展馆下架入口、链接无法自助重发）。
6. 可选：`apps/admin` 各模块文案的审校与批准（运营内部可见，不影响转化）。

## 环境注意

- 每个 Bash 调用前先执行 `source /c/Users/admin/.tools/xiadan-env.sh`；脚本现在还会导出 `VITEST_MAX_WORKERS=4`（CI-3）。
- 在 `node -e '…'` 或 heredoc 里写正则和转义引号，反斜杠会被吃掉（本轮两次）。含正则或引号的改动要写成脚本文件，或者用 Edit 工具。
- 不要在 Bash 前台命令里用 `&` 起后台进程，改用 run_in_background。Next dev 停掉后，子进程可能还占着 4600 端口，要 `taskkill`。Next dev 会改 `apps/storefront/next-env.d.ts`，提交前要还原。
- 本机 `check:infrastructure` 因 Windows 路径分隔符必失败（脚本按 `/` 比较），真实校验还需要 tofu；CI 不跑它。
- 文案工具都在会话草稿区，不在仓库里：`apply-copy.mjs` 按键替换、`refresh-review-hashes.mjs [--approve <commit> <reviewer>]` 从 dist 回写哈希、`generate-v3-evidence.mjs` 生成 v3 审批记录和快照。将来再改文案时，可按同样思路重写这几个脚本。顺序是：先 `tsc -p packages/i18n/tsconfig.build.json`，再改哈希，最后改测试。
- 浏览器核对：`output/checks/l2-17/harness/fixture-server.mjs 4610 4611` 加 `run-next.sh`，然后跑 `node output/checks/copy-20261003/verify-copy.mjs`。
- 提交只能逐个 `git add` 指定文件。
