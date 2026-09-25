# V2 上线总体方案

> 日期：2026-09-26
> 依据：`docs/analysis/2026-09-26-architecture-review.md`（全仓审查）、`docs/analysis/2026-09-26-competitor-benchmark-and-launch-gaps.md`（四站对标）、三家 PSP 官方文档调研、仓库实测
> 目标（用户 2026-09-26 确认）：给粉丝最好的交互感受（去掉不必要的繁琐操作），同时尽快上线
> 状态：待用户批准后按阶段执行

---

## 0. 决策回执（2026-09-26 用户拍板）

| # | 决策 | 落地形式 |
|:--|:--|:--|
| 1 | 礼物四分类：虚拟打赏 / 实物投喂 / 艺人心愿 / 周边 | 合同已支持（`giftKindSchema = VIRTUAL/PHYSICAL/WISH/MERCHANDISE/OTHER`，`packages/contracts/src/gift-commerce-profile.ts:9`）。补前台四分类浏览入口（本方案 §4-3）；虚拟礼物交付语义待用户三选一（§7-1） |
| 2 | 恢复榜单与公会赛展示，要比对标站好 | ADR-018 草案已就位（`docs/decisions/018-leaderboards-guild-results.md`，Proposed），规范 §2.2 随批准同步修订 |
| 3 | 支付"热更新"：预置 Airwallex/Stripe/PayPal + 通用通道，商户号下来即配置接入 | 采用"静态预置适配器 + 配置激活"架构（§3）。三家沙盒均免费即注册，适配器开发**现在就能开工**，不等商户号 |
| 4 | 授权推送 | **已完成**：2026-09-26 全部 45 个分支推送至 origin（github.com/CZ3700/diandan），66 个此前仅在本机的提交已备份 |
| 5 | 50GB 瘦身 | 实测构成与三档清单见 §5，零删除待用户确认清单后执行 |

---

## 1. 现状一句话

功能在本地 TEST 环境完整（浏览→加购→结账→TEST 支付→查单→后台运营全链路），安全内核质量高；但生产入口未接线、无真实收款/邮件/身份、零缓存、转化路径摩擦大（移动端约 15 次点按 vs 对标 4 次）；仓库 53GB 中 98% 是缓存、快照、证据和依赖。

## 2. 路线图总览

```
R0 地基清理(≈3天) ──► R1 生产就绪+支付预置(主线) ──► R3 商户接入+上线
                        │
                        └─► R2 体验与增长(部分并行)
```

| 阶段 | 内容 | 规模（人日） | 出口标准 |
|:--|:--|--:|:--|
| R0 地基清理 | 瘦身执行、.gitignore 加固、证据出库改造、ADR-018 定稿与规范修订 | 3–5 | 仓库 <8GB；`pnpm check:dev` 为日常门禁；新证据不再入库 |
| R1 生产就绪 + 支付预置 | 生产组合根、三 PSP 适配器（沙盒全绿）、邮件、身份、缓存/CSP、可观测、DB 加固、部署流水线、i18n 门前移 | 36–51 | staging 可用；任一 PSP 商户号到位后 ≤1 天配置接入 |
| R2 体验与增长 | 结账简化（15→6 次点按）、四分类浏览、短订单号、四态状态、送达照片、榜单+公会赛、埋点 | 41–45 | 移动端钱包流 ≤6 次点按；榜单上线且过隐私断言 |
| R3 上线 | 商户配置接入+小额验证、真实内容/政策/译审导入、灰度发布 | 视外部决策 | 规范 §18.4 Release Gate |

R1 与 R2 的纯前台项（价格直显、同意框合一、状态四态、短号，约 7 人日）可并行。人日为工作量单位；按本项目 AI 代理的历史速度，R1+R2 预计 **3–5 周日历时间**，前提是外部决策（主体、商户申请、域名、内容授权）同步推进。

---

## 3. 支付预置架构（决策 3 的落地设计）

### 3.1 模型：静态预置 + 配置激活

