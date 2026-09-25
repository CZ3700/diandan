# P5-08 持久本地体验与离线部署工具验收

结论：`ACCEPT_LOCAL_SCOPE`。业务、浏览器、恢复、离线基础设施、独立复核和暂存后最终秘密扫描全部通过。本轮仅完成 P5-08 的有限本地范围，任务整体仍为 `IN_PROGRESS`，Lane D 释放。31 DONE / 6 IN_PROGRESS / 0 READY / 12 PENDING = 49，Phase 6/7 仍 LOCKED，后继按 ADR-016 逐项核对与激活。

## 可体验的成果

使用 [本地体验操作手册](../../../docs/runbooks/local-experience.md) 的已验收实例命令，打开专用 Chrome 中的前台、管理中心和测试收件箱。完整环境包含真实 PostgreSQL、S3-compatible 媒体、四个应用进程，以及仅供本地的 TLS OIDC / TEST PSP / 加密邮件服务。管理中心上传艺人、礼物和海报，前台购买、订单处理与退款使用仓库现有业务合同和应用流程。停止再启动保留原内容、订单、支付配置、媒体及加密密钥。

生产前台改动仅为有效 PSP 回跳时，对 REQUIRES_ACTION 继续有界、只读查询；未增加支付写命令，支付成功仍由验签服务端证据确认。本地入口负责服务生命周期、数据归属和恢复，不把 TEST 实现作为正式供应商。

## 最终统一证据

执行：`mise exec node@24.20.0 -- corepack pnpm verify:local-experience --keep`。权威报告 [acceptance/report.json](acceptance/acceptance-e143d720dd1a4357a3c3/report.json)，9条子命令退出0、统一PASS。

| 验证 | 实际结果 |
| --- | --- |
| 本地工具单测 | 57/57，包括实际8进程锁竞争、停止/reset归属、恢复、TLS、OIDC、首页和完整验收报告拒绝局部结果 |
| PostgreSQL | 实际18.6中断首次初始化/重启4断言；政策/权限/支付bootstrap及保留已发布头26断言 |
| 独立服务 | TLS OIDC、持久TEST PSP、加密本地邮件；两次服务重启，capture1/refund1、2签名事件恢复、无外部邮件 |
| 首轮真实浏览器 FULL | 799断言 / 18场景 / 52PNG / 52axe，NEW_BROWSER_UPLOADS |
| 同实例停止再启动 RESTART | 109断言 / 1场景 / 3PNG / 3axe；原内容、订单、退款、取消、配置与图片读回 |
| 合计 | 908浏览器断言 / 19场景 / 55PNG / 55axe；0违规、0incomplete、0pageerror、0观察失败 |
| 重启后只读永久回执 | [root/accepted-receipts.json](root/accepted-receipts.json)：7断言；已退款且送达1单、未付款取消1单，capture1/refund1、服务端签名接收回执2 |

首轮报告：`output/playwright/p5-08-local-experience/acceptance-e143d720dd1a4357a3c3-1790153667799/report.json`。重启报告：同目录前缀的 `acceptance-e143d720dd1a4357a3c3-1790153747494/report.json`。原图与facts随报告保存。完整流程从新实例实际上传艺人/礼物/海报开始，覆盖七语言×390×844/1440×900、真实加载内容、键盘/reduced motion、私密结账、TEST托管支付、安全邮件查单、审核/准备/送达/退款、第二单取消、独立七语配置复核、两次发布和回退。

实际 PSP 回跳同一 attempt 从 REQUIRES_ACTION 自动查询到 SUCCEEDED，只有1次创建支付POST，没有手动刷新。重启前后两份facts完全相同；统一入口同时在内存逐字节比较持久配置、TLS/OIDC密钥和媒体，任何差异都拒绝PASS，秘密或秘密指纹不写入公开报告。

页面错误与console分开：两个报告各保留登录阶段 `/api/admin/session` 的401 console消息，随后正常OIDC登录成功；网络记录也保留导航期间net::ERR_ABORTED，未宣称所有请求成功。订单页开发模式还存在React调试eval被正确CSP拒绝的提示，已通过源文件与实际原订单读回独立分类；未隐藏徽标、未添加unsafe-eval。详见 [development-csp-note.md](root/development-csp-note.md)。0pageerror不表示0console消息，production源码排除该探测不等于完成真实生产浏览器验收。

