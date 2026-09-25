# 附录：仓库瘦身执行手册 与 粉丝体验变更清单（全文）

> 来源：2026-09-26 实测与设计。配套方案：docs/plan/2026-09-26-v2-launch-plan.md §4/§5

所有关键测量已齐（53GB 已拆干净）。汇总交付。

# 50GB 仓库瘦身：实测构成 + 三档执行清单（本次零删除、零修改）

## A. 实测构成（合计 ≈53 GB，与"50 多 G"吻合）

| 路径 | 实测大小 | 性质 |
|:--|--:|:--|
| `.turbo/cache` | **27.4 G**（22,487 项，7,494 个 tar.zst，最大单文件 1,047 MiB） | turbo 本地构建缓存，纯可重建 |
| `.turbo/p3-06-*` 4 个仓库快照 | **6.0 G**（perf-worktree 2.05 + shared-ui-0dabba9 1.54 + shared-ui-check 1.27 + critical-path-clean-snapshot 1.11） | Codex 留下的 worktree/完整克隆，**各含整套 node_modules+.git**；3 个是主仓 worktree（注册路径 `/Users/mario/...` 已失效，`git worktree list` 标 prunable），clean-snapshot 是独立 `.git` 克隆 |
| `.turbo/management-center-preservation` | 1.15 G | 证据备份（内容只有 output/） |
| `.turbo/font-sources` 等其余 | 0.06 G | 字体源 27M + 证据小备份 33M |
| `output/` | **7.6 G**（checks 6.3 + playwright 1.4） | 验收证据：受控 6,928 文件≈1.0 GiB，未跟踪 8,457 文件≈5.5 GiB；含 462 MiB 诊断 .mov、345 MiB tar.gz |
| `node_modules` | 4.3 G | 依赖，可重装 |
| `apps` | 4.2 G | **几乎全是 `.next`**（storefront 2.9 + admin 1.3），源码仅几十 MB |
| `.git` | 2.0 G | 实测其中 **1.45 GiB（7,159 个对象）只被 codex checkpoint ref 引用**（排除全部分支和 reflog 后）；output/ 历史再占 0.48 GiB；纯代码+文档史仅 ~50 MiB |
| 外层 `__MACOSX/` | 0.09 G | macOS 解压垃圾（外层无 zip 原件） |
| packages/docs/research/scripts/database | ~0.13 G | 真代码资产；含入库生成物 `packages/contracts/generated/contracts.schema.json` 51.5MB + `openapi.json` 8.3MB |

## B. 三档执行清单

**① 无风险立即删（≈31.7 G，另 node_modules 4.3 G 单列"可重装"）**

| 路径 | 释放 | 重建方式 |
|:--|--:|:--|
| `.turbo/cache` | 27.4 G | 下次 `turbo run build/test` 自动重建（首轮变冷、变慢而已） |
| `apps/storefront/.next`、`apps/admin/.next` | 4.2 G | `turbo run build` |
| `apps/*/dist`、`packages/*/dist` | ~27 M | `turbo run build` |
| `*.tsbuildinfo`、`packages/domain/coverage` | ~1.2 M | tsc/vitest 自动再生 |
| 外层 `__MACOSX/`、各处 `.DS_Store` | 0.09 G | 无需重建 |
| `node_modules`（可重装） | 4.3 G | `corepack pnpm install`；不缺空间可不删 |

**② 归档后删（≈12.7 G；先 7z 到项目外盘，校验归档可解再删）**

| 路径 | 释放 | 命令要点 |
|:--|--:|:--|
| output/ 未跟踪证据（8,457 文件） | 5.5 G | `git -c core.quotepath=false ls-files --others --exclude-standard -z -- output > list0`；`7z a -mx=5 -spf D:/backup/evidence-20260926.7z @list`（列表转 CRLF 文本喂 7z）；核验后按同一清单删除。**保留 `output/playwright/p2-04`(18M)、`p2-05`(15M)——它们是受控且被门禁读取的** |
| `.turbo/management-center-preservation` + `p3-06-critical-path-evidence-backup` | 1.2 G | 直接 7z 整目录 |
| 3 个失效 worktree（perf-worktree/shared-ui-0dabba9/shared-ui-check） | 4.9 G | 7z 后 `rm -rf` + `git worktree prune`（本就 prunable，无联动风险） |
| `p3-06-critical-path-clean-snapshot`（独立克隆） | 1.1 G | 先在其内 `git log --branches --oneline` 确认无独有提交，再 7z 删 |

