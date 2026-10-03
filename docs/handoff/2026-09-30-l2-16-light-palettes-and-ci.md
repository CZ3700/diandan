# 交接：四款浅色配色完成并上 stg；CI 回归修了四处、定位两处；下一步 stg 改正式构建

> 日期：2026-09-30
> 执行：Claude（Windows 端）
> 分支：`v2/r1-production`，与 origin 同步（本文件提交前最新为 793b7673 之后的进度提交）。stg 已部署到 b8de15bc，迁移头 0056。
> 冷启动顺序：AGENTS.md → SPEC §0.3–0.4 → [上线计划](../plan/2026-09-28-flexible-storefront-launch.md)（文末“2026-09-30 用户追加”）→ [当前进度](../progress/launch-progress.md) → 本文件
> 上一份交接：[2026-09-30-l3-09a-l2-15-done.md](2026-09-30-l3-09a-l2-15-done.md)

## 背景

本轮按上一份交接的顺序推进：先做 L2-16 四款浅色配色，再做 stg 改正式构建。

开工时用户新定了两件事：

- CI 三组回归失败由 Claude 修；
- 需要跑 CI 时可以自己开草稿 PR。

所以开了草稿 PR #16（`v2/r1-production` → `v2/r0-foundation`，只跑 CI，不合并），和 L2-16 并行推进。

L2-16 已完成并在 stg 逐款验收。CI 修了四处，另有两处只定位到范围。stg 正式构建还没开工。远端开发者本轮没有新推送。

## 已完成

| 条目 | 提交 | 验证 |
|:--|:--|:--|
| L2-16 四款浅色配色 | b8de15bc | 单测：合同 13、令牌 27、后台装修 94、商城主题与玻璃 6。实际 PG 主题脚本 319 项。56 个迁移往返与结构目录。门禁全过：测试串行加降并发复跑，build 38 |
| L2-16 部署 stg | — | 停机冷备份后部署，一次就绪，动态路由 200 |
| L2-16 stg 验收 | — | 樱花粉 672 项、晴空蓝 609 项、象牙金与珍珠灰 1212 项，全部通过，axe 零严重违规；珍珠灰另在后台实时预览验收 21 项。验收后已恢复经典黑金 |
| CI Security：fast-uri 新公告 | 57a223e1 | 本机 `pnpm security:dependencies` 通过，下一轮 CI 通过 |
| CI operations：折叠面板 | ec0b5272 | 下一轮越过原失败点（216 行），停在 372 行（见“下一步”） |
| CI commerce：测试网关漏了 locate | 4a0f201f | 网关单测 2 项；stg 上同一流程正常。之后 commerce 在更早的 cart 步骤失败，这一处还没被 CI 走到 |
| CI journey：刷新按钮 | b7f7633d | 第三轮 journey **整组通过**（首次全绿） |
| CI 诊断 | 6ae2f08f、793b7673 | quality 列出溢出元素；catalog 保存回退页截图与正文 |
| 文档 | 23396a08、c0e8fd0d 等 | 进度表 L2-16、stg、CI 行；上线计划记录用户“不做前台配色切换”的决定 |

### L2-16 做法要点

- **合同**：`packages/contracts/src/storefront-theme.ts` 新增 `storefrontPaletteSchema`，顺序为三款深色在前、四款浅色在后：`SAKURA_PINK`、`SKY_BLUE`、`IVORY_GOLD`、`PEARL_GRAY`。
- **迁移 0056**：替换 `valid_storefront_theme`，只在配色清单里加四个名字。down 遇到浅色历史就拒绝（55000），否则恢复与 0047 逐字相同的函数。实际 PG 用例在 `packages/persistence-postgres/scripts/storefront-theme-light-palette-cases.mjs`。
- **令牌**：`packages/design-tokens/src/storefront-theme.ts` 与 `styles/storefront-theme.css`。
  - 浅色配色各自带 `--color-border`、`--shadow-raised`（取自己的墨色），以及共用的 `LIGHT_FEEDBACK`（危险 `#b42318`、成功 `#16703f`、警告 `#8a5300`）；
  - 原“受保护”的规则改成：深色配色不许出现状态色、边框、阴影键；浅色配色必须给全，并锁定色相为红/绿/琥珀；
  - 所有配色的文字、次要文字、强调色和三种状态色，在三层底色上都 ≥4.5:1（对比度改为取较亮者比较暗者，兼容浅色）。