## 组合质量与离线基础设施

- `mise exec node@24.20.0 -- corepack pnpm check:dev` 退出0：[root/check-dev-accepted.txt](root/check-dev-accepted.txt)。format/lint/workspace/domain门通过；typecheck64/64、test64/64、build36/36，缓存分别63/63/35。这些是任务数，不冒称全部重新执行，不声称本轮跑了更广的完整 `pnpm check` 或远程CI。
- 生产支付查询修复保留先RED后GREEN，非作者独立执行4项轮询测试并核对FULL实际延迟回跳通过，见[复核记录](reviews/quality-review-resumed.md)。合同生成及locale唯一来源、adapter依赖、32个包export导入均通过，见root对应记录。
- 三个OpenTofu root、六模块：真实固定工具1.12.6/provider6.66.0执行隔离backend-disabled init/validate/fmt及10次非refresh mock plan，14命令全退出0、21输入SHA可复核；[iac/offline-results.json](iac/offline-results.json)、[IaC细节与剩余门](iac/final-verification.md)。`cloudEvidence=false`；没有云账户读取、真实plan/apply或推镜像。
- 暂存后的 `mise exec node@24.20.0 -- corepack pnpm security:secrets` 退出0，见[root/secrets-final.txt](root/secrets-final.txt)。保留初次扫描因生成provider二进制体积失败及逐SHA迁移到依赖缓存的事实；扫描器规则未放宽。
- 源码 `git diff --check` 退出0。首次完整暂存检查只发现CLI原样输出的尾随空白/空EOF行；仅规范化这些文本转录的空白，原件本地保留、前后SHA记于[root/transcript-normalization.json](root/transcript-normalization.json)，完整暂存检查随后通过；精确暂存名单排除实例数据库、配置、密钥、浏览器profile、下载二进制、provider缓存与原有未跟踪文件。

## 兼容、保护、复核

基线 `fb88492eba0b9ef4ec3144ea12c106224c1cc8a8`。原2587源输入只允许 package.json 与3个前台支付轮询TS变更；原5993个未跟踪文件逐SHA不变。228个原contracts文件、700 schema roots / 127 OpenAPI路径 / 204 components、74 SQL / 37迁移均保持，见 [root/protection.json](root/protection.json) 和 [root/compatibility.json](root/compatibility.json)。候选2690输入及完整逐文件hash在 [candidate-source.json](candidate-source.json)。

候选源摘要：`d724257ab6864faa7a17db03a645f2cf6bdf6c04feec5e00105674f4637bf294`（排序后的path + NUL + sha256 + LF，UTF-8 SHA256）。停止本地Next后再取样，生成的next-env已恢复；运行体验时Next会重新生成文件，正常停止后由本地助手恢复，不作为代码修改提交。

非作者复核 [quality-review-resumed.md](reviews/quality-review-resumed.md) 为ACCEPT_LOCAL_SCOPE。S.U.P.E.R十项全部通过：单模块/单函数职责、单向依赖、无循环、合同、可序列化、环境配置分离、显式依赖、可替换边界、组合验证。锁模块由审查者修复，root另行逐行复核其选择/票号/创建回收释放协议，未冒领自审为独立批准。根协调者已目视最终手机首页、桌面管理中心与礼物页、手机付款订单等实际页面。

## 失败历史和下一步边界

[失败历史](root/failure-history.md)保留真实首次失败及修正：OIDC编码、TLS图片优化、严格双端首页媒体、并发陈旧锁、观测trace导致回调503、延迟回跳只读查询、SSR就绪、列表返回/搜索竞态、政策双组断言、重启市场币种上下文。失败/局部报告不能代替本次全新FULL→RESTART成功。

现在已可在本机完整体验TEST功能，并在体验反馈后准备线上测试资源。按已批准架构进一步确认云账号、预算/配额和区域，再处理staging授权；尚无实际云部署。本地证据不能替代生产business composition、真实IAM/KMS/对象存储/CDN/WAF、身份/MFA恢复、邮件、正式素材与关键译审、商户sandbox/真实小额资金、备份恢复/RPO/RTO、UAT/灰度/上线签署。仅本地提交，不push、不正式发布。