**③ 需用户决策（git 历史层面，不可逆，先 `git clone --mirror` 备份）**

1. **删 checkpoint ref + gc**：`git update-ref -d refs/codex/turn-diffs/checkpoints/d807.../12bda615-...` → `git reflog expire --expire=now --all && git gc --prune=now`。实测释放 **1.45 GiB**，.git 2.0G→约 0.55G；不改历史、不需 force push，只丢 Codex 回合快照（架构评审估 1.08 GiB，实测更多）。
2. **filter-repo 移除历史中的 `output/`（0.48 GiB）与 `packages/contracts/generated/`（7 MiB）**：`git filter-repo --invert-paths --path output --path packages/contracts/generated`。效果：.git 最终 ~50–60 MiB。后果：**全部 commit 换哈希，须 force push origin（CZ3700/diandan）所有分支，现存 clone/worktree 作废**；p2-04/p2-05 证据须留在工作区（转 ignored）或先做 C 项改造，否则门禁红。

## C. 防复发

**.gitignore 新增**：`output/`（配合 ③2 或 `git rm -r --cached output`）、`packages/contracts/generated/`、`__MACOSX/`、`*.pem`/`*.key`/`*.p12`（评审 A3）。另立规矩：**禁止在 `.turbo/` 下建 worktree/快照**——正因 `.turbo/` 被 ignore，6 G 仓库快照才藏进了盲区。

**"删除后哪个门禁变红"精确对应**：
- 删 `output/playwright/p2-04` → `scripts/check-ui-composites.mjs:24`（评估路径）、`:766-781`（`validatePersistedUiCompositeEvidence`，含源码指纹比对）报 "persisted P2-04 browser evidence is missing or invalid" → `check:ui-composites`（package.json:21）红 → `pnpm check`（package.json:13）红。重建：`pnpm verify:ui-composites:browser`（package.json:44）。
- 删 `output/playwright/p2-05` → `scripts/check-ui-motion.mjs:25`、`:724-741` 同理 → `check:ui-motion`（package.json:22）红。重建：package.json:45。
- **其余 output/ 全部无门禁读取，安全**：`check-infrastructure.mjs:381`、`verify-local-experience.mjs:23`、`verify-regression-journey.mjs:19`、`accessibility-owned.mjs:20`、`verify-psp-onboarding.mjs:51` 均 mkdir 后只写；`check-ci.mjs:92,100` 只断言 workflow 文本。
- 删 `packages/contracts/generated`（磁盘文件）→ `check:contracts`（package.json:18）先跑 build 再生成后由 `scripts/check-contracts.mjs:12,155-173` 比对，仍绿；出库为 ignored 即可。

**停止"证据入库"的改造点（评审 D1 的根）**：把 `check-ui-composites.mjs:766-781` 与 `check-ui-motion.mjs:724-741` 的持久化证据校验改为读 CI artifact（或从 `pnpm check` 链摘除、由 `verify:*:browser` 独立出证），`verify-ui-*-browser.mjs` 继续写 `output/`，一旦 `output/` 进 .gitignore 即自动断根。

**执行顺序建议**：①（半小时内回收 ~32G）→ ②归档（约 1 小时）→ ③1（低风险）→ C 改造落地后再做 ③2。全部完成后工作拷贝 <1 G（不含 node_modules），.git ~55 MiB。

---

# 粉丝体验简化——页面级变更清单

**现状诊断**（截图实测）：礼物详情页不显示价格（须先"选择艺人"+"选择地区与币种"两步才出价）；结账页要勾 4 个同意框；订单页展示 UUID 订单号和"付款争议：无争议""订单状态：处理中"等内部维度。移动端从首页到完成支付约 **15 次点按**（礼物卡→选艺人 2 步→选地区 2 步→加购→进袋→去结账→4 勾→确认→选支付→付款），对标 Shopify 钱包流约 4 次。摩擦是我们对四个对标站唯一的全面落后项（对标报告 §2、§4.B）。

## 变更清单