```
代码层(随版本部署，改动需发版)         配置层(热更新，P5-05 后台，60 秒传播)
┌────────────────────────────┐      ┌────────────────────────────────┐
│ airwallex adapter           │      │ provider 账户绑定(凭据 secret-ref) │
│ stripe adapter              │ ───► │ 渠道启停/市场/币种/金额规则        │
│ paypal adapter              │      │ 主备通道与灰度比例                │
│ generic gateway(已有 v1)     │      │ 健康熔断阈值                     │
└────────────────────────────┘      └────────────────────────────────┘
```

- 接线点：`createOptionalPaymentRuntimeComposition(environment, deployedProviders)`（`apps/api/src/payment-runtime-composition.ts:285`）——四个适配器工厂静态注册进生产组合根；未配置账户的适配器处于部署但休眠状态。
- 配置激活复用 P5-05 已验收的 draft→validate→publish→rollback 版本化发布。
- 这正是规范 §13.2/§13.3 的边界：规则/开关热更新，代码不热插拔。

### 3.2 三家调研结论摘要（全文见本文档附录 A/B/C 引用的调研记录）

| | Airwallex | Stripe | PayPal |
|:--|:--|:--|:--|
| 首选形态 | Hosted Payment Page（REDIRECT） | Checkout 托管页（REDIRECT） | JS SDK 按钮+托管卡字段（PROVIDER_COMPONENT） |
| 卡数据 | 不经过我们 | 不经过我们 | 只进 PayPal iframe |
| webhook 验签 | HMAC-SHA256 hex，`x-timestamp`+body | `Stripe-Signature` t/v1，HMAC hex | RSA 证书验签（非对称，独立实现） |
| 沙盒 | 免费即时无审批 | 免费即时无审批 | 免费即时无审批 |
| Apple/Google Pay | 托管页内置，后台开关 | 托管页零配置自动出现 | 需 Features 开通+域名验证 |
| 七语言 | 25 语言全覆盖 | Checkout 支持我们全部 7 语 | 支持 |
| 卡组织 | 含银联/JCB | 主流卡 | 含游客免账号刷卡 |
| 类目口径 | 以"实物礼品零售+代购履约"申报（对标两家已实证获批） | 实物类目低风险（guanlanvision 实证）；"创作者打赏"需预审批 | 忌 donation/打赏措辞；CN 主体走 PPCN 仅跨境（mxcheer 实证）；HK 主体更稳 |
| 特殊缺口 | login 换 30 分钟 token；request_id 非永久幂等 | 幂等键仅存 24h，需 metadata 检索兜底 | CAPTURE 无 void；approve 后需服务端 capture 回调（Saga 内受控扩展） |
| 适配器估算 | 8–10 人日 | 9–14 人日 | 12–16 人日 |

**开发顺序建议**：Stripe → Airwallex → PayPal。Stripe 沙盒工具链最顺（CLI 转发 webhook），先立适配器代码范式；Airwallex 是主候选商户；PayPal 形态差异最大（组件+capture 回调+证书验签）放最后。三个都做完约 29–40 人日；若要更快达到"可收款"，先做前两个即可，PayPal 移入 R2。

### 3.3 商户号到位后的"配置接入"清单（每家 ≤1 天）

1. Secret Manager 录入生产凭据（引用名见各调研记录 §5）
2. PSP 后台创建生产 webhook endpoint，录 endpoint 绑定
3. P5-05 配置发布：绑定账户 → 启用市场/币种/金额规则 → 灰度 internal→5%→100%
4. 一笔小额真实支付 + 退款验证（规范 §13.3-6，不可省）

### 3.4 类目风险与四分类的申报策略

- 平台是唯一收款主体（merchant of record），不向艺人分账——避免落入 marketplace 受限类目。
- 申报以**实物投喂 + 周边**（有采购与交付凭证）为主体类目；**虚拟打赏**表述为"由工作室履约的应援展示服务/数字应援凭证"，不用 donation/tipping 字样。
- **艺人心愿**若包装成"资金转交承诺"是审批最大变数——按"平台代购目标礼物"表述。
- 保险策略：虚拟类目在 Airwallex 和 Stripe 各申请，哪家先批用哪家；两家均可同商户渐进开通新类目。

---

## 4. 粉丝体验简化（R2 核心，摘自体验设计记录）

现状：移动端首页→支付完成约 **15 次点按**；目标：钱包流 **≤6 次**。

