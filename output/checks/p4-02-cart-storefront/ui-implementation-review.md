# P4-02 前台 UI 交付记录

本记录为 UI 作者说明；购物车业务命令、BFF、PG 与最终浏览器由其他执行者独立验证。

## 已实现

- 礼物主图、当前价格与库存说明继续服务端渲染；已选真实可收礼艺人、当前规格与可售报价后才显示加购表单。数量同时受当前库存上限与 PostgreSQL int 上限约束。
- 七语言购物袋页面与按需加载 Drawer，普通 DTO 仅显示留言/署名有无；礼物名称、艺人名称及两张图片分别使用实际来源语言。无价/失效对象不会伪造价格、名称或链接。
- 同源受保护会话只在内存保存 CSRF 与安全购物车 DTO，Cookie 交浏览器。Header 在公开页面 load 后恢复数量，不阻塞 Hero；CartBody 在显式打开购物袋后加载。
- 加购不自动弹出 Drawer；确认动画采用现有 motion token，reduced motion 关闭动画。数量修改、移除、私密编辑使用实际整车/行版本。
- Editor 仅显式打开后 POST 读取明文；关闭、卸载与 pagehide 清除引用并忽略迟到响应。留言按 Unicode codepoint 280、昵称 40 限制，不截断，保留实际声明语言（含 und）。
- UNKNOWN / IN_PROGRESS / TEMPORARY_UNAVAILABLE / TRANSACTION_OUTCOME_UNKNOWN 保留原请求正文和 Idempotency-Key，仅用户显式重试；不自动创建新 key 重发。
- 结账保持未开放；当前实现没有支付授权、扣款、订单或库存预留副作用。

## 已修复的交叉审查问题

1. Editor 初次 VERSION_CONFLICT 后刷新公开事实，再等待用户显式重试，避免相同旧版本循环。
2. 已加载的明文草稿固定 EDITOR_READ 的版本。外部 props 更新不会让首次保存悄悄采用新版本；冲突后保留草稿，下一次显式确认才使用最新版本。数量草稿同样固定开始编辑时的版本和价格 hint。
3. 删除后的播报保留在 CartContents，焦点仅在原本属于被删除行时转移至下一行（末行则前行）移除按钮，最后一行转至可聚焦的购物车容器；用户已移到其他控件则不抢焦点。
4. 成功写入若被更晚开始、却看到了旧事实的读取超过，会重新读取一次当前事实，避免界面停在旧版本。
5. 现有 CSS 经 root 调整为设计 token、44px 触控下限与显式 focus 样式；未扩展共享 UI 包。

## 验证

全部使用 `mise exec node@24.20.0`。当前冻结清单为 `ui-source-freeze.json`，46 个文件（含 root 最终 cart.css），聚合 SHA-256 `3a923b2adcd487ff31ecbb4db55517550d675cfd2e0b0bc380acf89bf99ed9da`。

- `pnpm --filter @fan-support/storefront test`：64 文件 / 471 tests PASS，`storefront-tests-freeze.log`。
- Storefront typecheck PASS：`ui-types-freeze.log`；定向 ESLint 0 errors / 0 warnings：`ui-lint-clean.log`；Prettier 和 diff check PASS。
- `pnpm --filter @fan-support/i18n test`：5 文件 / 26 tests PASS，`i18n-drafts-green.log`；i18n build PASS，`i18n-build-freeze.log`。
- 有效回归证据：`gift-add-valid-red.log`、`cart-private-lifecycle-red.log`、`cart-editor-conflict-{red,green}.log`、`cart-editor-baseline-{red,green}.log`、`cart-temporary-red.log`、`cart-removal-temporary-green.log`、`cart-read-write-race-{red,green}.log`、`cart-quantity-observed-{red,green}.log`。
- 初期无模块/夹具拼写/useId/Next 测试环境错误均保留原日志；不将这些环境错误称为功能反证。数量版本的实际反证是在修正测试环境后临时还原本人的旧版本绑定、再恢复补丁得到；不是自然浏览器事件。
- 交互闭包/模拟 DOM 回归仅为本地单测；不冒称真实 Chrome、触屏、VoiceOver 或生产证据。真实浏览器由 root/e2e 统一运行，截图必须避开明文编辑器和输入内容。

## S.U.P.E.R

1–2 PASS：会话、协议验证、表单、行、编辑器、Drawer 加载与页面组装分别负责一件事；code-simplifier 收敛限新文件，未新增流程框架。
3–4 PASS：Browser → BFF → Application；前端不导入 PG/私密存储适配器，无新增循环依赖。
5–6 PASS：使用冻结 cart-runtime/cart-edit DTO；响应先严格 schema parse，私密 editor 永不写入公共 snapshot；Server/Client props 为可序列化数据。
7–8 PASS：无生产域名、凭据、艺人或市场硬编码，无新增依赖；固定同源路径是已冻结协议，数量界限复用合同。
9 PASS：UI 内部 transport 可注入 fetch 进行独立测试；页面、Drawer、行与编辑器可分别替换。
10 PARTIAL：作者限定 tests/types/lint 已绿；整仓 check、Next 构建、真实七语双端/故障恢复/键盘回焦仍由 root/e2e 验证，不能据此宣称 P4-02 DONE。

