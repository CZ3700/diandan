# 交接：L3-09 应援凭证完成，另完成用户追加的三项小改动

> 日期：2026-09-30
> 执行：Claude（Windows 端）
> 分支：`v2/r1-production`，与 origin 同步（最新 e202a7e9）；stg 已部署到 e6b6001c，迁移头仍为 0055
> 冷启动顺序：AGENTS.md → SPEC §0.3–0.4 → [上线计划](../plan/2026-09-28-flexible-storefront-launch.md) → [当前进度](../progress/launch-progress.md) → 本文件
> 上一份交接：[2026-09-29-l3-10-built-in-accounts-done.md](2026-09-29-l3-10-built-in-accounts-done.md)

## 背景

本轮按上一份交接推进 L3-09：虚拟礼物的可保存数字应援凭证，见 ADR-019 增补。

开工时用户追加了三项小改动，状态如下：

- L2-13：首页海报与搜索框的位置；
- L3-10a：员工账号的角色列表；
- L2-14：礼物卡片留边，在 L3-09 进行中追加。

四项都已完成、推送，部署到 stg 并在真实域名上验收。进度表里的状态都是 LOCAL_ACCEPTED。stg 是 TEST 环境，这些验收不作为上线证据。

## 已完成

| 条目 | 提交 | 验证 |
|:--|:--|:--|
| 登记 | f5de71ff | 开工前在进度表登记 L2-13、L3-10a，并把 L3-09 改为 IN_PROGRESS |
| L2-13 海报金色按钮与搜索位置 | 159aa7f7 | storefront 单测 619 项；stg 真实域名 201 项：七语双端、键盘、减少动态、控制台零报错 |
| L3-10a 员工账号只留两个标准角色 | cbb8fb62 | 实际 PG 专项 154 项、服务器命令 44 项；stg 员工页 13 项，验收账号用后已暂停 |
| L2-14 礼物卡片留边画框 | 9fe96d71 | 设计令牌检查；stg 171 项：七语双端的礼物页和首页、悬停与键盘聚焦转金、减少动态 |
| L3-09 应援凭证 | 09b8c6b7 + e6b6001c | 单测：合同 17、投影 11、查单页 19、凭证模块 7、i18n 37；查单 SQL 19 条在实际 PG 上 PREPARE 通过；stg 端到端 80 项有效检查全过（见下） |
| 文档 | 06483847、583d1955、e202a7e9 | ADR-019 增补（署名决定）、上线计划、进度表 |

### 各项做法

**L2-13**：

- 海报恢复金色主按钮，文案为商城固定的七语言文案 `heroAllArtists`（Meet all the artists），链接到 `/idols`；
- 艺人搜索框原样移到艺人区标题"Find the one who inspires you."下面，选中结果直达艺人页（`home-artist-search.tsx`）；
- 首页艺人目录不再带自己的搜索框，删掉了 `homeArtistSearchInHero`。

**L3-10a**：

- 合同常量 `ADMIN_STAFF_ROLE_KEYS`（`studio:owner` 和 `studio:operator`）；
- 员工仓储的 LIST 只返回这两个角色，CREATE 和 UPDATE_ROLES 收到其他角色一律回 `UNKNOWN_ROLE`；
- 本地体验给测试身份建的 `local:*` TEST 角色仍留在库里，身份选择页还在用。

**L2-14**：

- 改动在 `gift-directory.css` 和 `presentation.css`；
- 卡纸留边通过 `--gift-mat` 设置：网格 32px、大图展示 48px、手机 12px 或 24px；
- 内框圆角是主题图片圆角的一半；悬停和键盘聚焦时细边转金色；照片以 `cover` 铺满内框。

**L3-09**：

- **合同**：`orderAccessItemSchema.supportCertificate` 为 `{deliveredAt, revoked}` 或 null，只在"虚拟礼物 + 已送达"的行上出现；OpenAPI 和 JSON Schema 已重新生成。
- **读取**：`order-access-read.ts` 读出 `f.delivered_at`，并计算 `refunded_in_full`，条件是 SUCCEEDED 退款在 `refund_items` 中的分配金额 ≥ 该行 `line_total_minor`，且该行金额大于 0。admin 订单详情复用同一个投影。
- **页面**：`order-support-certificate.tsx` 放在查单行里。付款成功页和查单页用的是同一个 `OrderDetail`，所以两处都有。
- **图片**：`support-certificate-image.ts` 在浏览器里画 1080×1350 的 PNG：
  - 颜色取当前主题令牌，字体等加载完再画；
  - 照片通过 `getImageProps` 取本站同源的 `/_next/image` 地址，并设 `crossOrigin`；
  - 照片画不上时用艺人名首字代替；
  - 同时触发下载，并在页面上显示图片供长按保存。
