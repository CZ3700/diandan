# MxCheer 只读体验与技术调研

调研日期：2026-09-02  
目标站点：https://mxcheer.com/  
浏览器视口：桌面 1280×720；移动 390×844  
边界：未创建账户、未输入个人资料、未提交登录/评论/结算/支付表单、未点击下单。购物车中的 $88 商品是浏览会话恢复出的既有状态，本次没有执行“加入购物车”。

## 一句话结论

这是一个把 WooCommerce 商品包装成“给主播/团队的虚拟支持礼物”的站点：用户浏览礼物、选择团队、进入购物车并付款，订单理论上用于支持排行与展示。视觉和标准电商骨架已经存在，但“主播发现 → 支持对象归属 → 支付 → 排行反馈”这一核心闭环目前不可靠：主播入口 404、团队分类为空、简单商品可绕过团队选择、结算仍强制收集完整地址，且政策、页脚和内容存在多处互相矛盾或占位内容。

## 业务目标与逻辑

- 主业务：粉丝购买虚拟礼物/支持项目，收入用于支持创作者和平台运营。
- 商品模型：公开 Store API 返回 91 个可购买商品，均为 USD，价格约 $30–$3,000；76 个 variable、15 个 simple；全部挂有 `Select Member's Group` 属性。
- 归属模型：variable 商品先从 GoTG.、MX-山萬里、new team、other team、starry 中选择一个团队，按钮才解锁；但没有看到“具体主播”选择。simple 商品仅展示团队属性信息，按钮可直接购买，归属规则不一致。
- 激励模型：首页展示 Champion / Runner-up / Rising Star；隐藏的 Rewards & Appreciation 页说明 Support Points、Bronze/Silver/Gold Appreciation 仅是无现金价值的社区认可。脚本中存在 GamiPress。
- 转化模型：主页/搜索/商店/主播 → 商品 → 团队选择（部分商品）→ 购物车 → 结算 → 支付 → 排名/展示。
- 联系模型：全站主要只有 `support@mxcheer.com` 邮件入口，无可见 Contact/询盘表单；虽然 Contact Form 7 资源在所有页面加载。

## 信息架构

主导航：Home、Streamers、Shop、Checkout、About（Refund & Returns、Privacy Policy、FAQ）、Login、Cart；另有 13 种语言（英语 + 12 个翻译入口）。

公开但未进入主导航的页面包括：Rewards & Appreciation、Balance Recharge（空白）、Catalog（空白）、Track Order，以及 Video / Scroll To / Lightbox / Icon Box 等疑似主题演示残留。`/wp-sitemap.xml` 当前返回 404，robots.txt 也未声明 sitemap。

## 核心流程健康度

| 步骤 | 实测结果 | 健康度 |
|---|---|---|
| 1. 首页进入 | 排名英雄图、三位人物卡、商品瀑布流、支付与政策页脚完整出现；首页无 H1，内容层级重复且商品密度极高。 | 中 |
| 2. 搜索 | 输入 `rice` 会出现 3 个相关商品；同一结果层混入 Flatsome 默认博客文章，污染搜索意图。 | 中偏低 |
| 3. 主播发现 | Streamers 有 3 张卡，但媒体区域高度为 0、无可见人物图；社交链接多为 `#`/`tel:#`，Gotg 主 CTA 打开 404，另一 CTA 含 `_wp_link_placeholder`。 | 失败 |
| 4. 商店浏览 | 91 个结果、分页、排序、价格滑杆和分类均存在；按价格从低到高实测有效。 | 中上 |
| 5. 分类筛选 | Female Group 以及子分类 Gotg 均显示“No products”；分类体系与实际商品属性未对齐。 | 失败 |
| 6. 商品详情 | 图片、价格、虚拟支持提示、数量、分享、相关商品完整。variable 商品选择团队后可解锁按钮。 | 中 |
| 7. 支持对象选择 | 只选团队、不选具体主播；部分 simple 商品完全不要求选择。订单归属与排名计算缺少稳定、可见的唯一对象。 | 失败 |
| 8. 购物车 | 商品、数量、总计、继续购物、结算和 PayPal/GPay 快捷支付清晰。购物车没有再次显示支持团队/主播，容易在付款前失去确认。 | 中 |
| 9. 结算 | 支持 Stripe 卡、PayPal、PayPal Card、Google Pay、Apple Pay；有“虚拟商品、无物流、最终销售”确认。却强制要求国家、街道、城市、州、邮编、电话。 | 低 |
| 10. 账号 | 登录弹窗和独立页均有账号/邮箱、密码、记住我、找回密码；没有注册入口，与 FAQ 的“创建账户”说明不一致。 | 中偏低 |
| 11. 联系/售后 | 邮件入口明确，FAQ 较完整；无结构化询盘/工单入口。 | 中偏低 |
| 12. 政策信任 | About 为 Lorem ipsum；隐私/退款仍有 `[Your Website Name]`；Terms 和底部 Refund Policy 404；页脚 Privacy 与 Refund 标签链接互换。 | 失败 |
| 13. 移动端 | 390px 下无横向溢出，菜单、商品与表单能单列重排；语言浮层遮挡 logo/汉堡，搜索重复，商品 CTA 在大图之后，结算页高约 7,777px 且约 195 个可聚焦元素。 | 中偏低 |