| # | 变更 | 要点 | 人日 |
|:--|:--|:--|--:|
| 1 | 同意框 4→1 | 一个总勾选 + 四个可点开链接；合同 policies 数组不变，一次勾选写入全部 policyKey+版本，法律留痕不减；按市场配置 extraConsents 应对 EU 撤回权等特例 | 1.5 |
| 2 | 价格直显 | 单市场（USD）时服务端置 defaultMarket，全站直显价格、隐藏选地区步骤；结账仍服务端重验，符合 ADR-017 | 2 |
| 3 | 首页四分类 | 满屏偶像海报首屏（规范 §5.2 原有要求）+ 四分类磁贴（虚拟打赏/实物投喂/艺人心愿/周边），目录 API 加 `kind` 参数 | 3.5 |
| 4 | 订单短号 | 新列 `public_order_no`（如 FS-7K3M9C，随机 base32，规避连续号）；邮件/成功页/查单/客服全用短号，UUID 退回内部 | 2 |
| 5 | 状态四态化 | 粉丝端只见 已付款→准备中→已送达（+退款中）；映射函数进共享包配单测；隐藏"付款争议"等内部维度 | 1.5 |
| 6 | 送达照片 | 运营标记送达时传 1–3 张照片（复用媒体管线），查单会话内展示——四个对标站都没有，最强信任差异点 | 4 |
| 7 | 钱包按钮位 | 结账页预留 Apple/Google Pay 槽位，由 capability 接口下发（不硬编码）；实装随 PSP 联调 | 1 |
| 8 | 虚拟礼物交付语义 | 待用户三选一（§7-1），建议 A 默认 + B 可选 | 2 |
| 9 | 埋点验收 | 规范 §16.3 的 13 个事件补齐漏斗段，验收点按数 | 0.5 |

合计 ≈18 人日。第 1/2/4/5 项（约 7 人日）纯减摩擦，可立刻与 R1 并行。

## 5. 仓库瘦身（53GB 实测与三档清单）

### 5.1 实测构成

| 路径 | 大小 | 性质 |
|:--|--:|:--|
| `.turbo/cache` | **27.4 G** | turbo 构建缓存，纯可重建 |
| `.turbo/p3-06-*` 4 个仓库快照 | **6.0 G** | Codex 留下的 worktree/克隆，各含整套 node_modules+.git，注册路径 `/Users/mario/...` 已失效 |
| `output/` | **7.6 G** | 验收证据（受控 1.0G + 未跟踪 5.5G + playwright 1.4G 中的大文件；含 462MB 诊断视频、345MB tar.gz） |
| `node_modules` | 4.3 G | 可重装 |
| `apps/*/.next` | 4.2 G | 构建产物，可重建 |
| `.git` | 2.0 G | 其中 **1.45 G 只被 Codex checkpoint ref 引用**；output 历史 0.48 G；纯代码史 ~50 MB |
| `.turbo/management-center-preservation` 等 | 1.2 G | 证据备份 |
| 外层 `__MACOSX/` | 0.09 G | 解压垃圾 |
| **真代码资产**（packages/apps 源码/docs/research/database） | **~0.13 G** | — |

### 5.2 三档清单（待用户一句确认后执行）

**① 无风险直删，≈31.7 G**：`.turbo/cache`（27.4G）、`apps/*/.next`（4.2G）、各 `dist`/`coverage`/`*.tsbuildinfo`、外层 `__MACOSX`、`.DS_Store`。全部可由 `turbo run build` 或自动重建。node_modules（4.3G）可重装但日常开发要用，**建议保留**。

**② 归档后删，≈12.7 G**：未跟踪 output 证据 5.5G、`.turbo` 证据备份 1.2G、3 个失效 worktree 4.9G（先 `git worktree prune`）、独立克隆快照 1.1G（先确认无独有提交）。7z 归档到项目外盘、校验可解压后删除。**保留 `output/playwright/p2-04`（18M）与 `p2-05`（15M）**——门禁 `check:ui-composites`/`check:ui-motion` 读取它们（`scripts/check-ui-composites.mjs:766-781`），其余 output 均无门禁依赖。