- **文案**：七语言，20 个 `orderCertificate*` 键，审校哈希已刷新。

### stg 端到端验收

脚本在 `output/checks/l3-09/stg-certificate.mjs`，只走 TEST 通道。依次验证：

1. 访客购买虚拟礼物并完成 TEST 支付；
2. 付款成功页出现凭证，上面没有留言、邮箱和金额；
3. 署名选"填写名字"但留空时被拒，焦点回到输入框；
4. 三种署名各保存一张 PNG，核对尺寸、文件名和画面内容；
5. 用方向键切换署名，按 Enter 保存；
6. 七语言在 390 和 1440 两种宽度下检查，其中 4 种语言跑了 axe；
7. 减少动态效果；
8. 后台整行退款到 SUCCEEDED 后，凭证变为"已撤回"且不能再保存。

stg 上为验收留下两笔已退款的 TEST 订单：FS-HPGX37 和 FS-853B5P。

## 关键决策及理由

- **署名由粉丝在保存时现填**（用户选择，已写入 ADR-019 增补）：
  - 规范 §11.1/§11.3 规定，完整显示名只能经受保护入口"先审计再解密"读取，不得进入普通查单响应；
  - 我给了三个选项：现填、不放、新增受保护读取入口；用户选"现填"，并补充"也可以不填或匿名"；
  - 最终为三选一：不署名（默认）、匿名粉丝、填写 1–40 个字符；名字只用于本机生成图片，不上传、不保存。
- **照片走同源图片优化地址，不做服务器端生成**：
  - 查单页 CSP 没有 `img-src` 和 `default-src`，`connect-src` 只允许 `'self'`；
  - `/_next/image` 已经允许媒体源的 `/processed/v1/*`，画进 canvas 不会污染画布，因此不改 CSP，也不新增接口；
  - 设 `crossOrigin` 的目的是：万一拿到的是外域地址，加载会直接失败，而不是污染画布；失败后退回首字。
- **撤回只看整行成功退款**：
  - 退款不会改变履约状态，0042 迁移保持 DELIVERED；
  - `refund_items` 由触发器保证分配额与退款金额一致，按行判断可靠；
  - 部分退款不撤回，拒付败诉（dispute LOST）也不撤回，因为 ADR 只写了整行退款，是否撤回待用户决定。
- **凭证字段为必填可空，并加双向约束**：凭证存在，当且仅当该行是已送达的虚拟礼物。这样消费方不用猜，旧夹具统一补 `supportCertificate: null`。
- **L2-13 按钮用固定文案，不用内容字段 `ctaLabel`**：stg 上的"Meet the artist"来自旧内容编辑器的"按钮文字"字段，日常管理中心改不了，用户又明确不要这段文字。代价是这个字段不再显示在海报上。
- **L3-10a 在服务端限定角色**：只在前端过滤的话，API 仍能分配 TEST 角色。
- **L2-14 旧图出现双层边，不在代码里特殊处理**："Demo bouquet 09271136/09271126"的深色边是 T-2（统一铺满）之前处理时烤进图片文件的。用户当初喜欢的"留边"其实就来自这里；在后台对这两张图重新处理原图或重新上传即可去掉。
- **只有拉丁文字的标签加字距和大写**：泰文加字距后上下标会被拉散。凭证图片和页面的做法与站内其他标签一致，只对 `:lang(en/es/pt/vi)` 生效。

## 在途

没有改到一半的代码。工作树干净，与 origin 同步。

遗留缺口和待定事项（都已记入进度表）：

- **正式构建未做浏览器实测**：`NODE_ENV=production` 下的浏览器验收还没做，L3-09 和 L3-10 都缺这一项；stg 运行的是开发模式的 Next。
- **两个实际 PG 集成脚本本机跑不了**：admin 订单和财务的集成脚本（`admin-orders-integration`、`admin-finance-integration`）依赖 Docker 版 S3（versity），本机和 stg 都无法运行，交给 CI。本轮用 stg 真实域名的端到端流程，加上本机 `postgres-order-access-parameters.mjs` 的 SQL PREPARE 来替代。
- **拒付败诉是否撤回凭证**：待用户决定。
- **邮件里的凭证入口**：按 ADR 随 L3-08（远端开发者）的通知文案一起处理。
- **大图展示预设**：stg 没有发布这个预设，L2-14 在大图展示下只有样式规则，没做浏览器实测。
- **既有问题**：CI 三组回归和三个既有的实际 PG 失败仍未处理，见进度表"CI 回归（PR #15）"一行，PR #15 仍开着。