## 关键交互与状态

- 搜索：桌面为导航下拉式即时搜索；移动端在页头常驻一条搜索框，菜单抽屉里又出现一条。
- 商品排序：原生下拉，切换后 URL 为 `?orderby=price`，列表正确从 $30 起排。
- 商品变体：团队以约 30px 图片/文字小方块呈现；选中后出现 tooltip、`清除`（中文）并启用 ADD TO CART，英语页面出现混合语言。
- 登录：桌面为居中 lightbox；背景遮罩、Esc/关闭按钮存在。独立账户页只有登录。
- 移动菜单：左侧抽屉，含搜索、主导航、Login、Newsletter；About 有子菜单箭头。
- 购物车/结算：购物车右侧出现多种快捷支付；结算页将账单表单与订单/支付并排，移动端改为超长串行流程。
- 语言：12 个替代语言路由已生成，但桌面下拉宽度不足、中文语言名被截断；浮动入口长期压在品牌/页头上。

## 转化漏斗诊断

1. 获取注意力：人物海报和食物/礼物图片较强，但没有一句清晰解释“买的不是实物，而是支持主播”。
2. 选择支持对象：最关键的 Streamers 链路失效，迫使用户从商品反向选择团队；团队名/图标也不够可识别。
3. 选择礼物：商品丰富且价格梯度完整，但食品、服装、美容、服务、品牌商品被同样包装，真实性和交付含义模糊。
4. 确认归属：变量商品只显示团队；简单商品可不选；购物车和结算不复述支持对象，容易错付。
5. 付款：支付覆盖广，但虚拟商品强制填写物理地址、电话，增加退出率并与隐私承诺冲突。
6. 反馈闭环：页面声称订单影响排名，首页有排行，但没有订单后的积分、主播确认、排名变化、支持历史等可验证反馈。

## 内容与信任

优势：虚拟支持声明、FAQ、退款例外、客服邮箱、支付图标、订单追踪页、面包屑和支付总计均有助于降低疑虑。

高风险问题：

- 隐私政策明确称虚拟礼物“不收集或使用配送地址”，而结算实际把地址、城市、州、邮编设为必填。
- 结算确认写“All sales are final”，退款政策又允许欺诈、技术错误、主播被永久封禁等例外，表达需统一。
- Checkout 页面公开 24 条用户留言与支持对象，并开放回复/评论表单；这会把交易场景与公开评论混在一起。
- About、隐私、退款包含明显占位文案；Terms/Refund Policy 404；页脚政策标签互换，直接损伤付款信任。
- Streamers 的假社交链接、空媒体区和 404 CTA 让核心品牌对象看起来未完成。
- 所有 91 个商品的评论数为 0，页脚“Top Rated”缺乏可验证评分依据。

## 可访问性与响应式风险

已确认的正面点：有 Skip to content；菜单、搜索、登录、数量、团队单选、支付单选、确认框等大多能被无障碍树识别；表单主要字段有可读标签；390px 下未发现横向滚动。

明显风险：

- 首页缺少 H1，结构从 H2/H3 开始。
- 主播卡媒体高度为 0，视觉信息和链接含义同时丢失。
- 团队图标目标约 30px，低于常用 44px 触控建议；部分只有小图，辨识度弱。
- 语言切换器遮挡 logo/菜单并截断标签；英语页面混入中文数量和“清除”文案。
- 浅灰文本、细线和禁用/可用按钮之间的视觉差异较弱，需做实际对比度测量。
- Checkout 含很长的评论区和约 195 个可聚焦控件，键盘/读屏用户到达 Place Order 或页尾成本极高。
- 仅凭截图与 AX 树不能证明完整 WCAG 合规；未做屏幕阅读器朗读、200%/400% 缩放、全键盘焦点可视性和颜色对比自动化测试。

## 技术线索