**③ 需单独决策**：
- ③1 删 checkpoint ref + `git gc`：释放 **1.45 G**，不改历史、不需 force push，只丢 Codex 回合快照。低风险，建议随①②一起做（先 `git clone --mirror` 备一份）。
- ③2 `git filter-repo` 把 `output/` 与 `contracts/generated/` 从历史移除：.git 降到 ~55 MB，但**重写全部提交哈希、需 force push、现有 clone 作废**。建议 R0 不做，等主干开发稳定后择机；也可以永远不做（推送已完成，2G 的 .git 不影响开发）。

**执行后**：53 GB → 约 **7 GB**（含 node_modules）；工作拷贝纯资产 <1 GB。

### 5.3 防复发

- `.gitignore` 新增：`output/`、`packages/contracts/generated/`、`__MACOSX/`、`*.pem`、`*.key`、`*.p12`
- 证据出库改造：`check-ui-composites.mjs:766-781` 与 `check-ui-motion.mjs:724-741` 的入库证据校验改为读本地 artifact（`verify:*:browser` 独立出证），`output/` 入 ignore 后自动断根
- 立规矩：不在 `.turbo/` 下建 worktree 或快照（正因它被 ignore，6G 快照才藏进盲区）

## 6. R1 生产就绪工作分解

| # | 项 | 内容 | 人日 |
|:--|:--|:--|--:|
| R1-1 | 生产组合根 | 把 local-experience 的完整接线转正为类型化生产代码：admin/SEO/webhook/payment 路由全部注册；Test 组合与生产 dist 解耦 | 5–8 |
| R1-2 | i18n 门前移 | 审校校验移到构建期（CI 失败而非运行时抛错）；en 源审校 APPROVED | 2 |
| R1-3 | PSP 适配器 ×3 | 见 §3.2，Stripe→Airwallex→PayPal，含 conformance 与沙盒联调 | 29–40（前两家 17–24） |
| R1-4 | 邮件适配器 | SES 或 Postmark + 发信域名 SPF/DKIM/DMARC；查单链接与订单通知走真实邮件 | 3–4 |
| R1-5 | 后台生产身份 | 真实 OIDC 身份源 + MFA；解除 `FAN_SUPPORT_ADMIN_MODE` 仅限 development 的闸门 | 3–4 |
| R1-6 | 缓存 + CSP | 公开页 CDN `s-maxage≤60`+ETag+精确 purge（Worker purge 链路已有）；CSP/Permissions-Policy 全站补齐 | 4–6 |
| R1-7 | 可观测 | OTel 导出器、日志事件枚举补全（修复 review_required 被吞）、真实健康检查、CloudWatch 告警 | 4–5 |
| R1-8 | DB 加固 | 库存锁升级死锁修复、369 个缺索引 FK 中高频路径补齐、连接池/超时、最小权限账号 | 4–6 |
| R1-9 | 部署流水线 | CI 构建推送镜像、迁移执行、staging 真实 tofu apply + smoke、回滚脚本 | 5–8 |

## 7. 确认记录（2026-09-26 用户全部批复）

| # | 事项 | 用户决定 | 落地 |
|:--|:--|:--|:--|
| 1 | 虚拟礼物交付语义 | **只选 A**（应援记录+榜单积分） | ADR-019 Accepted；B 仅作未来可选档，C 不做 |
| 2 | 瘦身执行 | **确认执行** ①+②+③1 | 2026-09-26 执行，结果见 §5.4 执行记录 |
| 3 | ADR-018 | **采纳建议**（应援值积分制；月榜+赛季榜） | ADR-018 转 Accepted |
| 4 | PSP 开发顺序 | **按建议**：Stripe→Airwallex→PayPal | R1-3 按此排期 |
| 5 | 商户申请 | **已开始申请** | 申报口径按 §3.4；沙盒开发即刻并行 |

## 8. 流程约定（自本方案批准起）

- 日常门禁：`pnpm check:dev`（15–35 秒）；完整 `pnpm check` 只在里程碑跑。
- 证据不入库：验证产物写 `output/`（已 ignore），结论摘要写 phase 文档。
- 进度记录延续 `docs/progress/`，但单条记录 ≤10 行；状态引入 `LOCAL_ACCEPTED`（本地完成待外部）与 `BLOCKED_EXTERNAL`（等外部决策）。
- 每完成一个 R1/R2 子项即本地提交并推送（push 已获授权）。