七语新增文案与当前 hash 记录均为 DRAFT，reviewer/approvedCommit 仍 null。没有人工批准、正式译文验收或生产发布声明。

## 后续集成与独立 PG 复核

Root 的 check:dev 首次仅指出 cart-editor-concurrency.test.tsx 格式差异；root 单独运行 Prettier，未改变行为。上述 46 项 SHA 是该格式调整前的作者冻结快照，最终候选以 root 统一 source snapshot 为准。

对 persistence-postgres/src/cart-edit-{repository,data,private-read,write}.ts、persistence-port/src/cart-edit.ts 和 database/migrations/0024_cart-edit-receipts.{up,down}.sql 的非作者只读复核：ACCEPT，未发现需要修改的实质缺陷。

- 多 pepper 候选最多四项、单次 lookup 仅许零或一车；当前所有权、真实 PG expiry、cart/item/intent 版本在锁下验证。
- App quantity 分支复用当前事务内 StorefrontCommerce 读取与 Cart 领域判定，scope/当前价格/资格/数量并未交给浏览器决定。
- Receipt 在变更前绑定旧版本，deferred guard 在 COMMIT 约束新头、隐私材料 hash、真实价格规格/scope 和独立 outbox 事件。事件永久 PENDING 是本次明确未配置消费者的边界，没有宣称派发成功。
- REMOVE 只把 support_intent 标为 CANCELED，保留原行、密文、原 request/correlation 历史；新 receipt 独立记录当前操作。
- 私密读取先提交授权 audit，再在事务外解密，随后重新验证所有权、到期、三版本及原 audit/trace 的精确关联。
- 0024 回退在任一新证据表有行时以 55000 拒绝，原历史 SQL guard 未被替换。序列化失败重试最多两次，未知提交不自动判已回滚。

此为源码及已有作者证据的只读复核，没有再次运行 PG；完整 PostgreSQL/HTTP/真实浏览器由协调者验收。

## 第一轮真实浏览器发现与修复：独立 gift-family 外壳

首个 390px 浏览器检查真实发现礼物表单 radio label 高 22px。原因是 gift-page-factory 的独立外壳没有导入 cart.css，也没有 CartProvider；GiftAdd 会话为空是对应代码推导，首轮尚未执行 ADD，不冒称已观察到后端加购失败。

最小修复在该独立外壳导入 cart.css，并以 key=locale 的同一个 CartProvider 包住 SiteHeader 与 main。Footer、SEO、404 与非关键 context/目录流式等待保持原结构；未改为会引入额外读取的通用外壳。扫描确认其他 home/artist/cart 页面已使用正确的 StorefrontPageShell。

有效 RED：新增 gift/gifts/policy/region 四种页面共享 Provider 边界和 CSS 入口断言，共 5 FAIL / 35 PASS（gift-cart-boundary-red.log）。最终 3 文件 / 86 tests PASS（gift-cart-boundary-final-green.log），完整 storefront types、两文件 lint/format/diff 均 PASS。中途一次 Children.toArray 重新编码 React key 的测试工具错误保留原日志，改为不重写 key 的 Children.forEach；没有放宽边界断言。

两文件冻结 SHA：gift-page-factory.tsx = 31b04cc6cfbf53e6d06131435c2e289699c4591c63777adcd19aba3bc8636f42；gift-page-scheduling.test.tsx = 507a2e15fb48df06a91654b9abe030a35a6aaa8923ab30a550b2c2eea3627743。旧 46 文件快照不是此后最终候选。浏览器实际尺寸/首次 ADD 的重验由 e2e 重新编译后执行。

## 第三轮真实浏览器发现与修复：重复购物袋地标

E2E 重编译后已实际通过首次无 cookie ADD、Secure HttpOnly cookie、双艺人独立行及 44px 触控检查。后续 attempt3 在键盘焦点检查通过后，axe 报告背景购物袋页面和打开的 Drawer 各有同名 section，触发 moderate landmark-unique。

cart-body.tsx 仅按 page 选择容器：页面保留带名称的 section，Drawer 使用普通 div，由外层 dialog 提供名称。稳定 callback 将两个实际节点绑定到原 HTMLElement root；tabIndex、data 属性、持久 live region 和删除焦点函数保持不变。

cart-body.test.tsx 同时渲染页面和有名称的 dialog；有效 RED 发现两个 named sections（cart-landmark-red.log），最终与行/删除焦点回归合计 3 文件 / 5 tests PASS（cart-landmark-green-final.log）。完整 storefront types、两文件 lint/format/diff PASS。动态 intrinsic 的初次 ref 类型错误保留在 cart-landmark-types.log，稳定 callback 后 types-final 通过。SHA：cart-body.tsx = 3612c8b83826450f457c839842e4b94b92e6cd12aae1be82a843040425dad0ca；cart-body.test.tsx = 16d29dad1a35e1ddac0ff7109d2a6ed6f4a11cead74c01b1b70729fb6b3f9be2。

此修复未降低 axe 门或处理 BaseUI 的 aria-hidden-focus incomplete。真实 Drawer axe 重验及 incomplete 人工判断仍由 e2e 执行，本地渲染测试不替代浏览器证据。
