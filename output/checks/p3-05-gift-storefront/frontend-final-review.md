# P3-05 前台最终非作者复审

审查者：`/root/storefront_read`。基准 `4c7adf1`，审查 root/目录执行者本轮未提交前台与七语言文案改动，包含新增文件。本人编写的公开 reader/后端不作为本次独立审查对象。

**结论：ACCEPT，当前审查范围没有剩余阻断项。** 本结论是源码和已有证据复核；按 root 要求未运行 Next、浏览器或重型测试，不代替最终真实浏览器/E2E和全仓检查。

初次复审 source manifest：1428 文件，SHA-256 `5f995f4c7995f45ead97a45fc7d9a1a1236c8411a383734e25b17716003331f7`，现保留为 `implementation-source-before-back-fix.json`。当次只读比对其中 264 个前台源码和 storefront copy 文件与当时文件哈希，未发现差异。

最终补充复审使用当前 `implementation-source-final.json`：1428 文件，SHA-256 `69a48bef96956a27946a12da7468acc71880bcbef594eb50184a2de3aadd9bb5`。两份 manifest 的唯一源码差异为 `gift-filters.tsx`；该文件当前哈希与新 manifest 匹配。下文保留初次复审历史，并追加该补丁范围。

## 本轮发现并关闭的问题

### [P2] 跨礼物入口沿用了上一礼物的 variant — 已修复

原复现路径：礼物 A 选择变体 → “浏览礼物”返回目录 → 点击礼物 B。目录卡片曾原样带出 A 的 `variant`，B 的 `selectGiftOffer` 找不到该变体，误显示不可选。

已逐行复核修复：`gift-query.ts` 新 `giftDetailHref` 先验证目标 slug，仅删除全部 `variant`；`gift-directory-card.tsx` 与首页精选 `home-content.tsx` 均使用它。locale、market、currency、idol、重复 cart 和其他导航上下文继续保留，当前礼物内的变体选择不受影响。`directory-cross-gift-red.log` 保留真实卡片错误 href RED；`directory-cross-gift-green.log` 为作者运行的 12 tests PASS。没有为了通过而把不存在变体默默切成其他变体。

### 已知 a11y 同因修复 — 源码复核通过，真实结果由 E2E确认

- `GiftPurchase` 变体选择使用有名称的 `role="group"`，与正文政策导航区分。
- `PolicyLinks` 接受 `labelledBy`；礼物详情正文引用 `gift-delivery-title`，政策正文引用 H1 `gift-policy-title`，footer 保持服务政策名称。正文与 footer 不再产生同名但不同链接集合的导航 landmark。
- 已查阅作者 `a11y-semantics-green.log` 的 19 tests PASS；本次未自行运行 axe 或浏览器，不能把静态修复视为真实 a11y 验收。

## 核查范围与通过理由

1. **七语言入口与审核门**：只读枚举确认 28 个 canonical 页面，七语言各 gift/gifts/policy/region；每页 Page/Metadata factory locale/kind 成对一致且 `force-dynamic`。五种礼物类型、三种库存策略、分页、价格输入、政策和错误文案来自各语言 copy，完整 ICU 消息保留词序和复数规则。七份 review 仍 DRAFT、reviewer/approvedCommit 为 null，生产 `loadStorefrontCopy` 仍要求源语言与目标语言精确 hash 和 APPROVED 证据，没有伪造批准或放宽发布门。
2. **发布内容与 HTML**：礼物详情消费真实 published classification/content，LEGACY_TEXT 以 React 文本转义；新详情块使用固定 heading/paragraph/list/specifications/media 组件。政策正文只在原受控标签/无属性 schema 二次校验后注入 HTML，未引入任意 HTML/外链脚本入口。政策 key 从实际公开配置获得，页面还核对 key，缺失/失败不生成虚构政策正文。
3. **URL 与商业上下文**：语言控件复用仅替换 canonical locale 的原逻辑。地区/币种由实际 context 提供，未从语言推算。artist/variant/market/currency 单值和格式先验证；切艺人清变体和页码，切地区清旧币种价格过滤和变体，切筛选回第一页；所有跳转经过本地路径构造，不接受外部 return URL。礼物目录/API query 仅转发所属字段，不把导航 cart/session 上下文变成 API 输入；canonical metadata 仅列 public identity 字段。
4. **库存与选择**：礼物类型标签和库存策略分别渲染；TRACKED 只展示后端实际数量，PROCURE_ON_DEMAND/PREORDER 使用明确文案，不显示虚构现货数。价格用真实 minor amount/currency；起价只选实际可用 offer 的最低价。无艺人、艺人暂停、不适用、库存不可用或不存在变体都不给数量输入。合法但不存在变体保留不可选状态；checkout 按本阶段范围禁用并有说明，不创建购物车、库存预留或支付。
5. **错误与恢复**：真实 NOT_FOUND 调用 Next notFound；通用读取失败保留错误页面，不变成空成功、不私自切英语。合法带 provenance 的 fallback 文本标记实际 lang，metadata noindex；政策拒绝 fallback。目录空结果与越界页分开并提供恢复；筛选输入错误保留错误文案与焦点；恢复函数移除坏 selector，保留有效商业上下文。
6. **公开与私密边界**：本轮 UI 不采集私密留言、完整署名、地址、支付凭据，不写 localStorage/sessionStorage，不输出新日志。商品/艺人媒体复用已验证的 PublishedImage；未新增私密对象地址、后台 session 或对象存储凭据进入客户端 props 的路径。