- **深浅标记**：`STOREFRONT_PALETTE_SCHEMES` 与属性 `data-storefront-scheme`（DARK/LIGHT），浅色时 `html[data-storefront-scheme="LIGHT"] { color-scheme: light; }`。后台预览按默认主题的属性键管理属性，新键自动纳入。
- **玻璃托框**：`artist-directory.module.css` 在浅色下 `--artist-glass-light` 取 surface-raised，`--artist-glass-shade` 取文字色 24%，托框边线取文字色 12%。锁定测试是 `artist-glass-theme.test.ts`。
- **后台**：`theme-editor.tsx` 按深/浅两个嵌套 fieldset 列出配色，每项有色块。色块的颜色从令牌包经 CSS 变量传入，CSS 里不写颜色值。七语文案在 `theme-copy.ts` 的 `palettes`、`paletteGroups`。
- **stg 验收脚本**（`output/`，不入库）：
  - `output/checks/l2-16/stg-light-palettes.mjs`：支持 `--palettes A,B`、`--read-only`（只看线上当前配色）、`--restore PALETTE`；
  - `stg-preview-palette.mjs`：只在后台预览里选中配色、不保存。

### CI 修复要点

- **Security**：锁文件里 fast-uri 从 3.1.6/4.1.3 升到 3.1.8/4.2.1。两条公告 2026-09-28 发布，只改锁文件。
- **operations**：L2-12 把订单页付款/退款面板改成默认折叠，但 `admin-finance-browser.mjs` 的七语矩阵和 `local-experience-browser.mjs` 的 `selectOrder` 没有先点开，已补上。
- **commerce**：`apps/api/scripts/order-storefront-gateway.mjs` 的 `isOrder` 只认 exchange/revoke/read/bootstrap。`/order-access/locate` 于是被送到没有订单会话配置的 API，查单页显示“暂时不可用”。已把 locate 加进路径清单。
- **journey**：支付失败或取消回跳后，结账页会自己重新列出支付方式，“刷新支付方式”按钮不再出现，测试却一直在等着点它。改为只在按钮出现时才点。

## 关键决策及理由

- **用户决定不做前台顾客配色切换**：用户提议把主题选择移到商城前台，放在语言选择左边给顾客自选。Claude 建议只开放“深/浅色”切换，版式与动效仍由后台统一决定。用户最终选“维持现状”，已记入上线计划，**勿再提**。
- **验收期间用户在后台发布了象牙金**：用户确认是本人操作，并要求验收后恢复黑金。
  - 首轮晴空蓝后半段的页面显示的是象牙金，所以晴空蓝单独重跑了一遍；
  - 教训：stg 验收前后都要核对线上状态；验收脚本要能识别配色被别人改动（目前按配色属性逐页核对）。
- **浅色状态色四款共用一套**：三种状态色在四款浅色底上都有 ≥5.2 的余量，色相一致更利于识别，所以不按配色单独调。边框和阴影则跟随各自的墨色。
- **深/浅用新属性表达，不从配色名推断**：CSS 模块（玻璃托框）和 `color-scheme` 只需要知道深浅。以后再加配色，只要在 `STOREFRONT_PALETTE_SCHEMES` 登记即可。
- **不做运行时切换，也不新增主题字段**：配色仍只是 `palette` 的一个枚举值。迁移只放宽校验函数，旧 JSON 和回执哈希完全不变。
- **CI 的 journey 与 commerce 问题都是测试侧，不改产品**：两处都在 stg 上用同样步骤复现过，产品行为正确。复现脚本是 `output/checks/ci-2026-09-30/stg-locate-repro.mjs` 和 `stg-retry-repro.mjs`。
- **quality 与 catalog 只能看 CI 附件**：两者只在 Linux runner 上出现，本机缺 S3 或字体环境。所以先在脚本里加诊断，不盲改。

## 在途

没有改到一半的代码，工作树只剩本交接和进度表待提交。

草稿 PR #16 仍开着。793b7673 触发的 CI 正在跑，这一轮会列出 quality 的亚像素溢出元素。

## 下一步