## 下一步

按优先级排列：

1. **问用户两件小事**，都是一句话能定的：
   - 拒付败诉是否也撤回凭证；
   - 是否要我在 stg 后台把两张旧 bouquet 图重新处理，去掉双层边。这是改 stg 内容，不改代码。
2. **stg 改用正式构建**：
   - 同时补上 L3-10 和 L3-09 的正式构建浏览器验收，并根治开发模式的两个问题：重启后动态路由偶发全部 404、HMR 块加载失败；
   - 这是 stg 运维，由 Claude 负责，但改动面大（运行形态、Caddy、systemd 单元、本地体验脚本）；
   - 先写方案，包括回滚办法，交用户确认后再动。
3. **CI 回归和既有 PG 失败**：与用户确认和远端开发者的分工后再处理。
4. **同步远端**：开工前先 `git fetch`，看远端开发者在 L3-08 上有没有新推送。L3-08 会改订单详情和通知，和本轮的查单页凭证相邻，同步后先跑 `apps/storefront` 的 order 相关测试。

## 环境注意

- **本轮验收脚本**（均被 gitignore）：
  - `output/checks/l2-13/stg-home.mjs`；
  - `output/checks/l3-10a/stg-staff-roles.mjs`；
  - `output/checks/l2-14/stg-mat.mjs`，以及 `look.mjs`、`preview.mjs`（注入样式预览，不用部署）；
  - `output/checks/l3-09/stg-certificate.mjs`。
- **后台验收账号**：
  - 以上脚本给 `qa.check` 设的是脚本自己生成的随机密码，经 SSH 标准输入交给服务器命令，从不打印，结束后立即暂停账号；
  - 这种写法不读任何凭据文件；
  - 自动模式拒绝列出 `output/checks/l2-11`、`output/checks/l2-12` 目录（里面有处理凭据的旧脚本），不要绕过。
- **测试超时**：
  - `turbo run test` 在负载下固定有一批 5 秒冷启动超时：admin 3 条，storefront 的 rum-intake，application 的 storefront-commerce，persistence 5 条；
  - 做法：先用 `turbo run test --continue --concurrency=1` 跑全量；再对失败的包用 `pnpm exec vitest run --config ../../vitest.config.ts --root . --maxWorkers=4` 逐包复跑，persistence 用 `--maxWorkers=6`；
  - 一定要带根目录的配置，否则和门禁不等价；api 包还要补跑 `node --test ./scripts/production-admin-oidc-*.test.mjs`。
- **改商城文案后要刷新审校哈希**：
  - `packages/i18n/src/storefront/*.review.ts` 里的 `sourceHash` 是 en 目录的 `sha256(JSON.stringify(loadStorefrontCopy("en")))`，`translationHash` 是各语言目录的同一算法；
  - 本轮是在 `src/storefront/` 下放一个临时 vitest 文件重算后写回，写完删除；
  - 然后 `pnpm --filter @fan-support/i18n run build`，否则 storefront 读到的是旧的 dist。
- **合同有改动时**：
  - 执行 `pnpm --filter @fan-support/contracts build && node ./scripts/generate-contract-artifacts.mjs`；
  - 持久层和商城的测试读的是合同的 dist，要先构建。
- **快速的实际 PG 检查**：`packages/persistence-postgres/scripts/postgres-order-access-parameters.mjs` 会把查单源码里的全部 SQL 在实际 PG 上 PREPARE 一遍，约 1 分钟，改查单 SQL 后先跑它。
- **stg 部署**：
  - 构建成功才重启：在本机判断日志里有 `build exit 0` 再执行 restart。服务器上 `turbo | tail` 不带 pipefail，远端 `set -e` 拦不住构建失败；
  - 重启后若动态路由全部 404，再重启一次即恢复（本轮第二次部署就遇到了）。
- **正常的控制台噪音**：付款后页眉读购物车返回 409 `CART_EXPIRED`，结账回跳页的 403/409 是付款状态轮询。Chrome 会把它们记为 "Failed to load resource"，但不是站点报错。
- **泰语日期**：`Intl` 对 th 默认使用佛历，2026 年显示为 2569，与查单页其他日期一致，属正常。
- **权限检查服务**：自动模式的检查服务偶发"无结论"，直接拒掉 Bash 调用，稍后重试即可；等待期间可以先用编辑工具干活。