## 验收限制

- 本次为只读非作者静态复审；未重跑作者单测或 root 已报告的前台 221 tests/typecheck，也未抢占 E2E 的浏览器资源。
- 实际七语言 390×844/1440×900、键盘与 Drawer/focus、错误注入、reduced motion 和刚修 a11y 仍以最终冻结源码对应的 E2E 证据为准。
- copy 仍待人工语言/法律审核，生产审核门继续阻止 DRAFT。当前 checkout 禁用属于 P3-05 明确阶段范围；本 ACCEPT 不表示可以生产上线或完成支付链路。

## 补充：普通 History Back 的原生表单恢复

**静态复核 ACCEPT，没有发现补丁引入的新阻断项；真实浏览器 GREEN 尚待最终 E2E，不在本结论中宣称已修复实际浏览器表现。**

实际 RED 来自 E2E 的 `native-back-diagnostic.json`/`.log`：Chrome 普通 Back 的 `pageshow.persisted=false`、navigation type 为 `back_forward`；URL 为 PRICE_ASC/page2，原生 select 却仍是 PRICE_DESC，持续一秒未自动归位。原实现只处理 BFCache 的 persisted=true，覆盖不到该已证实路径。

本次只读复核 `gift-filters.tsx` 的 useEffect，确认：

- pageshow 的 persisted=true 或当前 document navigation.type=back_forward 均调度恢复；挂载时另查 back_forward，覆盖 hydration 晚于 pageshow 的情况。
- 使用一个可取消的 requestAnimationFrame，把 URL 已验证 query 对应的完整 sort/category/availability/minimum/maximum 草稿重新应用到受控控件。正常 navigate 挂载不重置用户草稿；不修改 URL、实际 API query、价格或卡片结果。
- 重复恢复会取消旧 frame；卸载/依赖变化会取消尚未执行的 frame 并移除同一 pageshow listener，旧闭包不能在新 query 上迟到应用。恢复同时关闭 Drawer、清空错误并结束 composition 状态，与回到已应用 URL 的含义一致。
- `draftFor` 创建新 state 对象，促使受控组件提交；只读检查本地 React DOM 的 select/input 更新路径确认它会重新应用受控 value，不依赖 native DOM 当前值恰好与 React 上次 props 一致。

已查阅作者 `directory-native-back-unit.log`（12 unit/SSR tests PASS）及 lint/format 日志。这些是原受影响单元/SSR 回归，未模拟真实浏览器 history 原生恢复时序，因此**不能替代该缺陷的浏览器 GREEN**。本审查未运行 Next、浏览器或重型测试；root/E2E 正以新 `69a48bef…` 源码重新构建并验证完整流程。

## Root evidence-binding addendum

After the non-author review, the final source manifest became `fc27375c3ef3340299e1d2ec71cbe0ea517ed442cfe72e221ebd6f59f4766ae1` (1428 inputs). Root deep-compared its path/hash map with the reviewed `69a48bef…` manifest: only `apps/api/scripts/gift-storefront-browser.mjs` changed; all reviewed product inputs are byte-identical. The fixture now uses the existing P2 interaction verifier's exact inside-focus-guard classification and bounded 500 ms return-to-popup requirement, supported by `filter-focus-diagnostic.json`. Ordinary outside focus is still rejected immediately and timeouts fail. This addendum is root's evidence-binding review, not a new non-author browser PASS claim.