1. **stg 改用正式构建**：严格按[方案](../plan/2026-09-30-stg-production-build.md)第 4 节做。
   - 先写失败测试；切换前停机冷备份；切换后连续重启 5 次，验证动态路由。
   - 第 5 项“结构化事件日志”做完后，顺带让回归套件（至少 journey、commerce）失败时把事件日志放进 CI 附件。journey 的 `PUBLICATION_FAILED` 上两轮出现、第三轮没出现，要靠它看到真实的 PostgreSQL 错误。
   - 切换后复查两件事：
     - 未发布信息页的 404 是否带主题属性。开发模式下 `/zh-CN/support` 的 `<html>` 只有 `lang`，不带任何主题属性；不存在的艺人页是开发模式错误外壳；
     - 艺人详情页是否还会偶发读到旧主题。首轮验收中出现过一次 BLACK_GOLD。
2. **CI 剩余四组**（先读 793b7673 那一轮的附件）：
   - **commerce-cart**：`cart-storefront-protocol.mjs` 在“同一幂等键并发重复编辑”之后的断言连续两轮失败，现场伴随两次 40001 重试。
     - 先在本机跑 `pnpm --filter @fan-support/api test:browser:cart-storefront` 看能否复现。需要 S3，本机大概率跑不了；
     - 否则在 `verifyCartStorefrontProtocol` 的各项 `check` 前补上实际值，再读下一轮附件。
   - **catalog**：ja 首页回退时整页是“暂时无法显示”（截图在 `output/checks/ci-2026-09-30/run3/catalog/`）。
     - 嫌疑：`packages/persistence-postgres/src/storefront-homepage-repository.ts:41` 的 `loadPublishedContentContext`，在译文缺失时不回退英文，而单独的 `/homepage` 接口会回退；
     - 页面标题检查可能因首页 seoTitle 与站点名相同而误通过；
     - 先确认 `/api/v1/storefront-homepage?locale=ja` 在故障下返回什么（`regression-seo-faults.mjs` 会拦截首页译文 SELECT）。L1 首页相关，必要时与远端开发者核对。
   - **operations**：停在 `admin-finance-browser.mjs:372`。“对账补完剩余退款”提交后，`[data-finance-mode]` 没有再出现。可能退款已全额分配、表单不再显示，也可能面板在刷新后重新折叠。
   - **quality**：pt/200% 下 848 比 847 的亚像素溢出，读 793b7673 那一轮的 `overflowing=` 清单定位元素。
3. 远端开发者相关的旧问题不变：三个既有失败的 test:postgres 脚本，以及 Stripe 包在 Windows 上的 0o600 断言。见进度表 CI 行。

## 环境注意

- **CI 并发会取消**：`ci.yml` 设了 `cancel-in-progress`，推送会取消正在跑的那一轮。连续提交最好攒一批再推。只改文档的提交也会触发重跑。
- **读 CI 日志**：
  - run 没结束时 `gh run view --log` 拿不到日志，用 `gh api repos/CZ3700/diandan/actions/jobs/<jobId>/logs`；
  - 附件用 `gh run download <runId> -n regression-<suite>`，较大的附件要放后台下载；
  - 本轮附件都在 `output/checks/ci-2026-09-30/`（run2、run3 子目录）。
- **stg 验收会与用户并发**：用户会在 stg 后台自己试新功能。改线上主题的验收先记下基线，结束时恢复；发现线上被别人改动时不要硬覆盖，先确认。
- **多个浏览器脚本同时压 stg**：同时跑两个时出现过一次结账 503。2 核开发模式扛不住并发，验收脚本尽量串行。
- **Bash 工具与转义**：heredoc 里的 `\\` 会被吃掉一层，写 JS 正则的改写脚本改用 Write 工具落文件再执行。
- **测试超时**：固定做法不变。
  1. 先跑 `turbo run test --continue --concurrency=1`；
  2. 失败的包逐包 `--maxWorkers=4` 复跑（persistence 用 6）；
  3. 最后单独跑 build。

  本轮超时的有：application storefront-commerce；admin instrumentation；storefront specimen 与 rum；persistence 的五条 SQL 形状测试。复跑全过。
- **`pnpm check:design-foundations` 在 Windows 上有字体产物测试失败**：字节完整性与 CJK 回退，与本轮无关，也不在 `check:dev` 里。设计令牌检查本体用 `node scripts/check-design-foundations.mjs`，通过。