- CMS/电商：WordPress 7.0.2、WooCommerce 10.7.0。
- 主题：Flatsome 3.20.3。
- 插件/前端：Woo Variation Swatches、TranslatePress、GamiPress、Contact Form 7、AddToAny、Breeze、Site Kit、jQuery 3.7.1。
- 支付：Stripe 卡 + PayPal Commerce（PayPal、卡、Google Pay、Apple Pay）；购物车另有 Pay Later/快捷支付组件。
- 主机/缓存：PHP 8.3.31、Hostinger hPanel、hcdn；HTTP/2，声明 HTTP/3；首页边缘缓存 `s-maxage=2592000`。
- API：WordPress REST 与 WooCommerce Store API 对外可读；商品与页面数据可由 API 驱动。
- 观测到的 CSP 只有 `upgrade-insecure-requests`；该 HEAD 响应未看到 HSTS、X-Frame-Options、Referrer-Policy、Permissions-Policy，需在正式安全评审中复核，不能仅据此下合规结论。
- SEO：未看到描述/OG 摘要元数据；`/wp-sitemap.xml` 返回 404；公开 REST 列出多张空白/演示页。

## 访问过的 URL

- https://mxcheer.com/
- https://mxcheer.com/streamers/
- https://mxcheer.com/shop/
- https://mxcheer.com/shop/?orderby=price
- https://mxcheer.com/product/braised-pork-knuckle-rice/
- https://mxcheer.com/product/1-person-hot-pot/
- https://mxcheer.com/product/gotg/ （404）
- https://mxcheer.com/product-category/female-group/
- https://mxcheer.com/product-category/female-group/gotg/
- https://mxcheer.com/cart/
- https://mxcheer.com/checkout-2/
- https://mxcheer.com/my-account-2/
- https://mxcheer.com/my-account-2/track-order/
- https://mxcheer.com/about/
- https://mxcheer.com/about/faq/
- https://mxcheer.com/about/refund_returns/
- https://mxcheer.com/about/rewards-appreciation/
- https://mxcheer.com/privacy-policy/
- https://mxcheer.com/terms-and-conditions/ （404）
- https://mxcheer.com/refund-policy/ （404）
- https://mxcheer.com/balance-recharge/ （空白）
- https://mxcheer.com/catalog/ （空白）
- https://mxcheer.com/robots.txt
- https://mxcheer.com/wp-sitemap.xml （404）
- https://mxcheer.com/wp-json/wp/v2/pages
- https://mxcheer.com/wp-json/wc/store/v1/products

## 截图清单

1. `01-home-desktop.png`：桌面首页首屏。
2. `02-home-full-page.png`：桌面首页全页。
3. `03-search-open.png`：即时搜索 `rice`。
4. `04-product-detail.png`：简单商品详情与虚拟支持提示。
5. `05-streamers.png`：主播卡缺失媒体。
6. `06-streamer-cta-404.png`：Gotg CTA 404。
7. `07-shop-list.png`：商店、分类、价格与排序。
8. `08-shop-sorted-price.png`：按价格从低到高。
9. `09-category-empty.png`：Female Group 空结果。
10. `10-login-modal.png`：登录 lightbox。
11. `11-cart.png`：购物车与快捷支付。
12. `12-checkout.png`：桌面结算与支付方式。
13. `13-checkout-disclosure.png`：虚拟商品确认与重要提示。
14. `14-checkout-public-comments.png`：Checkout 公开留言。
15. `15-about-placeholder.png`：About 占位文案。
16. `16-faq.png`：FAQ 账号/虚拟礼物规则。
17. `17-refund-policy-placeholder.png`：退款政策占位文案。
18. `18-privacy-policy-placeholder.png`：隐私政策占位文案。
19. `19-privacy-no-address-claim.png`：隐私政策称虚拟礼物不使用地址。
20. `20-terms-404.png`：服务条款 404。
21. `21-footer-links.png`：页脚政策链接与支付标识。
22. `22-mobile-home.png`：390px 移动首页。
23. `23-mobile-menu.png`：移动导航抽屉。
24. `24-mobile-product.png`：移动商品详情。
25. `25-mobile-checkout.png`：移动结算表单。
26. `26-account-login-no-register.png`：账号页无注册入口。
27. `27-language-switcher.png`：语言菜单遮挡/截断。
28. `28-product-group-selector.png`：未选团队时按钮禁用。
29. `29-product-group-selected.png`：选择 GoTG. 后按钮启用。

所有截图均保存于仓库相对路径 `research/mxcheer/`，并已检查为实际 PNG 文件。

## 证据限制

- 没有提交任何表单、登录、加购、评论、下单或付款；因此无法验证支付成功、订单创建、邮件、退款、积分/排行更新和后台运营流程。
- 购物车商品来自浏览会话恢复，未由本次加购产生；购物车与结算页面结构已验证，但“选择团队 → 加购 → 订单行保留团队属性”未做写入式验证。
- 未登录，因此无法检查账户后台、订单历史、个人资料、余额、积分或创作者后台。
- 页面与商品随站点运营可能变化；以上结论对应 2026-09-02 的实测状态。