| # | 项目 | 现状 | 变更 | 改动面 | 转化作用 | 人日 |
|--|--|--|--|--|--|--:|
| 1 | 同意框合一 | 4 个独立勾选 | 1 个总勾选："我已阅读并同意《转交说明》《隐私》《退款》《服务条款》"（四链接可点开）。合同层 `policies` 数组不变，一次勾选写入全部 4 个 policyKey+版本+时间戳，法律留痕不减。首发美洲：美国判例认可此类 clickwrap；德国上线时另需按钮文案明示付款义务（Button-Lösung），EU 虚拟礼物"立即履约放弃撤回权"需单独勾选——做成按市场配置的 extraConsents 列表 | 前台+合同 | 少 3 次点按，减少犹豫点 | 1.5 |
| 2 | 价格直显 | 详情页价格藏在"选择地区"之后 | 仅发布 1 个市场（USD）时服务端置 defaultMarket，全站直显价格、隐藏地区步骤；结账仍服务端重验（符合 ADR-017"不虚构报价"——单市场即已确认）。多市场后改为 geo-IP 预选+页脚切换的渐进披露 | 前台+API 配置 | 消除最大流失点（无价不下单） | 2 |
| 3 | 首页改版 | 首屏分栏、无分类入口 | 满屏偶像海报首屏（§5.2 本要求）；海报下加四分类磁贴：虚拟打赏/实物投喂/艺人心愿/周边，点击进 `gifts?kind=` 筛选。`gift_kind` 字段已存在（VIRTUAL/PHYSICAL/WISH/MERCHANDISE），目录 API 加 kind 参数并入 URL 状态（§5.5.1） | 前台+API | 意图分流，缩短找礼路径 | 3.5 |
| 4 | 订单短号 | 展示 UUID | 加列 `public_order_no`（唯一，如 FS-7K3M9C：前缀+6 位 Crockford base32 随机码——§5.8 禁止连续号暴露，故不用纯序列）。查单 URL、邮件、成功页、客服全用短号；UUID 退回内部。仅凭短号不可读单（仍需访问会话） | DB 1 迁移+API+邮件 | 可口述、可截图、显专业 | 2 |
| 5 | 状态四态化 | 暴露付款争议/处理中等 4 维度 | 查单页只显示 已付款→准备中→已送达（+退款中分支）单条时间线+送达照片位；映射函数进共享包并配单元测试（§12.2 已预留此设计）；PAID_REVIEW 等对粉丝一律显示"准备中" | 前台+共享包 | 消除焦虑与客服咨询 | 1.5 |
| 6 | 送达证明 | 无 | 运营标记"已送达"时可传 1–3 张照片（复用媒体管线：已有 EXIF 剥离/重编码/内容寻址），DB 加 fulfillment_proof 关联表；查单页会话内展示。隐私：仅订单会话可见、不进任何公开页、运营端提示裁掉第三方人脸与地址信息 | DB+API+后台+前台 | 对标站全无，最强信任差异点，直接抬复购 | 4 |
| 7 | 快捷支付位 | 无 | 结账支付步预留钱包按钮槽（卡表单上方）；按钮由 payment capability 接口下发（§5.7 禁止前端硬编码），Airwallex/Stripe 托管组件均自带 Apple/Google Pay，另需 Apple 域名验证。现在只做占位+接口字段 | 前台+合同字段 | 移动端转化关键（四对标站全有） | 1 |
| 8 | 虚拟礼物交付语义 | 未定义 | 见下表，建议 A 默认+B 可选，首发不做 C | 合同+履约映射+文案 | 类目合规=能收款 | 2 |
| 9 | 点按数达标 | ≈15 次 | 上述 1/2/3/7 落地后：分类磁贴→礼物（艺人上下文来自偶像页）→加购→去结账→邮箱(自动填充)+1 勾→钱包支付 ≈ **6 次**；卡支付 ≤8。埋点验收（规范 13 事件补齐漏斗段） | — | 目标：钱包 ≤6 | 0.5 |

## 第 8 项：虚拟礼物三选项

| | A 应援记录+榜单积分 | B 承诺直播鸣谢 | C 站外播放特效 |
|--|--|--|--|
| 履约状态机 | 付款即 DELIVERED（自动直达），无运营动作 | PENDING→PREPARING(排期)→DELIVERED(鸣谢后标记+时间戳) | 长期 ON_HOLD 风险，依赖站外配合 |
| PSP 类目风险 | 中：无实物交付物，近似打赏/捐赠类，需在商户申请中定义为"数字应援凭证+电子回执" | 低中：有可证明的服务交付物，抗拒付最强 | 高：即对标站被 PSP 严审的类目，且踩 TikTok 条款 |
| 结论 | **默认** | 可选升级档 | 首发不做 |

## 推进顺序与合计

合计约 **18 人日**。顺序：2→1→5→4（纯减摩擦，约 7 人日，可与 PSP 适配器并行）→3→8→6→7（钱包实装随 PSP 联调走）。全部不阻塞生产接线主线；第 3、6 项含少量 DB/后台工作，建议排在生产组合根打通之后、sandbox 联调期间完成。
