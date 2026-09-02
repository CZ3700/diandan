# 全球偶像礼物应援平台：产品、设计与工程约束

> 文档状态：开发基线（Authoritative）  
> 版本：2.1.0  
> 日期：2026-09-02  
> 面向：Codex、Claude Code、产品设计、前端、后端、测试与运营  
> 目标：让执行代理无需重新解释需求，即可按阶段实现、验证和交付第一版平台。

## 0. 使用方式与优先级

本文件是本项目的单一事实源。执行代理开始工作前必须依次读取：

1. `docs/FAN_SUPPORT_PLATFORM_SPEC.md`
2. `docs/progress/MASTER.md`
3. 当前阶段的 `docs/progress/phase-*.md`
4. `docs/plan/task-breakdown.md`

发生冲突时，优先级为：

1. 用户在当前会话中的最新明确要求
2. 本文件
3. `docs/plan/` 中的实施计划
4. `docs/analysis/` 中的背景分析
5. `docs/双站调研与类似平台技术架构规划.md` 及 `research/` 中的参考站证据

旧调研文档中的榜单、活动、主播入驻、自动分账、社区等扩展设想，不属于当前 MVP，除非用户以后明确恢复。

本文件中的规范词：

- **MUST / 必须**：缺失即不允许合并或上线。
- **SHOULD / 应该**：默认执行；偏离时必须在进度文档中记录原因。
- **MAY / 可以**：可选优化，不得阻塞 MVP。
- **MUST NOT / 禁止**：违反即视为缺陷。

## 1. 已确认的产品定义

### 1.1 一句话定义

一个面向全球粉丝的精品偶像礼物商城：粉丝浏览偶像照片，选择偶像和礼物，留下私密留言并完成支付；运营团队准备或采购礼物、交付给偶像，并向粉丝反馈订单状态。

### 1.2 产品目标

平台必须同时做到：

1. **转化简单**：访客不注册也能在最短路径内完成送礼。
2. **归属正确**：每个购物车行和订单行都能证明礼物送给哪位偶像。
3. **视觉高级**：偶像摄影是第一视觉主角，界面像精品时尚画册而不是通用商城模板。
4. **交互精致**：关键动作有清晰、克制、可感知的反馈，且不牺牲性能和可访问性。
5. **运营轻松**：工作人员能在平台自研管理后台替换偶像海报、资料、商品图片、价格和库存，无需改代码。
6. **支付可扩展**：首期只接必要渠道，但支付边界从第一天就支持适配器化与配置化启停。
7. **源码自主**：前台、管理后台、内容、商品、库存、购物车、订单、履约和支付编排全部由本项目源码实现，不依赖 Shopify 等建站/商城 SaaS。

### 1.3 成功指标

MVP 上线后至少监测：

- `view_idol → add_to_cart` 转化率
- `begin_checkout → paid` 支付成功率
- 各国家、币种和支付方式的成功率与失败原因
- 每位偶像的礼物数量与 GMV
- 已付款订单到 `DELIVERED` 的中位时长
- 退款率、拒付率和重复 webhook 数
- 移动端 LCP、INP、CLS
- 内容更新从后台发布到前台可见的延迟

## 2. MVP 范围与非目标

### 2.1 MVP 必须包含

- 响应式品牌首页
- 偶像目录与偶像详情
- 偶像专属礼物列表
- 礼物详情或快速详情层
- 购物车抽屉与购物车页
- 游客结账
- 自研结账页与支付编排；卡号/钱包授权使用 PSP 托管页面或托管字段
- 支付成功页
- 通过安全链接查询订单
- `PAID → PREPARING → DELIVERED` 履约状态
- 私密粉丝留言
- 七语言首发：英文 `en` 为默认/源语言，并支持简体中文 `zh-CN`、泰语 `th`、越南语 `vi`、日语 `ja`、西班牙语 `es`、葡萄牙语 `pt`
- 自研管理后台的偶像、海报、礼物、价格、库存、首页与媒体管理
- 支付渠道适配接口、地区规则、后台启停与统一 webhook 处理
- 退款、支付失败、取消和拒付状态
- 基础分析、日志、告警、备份与回滚

### 2.2 明确不做

MVP 禁止扩展到：

- 粉丝社区、动态、私信、公开评论墙
- 粉丝等级、积分、任务、签到
- 排行榜、赛季、活动众筹和目标进度
- 偶像自主入驻、KYC、余额、提现和自动分账
- 外部经纪公司或多租户商户系统
- 直播、视频通话和实时聊天
- 推荐算法和复杂个性化
- 原生 iOS/Android App
- 强制注册账号
- 储值余额、平台积分或 OpenRouter 式预充值体系
- 任意运行时上传第三方支付代码
- Shopify、WooCommerce、BigCommerce 等建站/商城系统作为业务运行依赖
- 自研处理或保存卡号、CVV、钱包凭证等支付敏感认证数据
- 为了“完全自研”而自建银行卡清算、邮件投递网络、对象存储硬件或 CDN 网络

新增上述功能前必须先修改本规范、风险评估和任务计划。

### 2.3 “完全自研源码”的边界

必须由本仓库实现并可独立部署：

- 粉丝前台、运营后台、API 与 Worker
- 内容与媒体元数据、商品、价格簿、库存与预占
- 购物车、结账编排、订单、退款、履约、通知编排与审计
- 支付能力查询、渠道路由、adapter、webhook 归一化和对账
- 数据库 schema、迁移、权限规则、部署清单与运行手册

允许通过明确 port 使用的外部基础设施：合规 PSP、托管 PostgreSQL、S3 兼容对象存储/CDN、事务邮件、KMS/Secret Manager、OIDC 身份提供商、监控与 DNS/WAF。它们不得拥有平台的业务真相源；替换供应商只能影响对应 adapter 和配置。使用云基础设施不等于使用第三方建站系统。

## 3. 角色、权限与核心场景

### 3.1 角色

| 角色 | 权限边界 |
|:--|:--|
| 访客/粉丝 | 浏览、选择偶像与礼物、留言、游客结账、通过安全链接查单 |
| 内容运营 | 编辑偶像资料、海报、礼物内容、首页推荐和翻译；不能查看支付密钥 |
| 订单运营 | 查看订单必要信息、更新准备/送达状态、处理客服备注 |
| 财务/管理员 | 退款、对账、支付渠道启停、查看手续费与拒付；高风险操作需要二次确认 |
| 开发者 | 部署代码、接入新支付适配器、配置环境；不能在日志中读取完整敏感数据 |

MVP 没有偶像登录角色。偶像资料由平台运营维护。

### 3.2 核心用户旅程

```text
进入首页
  → 浏览偶像照片
  → 选择偶像
  → 查看该偶像可接收的礼物
  → 选择礼物、数量与私密留言
  → 购物车再次确认“送给谁”
  → 选择可用支付方式并付款
  → 查看成功页与订单号
  → 邮件收到安全查单链接
  → 查看“已付款 / 准备中 / 已送达”
```

### 3.3 不可破坏的业务不变量

1. 购物车行没有有效 `idol_id` 时，禁止创建结账。
2. 礼物不适用于所选偶像时，服务端必须拒绝，不得信任前端隐藏字段。
3. 订单行必须保存偶像、礼物、价格、币种、图片和文案快照。
4. 偶像私人地址不得返回给浏览器、分析平台或普通运营角色。
5. 粉丝留言在 MVP 中只对平台运营和收礼偶像的内部流程可见，默认不公开。
6. 只有可信的 PSP 服务端证据才能把订单标记为 `PAID`：经过验签且幂等处理的 webhook，或经过认证、审计并持久化的主动 reconcile 结果；浏览器回跳永远不能确认付款。
7. 状态未知的支付不得自动再次扣款或盲目切换备用通道。
8. 支付渠道配置可以热更新；接入全新 PSP 必须经过代码审查、沙盒测试和灰度部署。
9. 粉丝留言必须先经过平台的安全/内容审核状态，未经批准不得直接展示给偶像或公开传播。
10. 语言、市场、国家、币种和支付能力是独立维度；切换语言不得改变购物车、偶像/礼物上下文、价格、币种、市场或支付渠道。

## 4. 信息架构与路由

首发公开 locale 是 `en | zh-CN | th | vi | ja | es | pt`。所有公开 HTML 页面必须使用 locale 前缀；API、webhook 和管理 API 不放在 locale 路径下，语言通过经过 `SupportedLocale` schema 校验的请求上下文传递。

| 路由 | 页面 | 索引策略 | 主要动作 |
|:--|:--|:--|:--|
| `/` | locale 入口 | noindex | 有有效 `site_locale` cookie 时以 `302/307` 到该语言，否则到 `/en` |
| `/:locale` | 首页 | index | 选择偶像、查看推荐礼物 |
| `/:locale/idols` | 偶像目录 | index | 搜索/浏览偶像 |
| `/:locale/idols/:handle` | 偶像详情 | index | 选择礼物 |
| `/:locale/gifts/:handle` | 礼物详情 | index | 确认偶像、加入购物车 |
| `/:locale/cart` | 购物车页 | noindex | 编辑数量/留言、开始结账 |
| `/:locale/checkout` | 自研结账页 | noindex | 复核订单、填写联系邮箱、同意条款、选择可用支付方式并创建 payment attempt |
| `/:locale/checkout/return` | 支付回跳 | noindex | 查询真实支付状态 |
| `/:locale/order-access` | 一次性查单凭证交换页 | noindex | 从 URL fragment 读取 token、交换受保护会话并立即清除 fragment |
| `/:locale/orders/:publicOrderId` | 安全查单页 | noindex | 依赖 HttpOnly 访问会话查看履约状态 |
| `/:locale/thank-you/:publicOrderId` | 成功页 | noindex | 确认订单；不得公开分享私密订单链接 |
| `/:locale/policies/*` | 条款/隐私/退款 | index | 建立信任 |
| `/api/*` | BFF/API | noindex | 数据与业务命令 |

全站必须使用一个 canonical 主域。HTTP、`www` 与其他别名必须在边缘层使用 301/308，不得依赖浏览器 JavaScript 跳转。`/` 的偏好跳转响应必须 `private, no-store`，不得进入共享 CDN 缓存；URL 中的显式 locale 优先级最高。首次访问可根据 `Accept-Language` 显示非阻断建议，但不得静默改变 `/en` 默认、市场、币种或支付能力。

## 5. 页面级设计与交互约束

### 5.1 全局导航

**目的**：让粉丝随时知道品牌、当前偶像和购物车状态。

必须：

- 桌面端使用透明或半透明覆盖式页头；滚动离开首屏后变为稳定背景。
- 移动端包含品牌、菜单、购物车三个主要控件，触控区域不小于 44×44 px。
- 导航只保留首页、偶像、礼物、订单查询、独立的语言/地区控件和购物车；语言选择器使用 `English / 简体中文 / ไทย / Tiếng Việt / 日本語 / Español / Português` 自称，不使用国旗代替语言。
- 切换语言时必须保留同一路由、handle、query、偶像/礼物上下文、购物车、market、currency、价格与既有 payment attempt；目标语言缺少同一对象时按英文对象级事故 fallback 规则处理，禁止把用户送回无关首页或重建交易上下文。
- 当前页面、键盘焦点、菜单展开和购物车数量必须有非颜色唯一的状态反馈。
- 菜单打开后锁定背景滚动，关闭后焦点回到触发按钮。

禁止：

- 多层级巨型菜单
- 自动播放声音
- 滚动时不断缩放或跳动的 Logo
- 导航中堆叠促销胶囊和无关社交链接

### 5.2 首页 `/:locale`

**视觉任务**：第一屏必须像偶像时尚海报，而不是商品卡片集合。

内容顺序：

1. 全屏主海报：品牌、短标题、单一 CTA、一个主偶像视觉。
2. 偶像选择：大幅人物图与名字，允许平滑切换。
3. 推荐礼物：以媒体和排版为主，避免通用卡片墙。
4. 送礼流程：三步以内说明“选择、付款、送达”。
5. 信任与服务：支付、隐私、退款和客服联系。
6. 最终 CTA：再次选择偶像。

交互：

- 主海报进入动效总时长 600–900 ms，只使用透明度、位移、遮罩或轻微缩放。
- 偶像切换必须在 360 ms 内完成主要视觉过渡，并保留焦点与滚动位置。
- 用户触摸、使用键盘或开启减少动态效果后，不启用滚动劫持和视差。
- 首页不得自动轮播会导致用户失去控制的主要内容。

状态：加载、图片失败、无推荐偶像、无推荐礼物、离线重试均必须有稳定布局，不得发生大幅 CLS。

### 5.3 偶像目录 `/:locale/idols`

- 以人物摄影和姓名为主，默认不使用厚重卡片边框。
- 首期偶像较少时不显示无价值筛选；超过 20 位后才启用搜索或分组。
- 每张人物图必须具有独立移动裁切、alt 文本和固定宽高比。
- 悬停效果必须同时有键盘等价状态；移动端不依赖 hover 才能显示姓名或 CTA。
- 停止接收礼物的偶像可以展示，但必须清楚标记并禁止加入购物车。

### 5.4 偶像详情 `/:locale/idols/:handle`

首屏必须包含：

- 桌面与移动分别配置的主海报
- 偶像姓名、简短简介和“为 TA 选择礼物”动作
- 当前是否接收礼物

后续内容：

- 精选照片或一段简短故事
- 可接收礼物列表
- “购买后发生什么”的履约说明
- 退款与隐私提示

交互：

- 切换礼物时不得丢失当前偶像上下文。
- 页面中的每个加购入口必须显式携带 `idol_id`，并由服务端重新校验。
- 主题色只影响装饰、选中状态和局部背景，不得降低正文对比度。
- 移动端主 CTA 在用户浏览礼物时可以成为底部安全区内的轻量吸附栏，但不得遮挡内容。

### 5.5 礼物详情 `/:locale/gifts/:handle`

必须展示：

- 礼物高清图、名称、价格、币种
- 当前送给的偶像头像与姓名
- 礼物将如何被采购/准备/交付
- 预计处理时间
- 数量、库存或限量状态
- 私密留言入口
- 退款条件与客服入口

如果用户从全局礼物入口进入且尚未选择偶像，必须先选择有效偶像才能加购。

禁止使用会误导粉丝认为礼物寄给自己的配送文案。不得向粉丝显示偶像收货地址。

### 5.6 购物车抽屉与 `/:locale/cart`

每一行必须展示：

- 偶像头像与姓名
- 礼物缩略图、名称、数量和金额
- 私密留言摘要与编辑入口
- 删除和数量调整

交互：

- 加购成功后在 220–320 ms 内出现可感知反馈，同时使用 `aria-live` 宣告。
- 抽屉打开时不能抢走用户正在输入的内容；关闭后恢复焦点。
- 数量更新使用乐观反馈，但服务端失败时必须回滚并解释原因。
- 结账前服务端重新校验偶像状态、礼物适用关系、价格、币种与库存。
- 同一礼物送给不同偶像必须形成不同购物车行，不得错误合并。

### 5.7 结账与支付

- `/:locale/checkout` 是平台自研页面，负责订单复核、联系邮箱、条款同意、服务端报价、库存预占、payment capability 与 attempt 状态；不得把整个 checkout 外包给商城平台。
- 结账前必须再次显示偶像、礼物、数量和总价。
- 粉丝只填写支付和联系所必需的信息；偶像配送信息由后台解析。
- 最后一步支付认证可以跳转 PSP 托管页，或在自研 checkout 中嵌入完全由 PSP 提供的 Hosted Fields/Component；托管界面必须使用品牌 Logo、基础颜色、客服与条款链接。
- 可用支付方式根据商户主体、粉丝国家、币种、设备和金额返回，前端不得硬编码渠道列表。
- 支付回跳页不能直接显示成功；必须向服务端查询由验签 webhook 或经认证、审计的 PSP reconcile 证据驱动的真实状态。
- `PENDING` 状态显示安全等待与刷新，不得诱导立即重复付款。

### 5.8 成功页与订单查询

成功页必须形成情绪闭环，但订单信息优先：

- 偶像海报或头像
- 礼物、数量、金额和订单号
- 当前状态及下一步
- 预计准备时间
- 查单安全链接已发送的提示

成功动效最长 900 ms，结束后保持静态；减少动态效果下直接显示最终状态。

邮件安全链接只把高熵、可撤销、带过期策略的 `orderAccessToken` 放入 URL fragment；页面一次性 POST 交换为短时 HttpOnly 访问会话后必须用 `history.replaceState` 清除 fragment。后续查单使用非敏感 `publicOrderId + 访问会话`，不得通过连续内部 ID、邮箱或单独的公开订单号直接暴露订单。

## 6. 视觉设计系统

### 6.1 视觉命题

**电影感偶像画册 × 精品零售的克制 × 可信支付的清晰。**

偶像照片是主角；排版、留白、裁切和过渡负责建立高级感。装饰不能压过人物和购买动作。

### 6.2 默认设计令牌

在品牌正式资产交付前，以下令牌为开发默认值；正式品牌令牌应只通过主题配置替换，不得散落硬编码。

```css
:root {
  --color-bg: #0a0a0c;
  --color-surface: #121216;
  --color-surface-raised: #19191f;
  --color-text: #f6f3ee;
  --color-text-muted: #aaa6a0;
  --color-border: rgb(255 255 255 / 12%);
  --color-accent: #d8b26e;
  --color-success: #63c98d;
  --color-warning: #e5aa55;
  --color-danger: #ea7373;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --space-24: 6rem;
  --space-32: 8rem;

  --radius-control: 0.75rem;
  --radius-media: 1.25rem;
  --radius-pill: 999px;

  --motion-fast: 120ms;
  --motion-control: 220ms;
  --motion-layout: 360ms;
  --motion-hero: 720ms;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
}
```

每位偶像的 `theme_color` 只能覆盖 `--idol-accent`，并通过自动对比度校验。禁止以偶像主题色覆盖支付、错误、成功等语义颜色。

### 6.3 排版

- 按 locale 设置 `--font-ui`：`en/es/pt/vi` 使用覆盖 Latin Extended 与越南语字形的 `Manrope Variable, Noto Sans`；`zh-CN` 使用 `Noto Sans SC`；`ja` 使用 `Noto Sans JP`；`th` 使用 `Noto Sans Thai`；最终回退 `system-ui, sans-serif`。
- 字体自托管并按 script/locale 分包；首屏只预载当前 locale 必需字形，禁止一次下载 SC、JP、Thai 全部大字库。
- 最多一个品牌展示字体加一个 UI 字体；不得每位偶像使用不同字体。
- 正文桌面不小于 16 px，移动端不小于 16 px；行高 1.5–1.7。
- 标题使用 `clamp()` 建立流体比例，首屏品牌/标题不得在常见视口溢出。
- 金额、订单号和状态使用易扫描数字，避免超细字重。
- 禁止给可翻译文本设置固定高度或关键文案省略；泰文、日文与中文不强制大写或拉大字距。组件必须适应西/葡语文本膨胀、越南语组合音标、泰语无空格分词和中日文禁则换行。

### 6.4 网格与响应式

- 设计验证视口：360×800、390×844、768×1024、1024×768、1440×900、1920×1080。
- 内容最大宽度 1440 px；常规内容列最大 1200 px。
- 页面边距：移动 16 px、平板 24 px、桌面 48 px，海报可全宽越过边距。
- 第一屏是完整海报构图；固定页头存在时，必须使用 `100svh` 与页头高度协调。
- 移动端不是桌面压缩版，必须使用独立海报、重新排序内容并简化动效。

### 6.5 图片与素材

- 禁止使用临时渐变、空白方框或低质量占位图替代最终可见资产。
- 偶像主海报建议：桌面 2400×1400 或更高；移动 1080×1350 或更高。
- 人物卡建议 4:5；礼物主图建议 1:1；所有组件必须声明宽高比。
- 运营必须分别上传桌面和移动海报，不能依赖同一横图强裁成竖图。
- 上传后生成响应式 `srcset` 与现代格式；首屏图预加载，折叠下图片懒加载。
- 文本必须落在可读的稳定色块或经过对比度验证的 scrim 上。
- 所有信息性图片必须有本地化 alt；装饰图使用空 alt。

### 6.6 组件约束

- 默认无卡片化；只有礼物、人物和购物车行等真实交互对象可以使用容器。
- 一个页面区段只允许一个主要视觉和一个主要动作。
- 主按钮高度至少 48 px；次按钮不能与主按钮竞争。
- 不使用胶囊标签海、厚重阴影、玻璃拟态堆叠或通用 SaaS 仪表盘风格。
- 图标来自统一图标库，必须有可访问名称；禁止 emoji 充当正式功能图标。
- 骨架屏必须匹配最终结构，最长显示后转为明确加载或错误状态。

### 6.7 动效约束

动效只服务于三件事：建立人物存在感、解释层级变化、确认用户动作。

- 微交互优先 CSS；跨布局和 presence 动效使用单一 React 动效库，禁止同时引入多个重型动效框架。
- 只动画 `transform`、`opacity`、`clip-path` 等合成友好属性；不得持续动画布局尺寸。
- 常规控件 120–220 ms，抽屉/布局 280–360 ms，主海报 600–900 ms。
- 不使用夸张弹跳、持续漂浮、光标跟随、滚动劫持和长时间 loader。
- 所有动效支持 `prefers-reduced-motion: reduce`；减少动态模式下保留状态反馈但取消位移、视差和自动序列。
- 移动端真实设备必须保持流畅；发现掉帧时优先删减动效，不通过延迟输入掩盖。

## 7. 状态与反馈矩阵

| 对象 | 必须覆盖的状态 |
|:--|:--|
| 页面 | 初始、加载、成功、空、局部失败、全页失败、离线、重试 |
| 偶像 | 接收礼物、暂停接收、下线但历史订单可查 |
| 礼物 | 可售、低库存、售罄、预售、下架、仅部分偶像可用 |
| 购物车 | 空、有商品、价格变化、库存变化、偶像暂停、更新失败 |
| 支付 | 未开始、创建中、待用户操作、处理中、成功、失败、取消、状态未知、退款、拒付 |
| 订单 | 待支付、已付款、准备中、已送达、取消、退款中、已退款、争议中 |
| 内容 | 草稿、已发布、计划发布、图片无效、翻译缺失/草稿/待审核/已批准/已过期 |

任何失败状态必须包含：发生了什么、用户是否被扣款、可以做什么、客服入口。禁止只显示错误码。

## 8. 可访问性、国际化与内容语言

### 8.1 可访问性

- 目标 WCAG 2.2 AA。
- 全流程可仅用键盘完成；焦点可见且顺序与视觉一致。
- 对话框、抽屉、菜单、Toast、数量控件和表单错误必须使用正确语义。
- 正文与背景对比度至少 4.5:1；大文本至少 3:1；非文本控件至少 3:1。
- 200% 缩放不丢功能，320 CSS px 宽度不出现横向滚动（必要数据表除外）。
- 动态购物车、支付状态和错误通过适当 live region 宣告，避免重复朗读。

### 8.2 国际化

- `SupportedLocale` 是严格联合类型 `en | zh-CN | th | vi | ja | es | pt`；`en` 是默认语言、源语言和最终事故 fallback。公开名称依次为 `English / 简体中文 / ไทย / Tiếng Việt / 日本語 / Español / Português`。
- `es` 与 `pt` 首版表示经人工审校的中性西班牙语和中性葡萄牙语，不暗示特定国家。未来增加 `es-MX`、`pt-BR` 等地区变体时必须新增 BCP 47 locale、迁移和测试，禁止静默改变现有 `es/pt` 语义。
- URL 中显式 locale 最高优先；其次是有效的 `site_locale` cookie；两者都没有时使用英文。`Accept-Language` 只可用于首次访问的非阻断语言建议，不按 IP 强制跳转。非法 locale 返回 404；只有大小写或尾斜线规范化可使用 308。
- 语言、market、country、currency 与 payment capability 使用独立的 Zod/branded 类型；语言切换只改变 presentation locale，不能触发调价、库存重预占或支付改路。
- 静态 UI、校验、错误和邮件消息放在源码版本控制的 `packages/i18n`/通知模板中；使用语义 key 和 ICU MessageFormat，不以英文句子作为 key。CI 必须校验七语言 key、参数、plural/select 分支与消息编译一致。
- 源码消息按 locale/namespace 保存版本化 review manifest（source hash、translator/reviewer、批准 commit/template version）；未人工批准或源 hash 过期即阻断发布。事务邮件的 subject/preheader/HTML/text 与变量 schema 共同组成不可变 `templateVersion`，旧版本至少保留到相关 outbox/重试与法定审计窗口结束，确保历史通知可重现。
- 偶像、礼物、首页、政策、SEO、媒体 alt/caption 等动态内容使用 PostgreSQL 不可变 revision 翻译表，由自研 Admin 管理；禁止引入外部 CMS 或弱约束的万能 JSON 翻译表。
- 路由、日期、数字、货币、时区显示和复数规则使用 `Intl`/Unicode CLDR 数据，不手工拼接。粉丝留言保存其声明/检测语言为 `fan_message_locale` 或 `und`，默认不自动翻译。
- 货币金额以最小货币单位整数保存；展示使用 ISO 4217 与 locale 格式。
- 生产正常路径不得展示翻译 key 或字段级混杂语言。英文以外内容异常缺失时，整对象回退英文、在对象容器标记 `lang="en"`，并记录 `requestedLocale / resolvedLocale / fallbackUsed`；该 fallback 页面必须 `noindex` 且不得进入对应 locale 的 sitemap/hreflang。checkout、支付/退款安全文案、政策和邮件关键内容缺译时必须阻止整个七语言内容 revision 或对应 locale 启用配置发布，禁止创建单语言 published pointer；邮件运行时事故回退英文必须告警。
- 首发七个 locale 全部启用且 `CRITICAL + REQUIRED` 文案必须 100% 审核通过。机器翻译只能进入 `DRAFT`，不得自动批准或发布；详情见 9.7。
- 预留 RTL 结构能力，但 MVP 不要求完成 RTL 视觉验收。

### 8.3 文案语气

- 简短、温暖、可信，不使用“捐款”或无法证明的公益表述。
- 明确说明礼物将由平台采购、准备或交付给偶像。
- 不承诺偶像一定公开回应或使用礼物，除非该礼物规则明确包含。
- 支付、退款和状态文案优先准确，不使用模糊营销语言。

## 9. 自研内容、商品与运营后台约束

### 9.1 运营目标

经过一次培训的非开发运营人员应该能够：

- 3 分钟内更换首页海报并预览
- 5 分钟内替换偶像照片和简介
- 在结构化素材与七语言译文已准备好的前提下，8 分钟内导入、校验、预览并发布一个结构完整的礼物
- 2 分钟内暂停一位偶像收礼
- 1 分钟内下架有问题的礼物
- 2 分钟内找到订单并更新为准备中或已送达

以上操作不得修改代码、运行命令或人工触发前端部署。计时不包含人工撰写、翻译或法律审校七语言内容；海报/媒体等不改变英文源文案的 revision 应复制沿用已批准翻译，避免简单换图变成重复翻译工作。

### 9.2 偶像编辑器

`idols` 只保存稳定身份、handle、运营状态、`draft_revision_id`、`published_revision_id` 和乐观锁版本。所有本地化文案、SEO 与媒体引用属于不可变 `idol_revisions`；`idol_revision_translations / idol_revision_media` 必须指向 revision，不能直接挂在 base row 上。发布在单一事务中切换 `published_revision_id` 并写 publication/outbox，管理后台提供结构化表单，不直接暴露数据库字段。

| 字段 | 类型 | 约束 |
|:--|:--|:--|
| `id` | UUID | 服务端生成、发布后不可变、唯一 |
| `handle` | slug | URL 安全、唯一、变更时保留 301 映射 |
| `status` | 枚举 | `draft / active / paused / archived` |
| `display_name` | 本地化文本 | 1–40 Unicode 字符 |
| `short_bio` | 本地化文本 | ≤160 字符 |
| `full_bio` | 本地化富文本 | ≤600 字符、受控标签 |
| `portrait_media_id` | MediaAsset 引用 | 4:5，最低 1600×2000 |
| `hero_desktop_media_id` | MediaAsset 引用 | 16:9，最低 2400×1350 |
| `hero_mobile_media_id` | MediaAsset 引用 | 4:5，最低 1080×1350 |
| `gallery_media_ids` | MediaAsset 引用列表 | 最多 12 张，稳定排序 |
| `theme_accent` | 颜色 | 只能用于局部氛围 |
| `hero_text_tone` | 枚举 | `light / dark` |
| `image_focal_point` | 结构字段 | 人脸/主体焦点 |
| `accepting_gifts` | 布尔 | 关闭后禁止新加购 |
| `display_order` | 整数 | 稳定排序 |
| `seo_title` | 本地化文本 | 建议 ≤60 字符 |
| `seo_description` | 本地化文本 | 建议 ≤155 字符 |
| `published_at` | 时间 | 发布审计 |

偶像被历史订单引用后禁止物理删除，只能 `archived`。

### 9.3 礼物、规格、价格簿与库存编辑器

平台数据库是礼物、价格和库存的唯一真相源。`gifts` 保存稳定身份与发布指针；本地化文案、媒体和履约说明属于不可变 `gift_revisions`。价格是 price book 下的不可变有效期记录，发布后不能原地改金额。后台把复杂数据拆成“基础信息、适用偶像、媒体、价格、库存、履约与发布检查”六个步骤。

| 字段 | 约束 |
|:--|:--|
| `gift.id / handle / status` | UUID、唯一 slug、`draft/active/paused/archived` |
| `gift.title / subtitle / description` | 本地化；subtitle ≤80、短描述 ≤160 字符 |
| `gift.fulfillment_description` | 必须解释采购/准备/交付过程 |
| `gift.delivery_estimate` | 结构化最小/最大值与单位 |
| `variant.eligible_idols` | 变体级偶像引用列表，至少一位；UI 可从礼物默认值批量继承，但发布后以变体关系为准 |
| `gift.category / contents` | 受控枚举与规格说明 |
| `gift.safety_notice` | 食品、护肤等按需必填 |
| `gift.shipping_mode` | MVP 固定 `internal_to_idol` |
| `variant.sku / status` | SKU 唯一；可单独暂停或归档 |
| `variant.inventory_policy` | `TRACKED / PROCURE_ON_DEMAND / PREORDER`，默认 `TRACKED` |
| `price.amount / currency` | 最小货币单位整数；属于已发布 price book |
| `inventory.on_hand` | 只能通过库存流水调整，不允许直接覆盖历史 |

礼物被历史订单引用后允许下架或归档，但禁止改变历史快照。

价格和库存规则：

- 首发币种使用显式价格簿，不在结账时用浮点汇率临时换算。
- 调价生成新 revision；已创建订单与支付尝试保留原快照。
- 同一市场、币种、变体与时间区间只能命中一个已发布价格；数据库使用排斥/唯一约束或等价事务校验阻止重叠。
- `TRACKED` 的 `available = on_hand - reserved`；创建 checkout 时预占，超时/失败释放，付款成功转为 committed。
- 每次库存调整必须有原因、操作者/任务来源、幂等键与 append-only ledger。
- `inventory_balances` 是可锁定投影；同一 SKU/location 并发结账必须锁定该行并在同一事务更新 balance、reservation 与 ledger，数据库约束保证 `on_hand >= 0`、`reserved >= 0`、`reserved <= on_hand`（仅 `TRACKED`）。

### 9.4 首页与导航编辑器

- 主海报偶像
- 精选偶像列表
- 精选礼物列表
- 本地化标题、副标题和 CTA
- 公告
- 导航与页脚政策链接
- 发布状态与发布时间

运营只能调整内容和排序，不能自由改变组件结构、字号、间距、动效或结算逻辑。

### 9.5 自研媒体库

- 浏览器只获取短时签名上传凭证；文件不经过应用服务器整包转发。
- 原文件保存于私有 S3 兼容对象存储；公开衍生图通过 CDN 读取。
- 上传后校验 MIME、文件头、尺寸、大小与恶意内容，剥离 EXIF/GPS，再异步生成 AVIF/WebP/JPEG 响应式变体。
- `media_assets` 是不可变二进制身份，保存 checksum、尺寸、对象引用、版权/授权记录、状态和衍生版本；焦点等可编辑结构元数据进入 `media_metadata_revisions`，信息性图片的 alt/title/caption 进入带 `(media_metadata_revision_id, locale)` 唯一键的 `media_metadata_revision_translations`。内容 revision 必须同时引用具体 asset 与 metadata revision，不得用单值 alt 覆盖七语言。
- 相同 checksum 默认去重；被已发布内容或订单快照引用的媒体只能归档，不能静默替换。
- 处理失败显示原因与重试；未通过处理的媒体禁止发布。

### 9.6 编辑保护、预览与发布

- 未上传桌面和移动海报时，偶像不得进入 `active`。
- 礼物未关联偶像时不得发布到前台。
- 图片比例、最小尺寸、alt、焦点和翻译完整度在发布前校验。
- 主题色对比度不合格时，CTA 自动回退到品牌安全色。
- 内容支持 `draft → preview → publish`；预览必须包含桌面和移动链接。
- 预览使用高熵、短时、只读 token，不允许搜索引擎索引或修改生产内容。
- 发布事务写入/引用对应的不可变 `idol_revision / gift_revision / homepage_revision`、追加 `content_publication` 与 outbox，Worker 精确清除 CDN/应用缓存，目标 60 秒内前台可见。
- 发布/缓存失败必须展示状态和重试入口，不能静默失败。
- MUST 保存操作者、时间、对象、变更字段与发布 revision 的审计日志。
- MUST 能一键恢复上一版海报、偶像、礼物、价格簿或首页引用；回退本身生成新 revision。

### 9.7 七语言编辑、审核与发布

- 英文是固定源栏，也是每个 `*_revision_translations` 中真实存在、受审核的 `locale=en` translation row；base revision 只保存非本地化结构字段。英文 row 的 `source_hash` 由其源字段计算，`translated_from_source_hash = source_hash`；其他语言的 `translated_from_source_hash` 指向该英文 hash。右侧以语言自称切换其他六种译文，每个 locale（包括英文）显示 `MISSING`（无记录）、`DRAFT`、`IN_REVIEW`、`APPROVED` 与派生的 `STALE` 状态，并可按缺失、过期、待审核筛选。
- 每条显式 translation 表至少保存 `(revision_id, locale)` 唯一键、本地化字段、`source_hash`、`translated_from_source_hash`、审核状态、审核人和时间。`STALE` 由源 hash 不匹配推导，不允许被手工清除。
- 偶像、礼物、政策、媒体元数据使用各自带外键与字段约束的 translation 表；首页、导航与页脚由同一个 `homepage_revision` 及 `homepage_revision_translations` 拥有，避免重复 publication owner；SEO 字段属于对应对象的 translation row。禁止 `entity_type + entity_id + JSON` 万能翻译表。
- 字段分为 `CRITICAL`（checkout、支付/退款/订单状态、安全、政策、事务邮件）、`REQUIRED`（名称、主要描述、履约说明、CTA、SEO、信息性图片 alt）和 `OPTIONAL`（非关键信息如 caption）。首发七语言的 `CRITICAL + REQUIRED` 必须 100% 且为 `APPROVED`；`OPTIONAL` 缺失可警告但不能产生布局或可访问性缺陷。
- 修改英文源字段时，受影响语言自动变为 `STALE/DRAFT`；创建新 revision 时可复制未变化字段及其批准证据。机器翻译或批量导入只生成 `DRAFT`，由具备 `content.translation.review` 的另一人批准后才能发布。
- Admin 提供 source diff、七语言完成度矩阵、每种语言桌面/移动预览和 fallback 醒目标记。发布动作必须原子校验七语言，切换整个内容 revision 的 published pointer 并写 publication/outbox；禁止分别发布/回滚单个语言造成版本漂移。
- 支持受审计的翻译包导入/导出；包包含稳定对象 ID、revision、locale、英文源、source hash、字段限制与上下文。导入必须校验 source hash、长度、ICU 变量和富文本白名单，过期包拒绝覆盖，且不得导入 SQL 或自动发布。
- 翻译人员只获得内容编辑/审核所需权限，不得读取支付密钥、粉丝留言、完整邮箱或偶像履约地址。审核与发布记录必须包含 editor、reviewer、locale、字段路径、revision/source hash、导入批次和 publication ID。

### 9.8 后台权限

| 权限组 | 可以 | 不可以 |
|:--|:--|:--|
| Content Editor | 偶像、海报、礼物文案、译文草稿与媒体 | 批准自己的翻译、退款、密钥、支付规则 |
| Translation Reviewer | 审核被分配语言的译文 | 发布内容、读取粉丝/支付/履约敏感数据 |
| Order Operator | 查单、履约、内部备注、重发通知 | 改价格、支付配置 |
| Manager | 发布、库存、退款、市场和渠道开关 | 读取明文密钥 |
| Developer/Admin | 应用、webhook、密钥引用、迁移与部署 | 绕过审计直接改生产业务数据 |

退款、支付渠道启停和履约状态强制跳转必须写审计日志。

## 10. 锁定技术架构

### 10.1 选型

| 层级 | 选择 | 约束 |
|:--|:--|:--|
| 仓库 | pnpm workspace + Turborepo | 单仓库、分包构建、独立部署 |
| 粉丝前台 | 稳定版 Next.js App Router + React + TypeScript | SSR/流式渲染；可由标准 Node 容器自托管，不绑定 Vercel |
| 管理后台 | 独立 Next.js App Router 应用 | 自研页面、路由与权限；不使用外部建站/CMS 后台 |
| UI | CSS Variables + Tailwind + CVA | 品牌值只能来自 design tokens |
| 动效 | CSS/WAAPI + 单一 React motion 库 | 不允许多套重型动效引擎并存 |
| 核心 API | NestJS + Fastify adapter 的模块化单体 | Domain 不依赖 NestJS、ORM 或供应商 SDK |
| 数据库 | PostgreSQL + Drizzle query layer + 版本化显式 SQL migrations | 平台所有业务真相源；实际 PostgreSQL catalog 与已评审 SQL migration 是 schema 权威，Drizzle 只提供 query/types；CI 必须做 migration/类型 drift 检查，禁止两边独立手改 |
| 媒体 | S3 兼容对象存储 + CDN + Worker 图片处理 | 媒体 adapter 可替换；原文件私有、衍生图可缓存 |
| 员工身份 | 标准 OIDC adapter + IdP MFA | 管理后台自研；身份提供商不拥有业务权限真相源 |
| 支付 | 自研支付编排 + PSP 托管页面/字段 SDK | 不存卡；provider adapter、capability、webhook、退款与对账全自研 |
| 异步任务 | PostgreSQL Outbox + pg-boss/等价持久队列 | MVP 不引入 Redis；webhook、通知、重试、对账 |
| 合同 | Zod + JSON Schema + OpenAPI | 接口先于实现 |
| 测试 | Vitest + Playwright + axe + MSW | 单元、契约、集成、视觉、E2E |
| 观测 | OpenTelemetry + Sentry 或等价服务 | 日志不包含支付敏感信息和完整 PII |
| 密钥 | 部署平台 Secret Manager | 不进入仓库、数据库或前端配置 |
| 部署 | Docker/OCI 镜像 + Docker Compose 本地 + OpenTofu/IaC | Storefront/Admin/API/Worker 独立镜像；CDN/WAF 在入口层 |

实现时使用当时正式稳定版本，必须记录 Node、Next.js、NestJS、PostgreSQL、Drizzle 与 PSP SDK 的精确锁定版本、支持周期和升级策略。禁止将 preview/canary 版本作为生产基线。

### 10.2 目标目录

```text
/
├── apps/
│   ├── storefront/              # 自研 Next.js 粉丝前台
│   ├── admin/                   # 自研 Next.js 内容/商品/订单后台
│   ├── api/                     # NestJS 模块化单体
│   └── worker/                  # webhook、通知、对账和重试
├── packages/
│   ├── domain/                  # 纯实体、规则和状态机
│   ├── application/             # 用例编排
│   ├── contracts/               # Zod/JSON Schema/OpenAPI；唯一拥有 SupportedLocale schema/type/constants
│   ├── i18n/                    # 导入 contracts；只拥有 ICU 消息目录、加载与格式化
│   ├── catalog/                 # 偶像、礼物、发布规则
│   ├── pricing/                 # 市场、币种、价格簿
│   ├── inventory/               # 库存流水、预占、提交与释放
│   ├── cart/                    # 游客购物车与 support intent
│   ├── orders/                  # 订单、快照、履约与退款规则
│   ├── content/                 # revision、preview、publish、cache tags
│   ├── payment-port/
│   ├── payment-fake/            # 本地与契约测试 adapter
│   ├── payment-routing/
│   ├── persistence-port/
│   ├── persistence-postgres/
│   ├── media-port/
│   ├── media-s3/
│   ├── identity-port/
│   ├── identity-oidc/
│   ├── notification-port/
│   ├── notification-provider/  # 具体事务邮件 adapter，供应商待决策
│   ├── cache-purge-port/
│   ├── cache-purge-cdn/
│   ├── key-management-port/
│   ├── key-management-kms/     # 具体 KMS adapter，供应商在基础设施决策后锁定
│   ├── observability/          # 横切 instrumentation，不得进入 domain
│   ├── design-tokens/
│   ├── ui/
│   ├── config/
│   └── testing/
├── database/
│   ├── migrations/
│   ├── seeds/                   # 仅虚构/授权测试数据
│   └── schema/
├── provider-fixtures/           # PSP/OIDC/邮件/对象存储契约 fixture
├── e2e/
├── infra/
├── docs/
└── scripts/
```

### 10.3 S.U.P.E.R 架构约束

- **S — Single Purpose**：`domain` 只含业务规则；每个 adapter 只负责一个供应商；UI 不处理 webhook。
- **U — Unidirectional Flow**：`Browser → Next.js Route/BFF → Application Use Case → Domain → Port → Adapter`；禁止循环依赖。
- **P — Ports over Implementation**：先定义可序列化合同，再实现数据库、媒体、身份、通知和支付适配器。
- **E — Environment-Agnostic**：域名、对象存储、国家、币种、偶像 ID、provider 与密钥全部通过配置注入；日志写 stdout。
- **R — Replaceable Parts**：更换 PSP、对象存储、OIDC、邮件、队列或观测服务时，只改对应 adapter。

供应商原始对象不得逃出 adapter 层。`pg-boss` 是 PostgreSQL persistence/outbox adapter 的内部实现；日志/trace 是 composition root 注入的横切基础设施，不能被 Domain 调用。Domain 单元测试必须在无网络、无数据库、无框架和无供应商 SDK 时运行。

### 10.4 数据所有权

| 数据 | 唯一真相源 |
|:--|:--|
| 支持 locale 与默认语言 schema/type/constants | 源码中的 `packages/contracts`；其他包只能导入，禁止在 config/i18n/apps 复制 locale 数组 |
| 静态 UI/错误消息 | 源码中的 `packages/i18n` 类型化消息目录；PostgreSQL 启停/排序只能选择 contracts 已定义且目录完整的 locale |
| 偶像、海报、主题、展示顺序、动态翻译 | PostgreSQL 内容表 + 不可变 revisions/translation rows |
| 首页/导航/页脚、政策、SEO、媒体 alt/title/caption | 首页/导航/页脚共用 `homepage_revision`；政策与媒体元数据各有不可变 revision；SEO 位于所属对象 translation row；全部由 PostgreSQL 显式 translation rows 拥有 |
| 礼物、规格、适用关系、上下架 | PostgreSQL catalog 表 |
| 市场、币种与价格 | PostgreSQL price books/revisions |
| 库存、预占与调整流水 | PostgreSQL inventory ledger/reservations |
| 购物车、support intent 与 checkout session | PostgreSQL |
| 媒体原文件和衍生图 | S3 兼容对象存储；PostgreSQL 保存元数据/引用 |
| 支付最终状态 | 已验签 webhook 或经认证且审计的 PSP reconcile 证据，经统一事件模型落库；浏览器回跳不是证据 |
| 偶像归属、留言、署名方式 | support intent + 不可变订单行快照 |
| 内部准备/送达状态 | PostgreSQL |
| 支付渠道规则 | PostgreSQL 版本化配置 |
| 密钥 | Secret Manager |

平台业务表是唯一真相源；搜索索引、CDN、缓存和分析仓库只能作为可重建投影，不得反向覆盖订单、价格或库存。

## 11. 领域模型与合同

所有跨模块合同必须包含 `schemaVersion`，并可序列化。实现前至少定义：

- `SupportedLocale`
- `LocaleContext`
- `Idol`
- `Gift`
- `GiftOffer`
- `PriceBook`
- `InventoryReservation`
- `Cart`
- `CartGiftContext`
- `CheckoutQuote`
- `OrderAmountSnapshot`
- `CheckoutSession`
- `PaymentCapability`
- `PaymentAttempt`
- `ProviderEvent`
- `Order`
- `Refund`
- `Dispute`
- `GiftFulfillment`
- `NotificationCommand`

```ts
type SupportedLocale = "en" | "zh-CN" | "th" | "vi" | "ja" | "es" | "pt";

type LocaleContext = {
  schemaVersion: 1;
  requestedLocale: SupportedLocale;
  resolvedLocale: SupportedLocale;
  fallbackUsed: boolean;
  translationRevision?: string;
};
```

`SupportedLocale` 的 Zod schema、TypeScript type、ordered values、default 与原生名称常量只定义于 `packages/contracts`；`packages/i18n`、config、apps 和 adapters 必须导入，不能各自复制列表。`LocaleContext` 只描述展示语言；不得塞入或推导 market、country、currency、tax jurisdiction 或 payment provider。外部任意字符串必须先经过 BCP 47 规范化与 allowlist 校验，不能把原始 `Accept-Language` 直接作为数据库值或缓存键。

### 11.1 `CartGiftContext`

```ts
type CartGiftContext = {
  schemaVersion: 1;
  idolId: string;
  giftId: string;
  giftVariantId: string;
  fanMessage?: string;
  displayMode: "anonymous" | "nickname";
  displayName?: string;
  presentationLocale: SupportedLocale;
  fanMessageLocale: SupportedLocale | "und";
};
```

规则：

- `fanMessage` 最大 280 个 Unicode 字符。
- `displayName` 最大 40 个 Unicode 字符，仅 `nickname` 时允许。
- MVP 每次成功加购都产生独立购物车行；即使偶像、变体相同，也不得因留言、署名或审核状态不同而自动合并。
- 偶像真实地址不得进入此合同。
- `fanMessage` 和完整显示名只在服务端创建 `support_intent` 后加密保存；购物车读取接口只返回当前粉丝会话所需的脱敏视图。

### 11.2 `support_intent` 与加购原子事务

所有权必须单一：

- `carts` 拥有 `presentation_locale`、market、currency、状态、`version`、token 摘要和过期时间；更新前者不得改变后两者或重新报价。
- `cart_items` 拥有 `cart_id`、`gift_variant_id`、`quantity`、用户看到的 `observed_price_id`、`version`；客户端 PATCH/DELETE 必须携带 `If-Match` 或 `expectedVersion`。
- `support_intent` 只拥有该购物车行的偶像归属、加密留言/署名、审核与转换状态，不复制商品、价格或数量。

`support_intent` 是购物车阶段的可信私密归属记录，至少包含：

- `id`（UUID）
- `cart_item_id`（唯一外键，指向所属购物车行）
- `idol_id`
- `fan_message_ciphertext`
- `display_mode`
- `display_name_ciphertext`
- `encryption_key_version`
- `moderation_status = PENDING | APPROVED | REJECTED | REDACTED`
- `moderation_reason_code`、`reviewed_by`、`reviewed_at`
- `created_presentation_locale`
- `fan_message_locale = SupportedLocale | und`（粉丝自报或安全检测；默认不自动翻译留言）
- `status = ACTIVE | CHECKOUT_LOCKED | CONVERTED | EXPIRED | CANCELED`
- `version`（乐观并发控制）
- `expires_at`、`created_at`、`updated_at`

加购流程：

1. 验证 `Idempotency-Key`。
2. 在数据库事务内读取并验证偶像开放、礼物/variant 上架、适用关系、市场、已发布价格和可用库存。
3. 创建或复用属于当前签名游客会话的 `cart`。
4. 先创建 `cart_item`，再创建以该行 ID 为唯一外键的加密 `support_intent`；同一事务递增 cart version 并写入幂等结果，任一步失败则整体回滚。
5. 返回从服务端实体生成的安全购物车 DTO，不回显留言密文、内部库存或成本。
6. 超时重试以幂等键查询原结果，不创建第二个 intent 或购物车行。

浏览器传来的 `idol_id`、gift/variant、价格、币种、库存和关联关系全部不可信。结账时必须重新校验；不得根据显示名、URL 或客户端缓存猜测订单归属。

`idempotency_records` 只允许保存 actor/operation/key、canonical request hash、安全结果引用、状态与过期时间；禁止保存原始请求体、留言、完整邮箱或完整响应。相同 key 配合不同 request hash 必须返回冲突。

`order_items.support_intent_id` 是 intent→订单行关系的唯一拥有方，并有唯一约束；`support_intents` 不反向保存 `order_item_id`。checkout 创建订单行时在同一事务把 intent 从 `ACTIVE` 改为 `CHECKOUT_LOCKED` 并写入该唯一 FK；付款成功后改为 `CONVERTED`。明确失败/取消时，只要 quote、reservation 和 checkout 仍有效，intent 继续锁定并允许在同一订单受控重试；一旦 checkout/quote 过期，旧订单取消、intent 改为 `CANCELED` 且永久保留关联，不再被清理或复用。UI 可以显式“按当前价格重新加入”来复制为新的 cart item + intent，不能移动旧 FK 或改写旧快照。

### 11.3 订单行快照

```ts
type TranslationSnapshotRef = {
  requestedLocale: SupportedLocale;
  resolvedLocale: SupportedLocale;
  translationRevisionId: string;
  fallbackUsed: boolean;
};

type MediaSnapshot = {
  assetId: string;
  checksum: string;
  objectKey: string;
  metadataRevisionId: string;
  alt: string;
  altTranslation: TranslationSnapshotRef;
};

type InternalOrderItemSnapshot = {
  schemaVersion: 1;
  idolTranslation: TranslationSnapshotRef;
  giftTranslation: TranslationSnapshotRef;
  idolId: string;
  idolHandle: string;
  idolDisplayName: string;
  idolPortrait: MediaSnapshot;
  giftId: string;
  giftVariantId: string;
  giftTitle: string;
  giftImage: MediaSnapshot;
  priceId: string;
  priceRevision: number;
  quantity: number;
  unitAmountMinor: number;
  lineSubtotalMinor: number;
  taxAmountMinor: number;
  discountAmountMinor: number;
  lineTotalMinor: number;
  currency: string;
  supportIntentId: string;
  displayMode: "anonymous" | "nickname";
};
```

所有金额使用最小货币单位整数。`lineSubtotalMinor = unitAmountMinor × quantity`，`lineTotalMinor = lineSubtotalMinor + taxAmountMinor - discountAmountMinor`。订单级 `OrderAmountSnapshot` 必须固化 market、currency、quote revision/expiry、subtotal、tax、shipping/fee、discount 和 total；MVP 未启用的税费/折扣字段显式为 0，禁止隐式省略。`payment_attempt.amount_minor` 必须由已持久化订单总额生成且完全相等，不能接受客户端金额。

订单聚合还必须固化 `presentation_locale`；偶像、礼物与每个媒体 alt 分别通过 `TranslationSnapshotRef` 固化实际使用的 requested/resolved locale、translation revision 与 fallback。政策接受固化 `locale + policy_revision_id + policy_translation_revision_id`；payment attempt 固化平台 requested locale 与 provider 实际 locale；notification delivery 固化 requested/resolved locale、template key/version 和内容 revision 引用。历史订单、查单页和事务邮件默认使用这些下单时快照，不读取后来修改的实时翻译；粉丝切换当前 UI 语言只改变外壳，不改写历史记录。

历史订单渲染读取不可变媒体 asset checksum/object key 与 metadata revision，并由 media adapter 生成当前 CDN URL，不持久化会过期或可换域的 URL。留言和完整显示名不得进入通用订单快照；受权后台通过 `supportIntentId` 按需解密，且每次敏感访问写审计。公共 API 必须映射为 `PublicOrderItemView`，移除 `supportIntentId`、内部对象 key 和其他内部 ID。

退款币种必须等于原 capture 币种；`successful + pending refunds <= captured amount`，并由 `refund_items` 记录订单行金额分配。成功 payment attempt 不因后续退款或拒付离开 `SUCCEEDED`。

### 11.4 核心表

- `idols`、`idol_revisions`、`idol_revision_translations`、`idol_revision_media`
- `gifts`、`gift_revisions`、`gift_variants`、`gift_revision_translations`、`gift_revision_media`
- `gift_variant_idol_eligibility`
- `markets`、`price_books`、`prices`
- `inventory_locations`、`inventory_items`、`inventory_balances`、`inventory_ledger`、`inventory_reservations`
- `media_assets`、`media_variants`、`media_metadata_revisions`、`media_metadata_revision_translations`
- `homepage_revisions`、`homepage_revision_translations`、`homepage_slots`
- `policy_revisions`、`policy_revision_translations`、`policy_acceptances`
- `site_locale_config_revisions`、`site_locale_config_entries`
- `content_publications`、`slug_redirects`
- `carts`、`cart_items`
- `support_intents`
- `checkout_sessions`
- `orders`、`order_items`、`order_events`
- `customer_contacts`、`idol_fulfillment_profiles`
- `order_access_tokens`
- `payment_attempts`
- `payment_transactions`、`merchant_entities`、`payment_provider_accounts`
- `provider_events`
- `webhook_inbox`
- `refunds`、`refund_items`、`disputes`
- `fulfillments`
- `notification_deliveries`（含 requested/resolved locale、`template_key`、不可变 `template_version` 与内容 revision 引用）
- `payment_provider_configs`
- `payment_route_rules`
- `config_versions`
- `admin_identities`、`admin_sessions`、`roles`、`permissions`
- `idempotency_records`、`outbox_events`
- `audit_logs`

平台数据库完整拥有上述业务模型。`inventory_balances` 对 `(inventory_item_id, location_id)` 唯一，且 balance、reservation、ledger 必须在同一事务更新；每个 checkout line 最多一个活动预占。价格、库存、订单、支付事件与履约事件使用显式 revision 或 append-only 流水，不覆盖历史证据。

所有 translation row 以 `(对应的 parent_revision_id, locale)` 唯一（例如 `idol_revision_id`、`gift_revision_id`、`homepage_revision_id`、`policy_revision_id`、`media_metadata_revision_id`），且只能引用 `SupportedLocale`；已发布 revision 及其翻译不可原地更新/删除。`site_locale_config_entries` 只能启用代码已部署、静态目录通过 CI 且动态关键内容已批准的 locale；首发发布配置必须同时启用全部七种语言。翻译完成度可以是可重建 view/read model，但不得成为第二真相源。

`customer_contacts` 保存加密邮箱与规范化邮箱的 keyed HMAC lookup；`idol_fulfillment_profiles` 独立加密真实履约资料。二者都必须有字段级解密权限、查看审计、retention/purge 状态；Outbox 只传内部 ID，受权 Worker 在发送/履约时按需解密。

跨数据库事务与外部副作用使用明确的 crash-recoverable Saga；异步副作用使用 Transactional Outbox。需要立即返回 PSP next action 的支付创建按 13.1 的两事务幂等流程执行，不能把网络调用包在数据库事务中，也不能在不记录 attempt 的情况下直接调用外部服务。

## 12. 状态机

### 12.1 支付状态

```text
Payment attempt:
CREATED
  → REQUIRES_ACTION
  → PROCESSING
  → SUCCEEDED

终止：FAILED | CANCELED | EXPIRED
异常：UNKNOWN（只允许由验签 webhook 或经认证、审计的 reconcile 证据回到明确状态）

Order payment aggregate:
UNPAID → PENDING → PAID
PAID → PARTIALLY_REFUNDED → REFUNDED

Refund:
REQUESTED → SUBMITTING → PROCESSING → SUCCEEDED
                                ├→ FAILED
                                └→ UNKNOWN
UNKNOWN → PROCESSING | SUCCEEDED | FAILED

Dispute projection:
NONE → OPEN → WON | LOST
```

- `UNKNOWN` 必须触发查询/对账，禁止自动创建第二次付款。
- `UNKNOWN` 期间不得自动释放库存后切换渠道；超过保留窗口时可将预占转为 `EXPIRED`，但该订单仍禁止再次扣款，迟到成功按 12.2 的 `ON_HOLD` 规则处理。
- Provider 可以合法跳过中间状态；MVP 只启用 automatic capture，adapter 遇到“仅授权未捕获”时保持 `PROCESSING` 并对账，未经新 ADR、`capture()` 合同和测试不得启用 manual capture。
- `UNKNOWN` refund 的金额继续计入 pending refund 上限；只有可信 provider evidence（验签 webhook 或经认证、审计的 reconcile）将其推进到 `FAILED` 后才释放额度，禁止因超时重复退款。
- 非法跳转必须拒绝并记录审计。
- 浏览器回跳只能触发查询，不能直接写 `SUCCEEDED`。

### 12.2 订单与履约状态

```text
Order lifecycle: DRAFT → PENDING_PAYMENT → OPEN → CLOSED
                              └─────────→ CANCELED
                                             └→ OPEN（仅已核实迟到收款的恢复跳转）

Fulfillment: PENDING → PREPARING → DELIVERED
             PENDING ↔ ON_HOLD
             PREPARING ↔ ON_HOLD
        PENDING/PREPARING/ON_HOLD → CANCELED
```

- 订单生命周期、支付、退款/争议和履约使用正交状态，不压成一个不可组合的巨大枚举。
- 粉丝界面可把组合状态映射为“已付款/准备中/已送达/退款中”等友好状态，但映射必须有单元测试。
- 运营只能执行明确允许的下一步。
- 强制跳转需要 Manager 权限、原因和审计记录。
- 通知失败不能回滚已完成的支付或履约状态。
- `PROCESSING/UNKNOWN` 期间订单保持 `PENDING_PAYMENT`、购物车保持 `LOCKED`，不得因 HTTP 超时进入不可逆取消；只有 PSP 明确失败/取消或受审计的业务取消才能进入 `CANCELED`。
- 迟到的可信成功证据如果发现库存预占已释放，支付仍为 `SUCCEEDED`，订单进入/恢复为 `OPEN`，并从 `PENDING` 直接把履约置为 `ON_HOLD`（UI 映射 `PAID_REVIEW`）；恢复跳转必须记录原状态、provider evidence 与操作者/任务。由运营补货后继续或显式退款，禁止静默超卖或把已收款订单改成失败。

### 12.3 购物车与库存预占状态

```text
Cart: ACTIVE → LOCKED → CONVERTED
        └──────────→ EXPIRED

Reservation: ACTIVE → COMMITTED
                  ├→ RELEASED
                  └→ EXPIRED
```

- `LOCKED` 期间只允许幂等重试同一 checkout，不接受普通编辑；存在非终态或 `UNKNOWN` payment attempt 时不得把 cart 标为 `EXPIRED`。
- 创建 `PENDING_PAYMENT` 订单时预占库存；付款成功提交，PSP 明确失败/取消时释放。普通 HTTP 超时不等于支付失败。
- `UNKNOWN` 超过保留窗口时 reservation 可以条件式转为 `EXPIRED`，但 cart/order 继续锁定并进入人工/自动 reconcile；迟到成功走 `ON_HOLD` 恢复，不尝试从已过期预占再次扣减。
- Worker 释放过期预占必须使用条件更新，不能与 webhook 提交发生双重扣减。

### 12.4 内容与价格发布状态

```text
DRAFT → VALIDATED → PUBLISHED → SUPERSEDED → ARCHIVED
```

发布对象不可原地改写；一个内容 revision 是完整七语言内容包，校验、发布与回滚以整个 revision 为原子单位。rollback 是 `content_publications` 中“将 published pointer 切回历史 revision”的新事件，不是 revision 状态；不得单独回滚一个 locale。历史订单继续读取自身快照。

## 13. 支付适配、配置热更新与安全边界

### 13.1 统一接口

```ts
interface PaymentProvider {
  getCapabilities(context: CheckoutContext): Promise<PaymentCapability[]>;
  createPayment(command: CreatePaymentCommand): Promise<PaymentAction>;
  verifyAndParseWebhook(
    rawBody: Uint8Array,
    headers: Record<string, string>
  ): Promise<ProviderEvent>;
  getPayment(externalReference: string): Promise<PaymentSnapshot>;
  cancel(command: CancelPaymentCommand): Promise<CancelResult>;
  refund(command: RefundCommand): Promise<RefundResult>;
  reconcile(externalReference: string): Promise<PaymentSnapshot>;
}
```

`PaymentAction` 是可序列化判别联合，只允许 `REDIRECT | PROVIDER_HOSTED_IFRAME | PROVIDER_COMPONENT | QR_CODE | WAIT`；任何敏感字段都由 PSP 页面/组件直接接收。

平台 locale 与 PSP 支持语言通过 adapter 内显式映射；`CreatePaymentCommand` 携带平台 `requestedLocale`，adapter 记录实际发送给 provider 的 locale 或英文 fallback。PSP 不支持某语言只能改变托管组件显示语言并产生可观测 fallback，不能改变金额、currency、market、路由结果或订单 locale。

开发期必须实现 `FakePaymentAdapter` 供确定性测试；首个生产 adapter 只能在经营主体和首发市场确定后选择。新增服务商不得修改 `domain`、礼物页面、购物车或订单状态机。

自研 checkout 负责：重新定价、库存预占、订单草稿、联系邮箱、条款同意、payment attempt 与回跳页面。PSP 只负责托管支付认证与资金结果；其 SDK 对象不得成为订单模型。

支付创建必须使用下面的 crash-recoverable Saga：

1. 根据已发布 capability/rule 选定渠道后，第一数据库事务锁定 cart/order，持久化 `CheckoutQuote / OrderAmountSnapshot`、reservation、`PENDING_PAYMENT` 订单和状态为 `CREATED` 的 payment attempt；同时固化 `provider_account_id`、environment、payment method、config/rule version、attempt UUID 形式的 merchant reference 与 provider idempotency key。
2. 事务提交后才向该已固化 provider account 调用 `createPayment`；`CreatePaymentCommand` 的金额、币种、merchant reference 与订单引用只能从已持久化快照/attempt 生成。
3. 第二数据库事务保存 external reference、next action 与归一化状态；如果进程在 provider 成功后崩溃，使用同一 provider account、attempt 和 idempotency key 重试或 reconcile，不能重新路由或新建 attempt。
4. 网络结果不确定时把该 attempt 标记 `UNKNOWN`，锁住订单/购物车并进入 reconcile；禁止自动换 provider、释放后再次扣款或依赖浏览器回跳判成功。

同一订单通过部分唯一索引保证最多一个非终态 payment attempt，`UNKNOWN` 视为非终态。只有前一个 attempt 属于 `FAILED | CANCELED | EXPIRED` 且订单 payment aggregate 仍不是 `PAID | PARTIALLY_REFUNDED | REFUNDED` 时，才可在锁定 order 行的同一事务由受控命令创建新 attempt；`SUCCEEDED` 绝不能作为重试前态。

新 attempt 只能在原 quote 与 reservation 仍有效时复用同一订单。若 reservation 已释放/过期但报价仍有效，必须重新 preflight 并新建 reservation；若报价过期或价格/税费改变，则取消旧订单并创建新订单/快照，禁止改写旧订单金额。早到 webhook 使用 PSP merchant reference 中的 attempt UUID 关联；不支持 merchant reference 的 provider 必须把事件以 `UNMATCHED` 状态写入 inbox，在 external reference 落库后重试关联，不能丢弃或先推进业务。

### 13.2 可以热更新的配置

- 渠道启用/停用
- 国家、市场和币种范围
- 最低/最高金额
- 展示顺序与优先级
- 主通道与备用通道
- 灰度比例
- 健康状态熔断
- 用户可见名称、图标和提示文案

用户可见名称和提示文案必须提供七语言翻译。配置必须使用 `draft → validate → publish`，生成不可变 `config_version`，并支持一键回退。发布后通过事件或短 TTL 缓存传播，目标 60 秒内全部节点生效。

### 13.3 不能热插拔的内容

全新 PSP 必须完成：

1. 独立 adapter 实现
2. webhook 验签与原始报文解析
3. 创建、查询、取消、退款、部分退款和对账
4. 3DS/本地验证流程
5. 沙盒契约测试
6. 真实小额支付和退款
7. 安全与合规审查
8. `disabled → internal → 5% → 25% → 100%` 灰度

禁止运营上传或执行任意支付代码。

### 13.4 路由规则

- 输入只允许国家/市场、币种、金额、设备能力、已发布规则和渠道健康状态。
- 相同输入和 `rule_version` 必须返回相同结果，便于审计复现。
- 只在创建支付前选择备用通道。
- 已创建、待确认、处理中或状态未知的支付不得自动改走另一通道。
- 页面只展示当前真实可用方式，禁止承诺“全球所有支付方式”。
- 卡、钱包、银行转账和本地方式最终受商户主体、PSP 账户、KYC、国家、币种、设备和金额资格约束。

### 13.5 幂等与 webhook

- 创建支付、退款和业务命令必须接受幂等键。
- webhook 使用原始 body 验签，校验时间窗和事件来源。
- `webhook_inbox` 以 `(provider_account_id, environment, provider_event_id)` 唯一去重；原始 payload 仅短期加密保存并设 TTL/受限访问，长期只保留 allowlist 后的 normalized event。
- 处理使用 inbox/outbox 模式；失败进入有限重试和死信队列。
- 重复、乱序、延迟以及退款/争议事件早于前台回跳均必须可恢复。
- webhook 可以按事件 ID 安全重放，但重放不能重复发货、退款或通知。

## 14. API 边界

建议首期接口：

粉丝端：

- `GET /api/v1/idols?locale=`
- `GET /api/v1/idols/:handle?locale=`
- `GET /api/v1/gifts/:handle?idol=&locale=`
- `POST /api/v1/carts`
- `GET /api/v1/cart`
- `POST /api/v1/cart/items`
- `PATCH /api/v1/cart/items/:itemId`
- `DELETE /api/v1/cart/items/:itemId`
- `POST /api/v1/cart/validate`
- `POST /api/v1/checkout/sessions`
- `GET /api/v1/checkout/sessions/:id/payment-capabilities`
- `POST /api/v1/checkout/sessions/:id/payment-attempts`
- `GET /api/v1/checkout/sessions/:id/payment-attempts/:attemptId`
- `POST /api/v1/checkout/sessions/:id/payment-attempts/:attemptId/cancel`
- `GET /api/v1/checkout/sessions/:id/status`
- `POST /api/v1/order-access/exchange`
- `GET /api/v1/orders/:publicOrderId`

Provider：

- `POST /api/v1/webhooks/payments/:endpointId`

管理端：

- `/api/v1/admin/idols/*`
- `/api/v1/admin/gifts/*`
- `/api/v1/admin/media/uploads/*`
- `/api/v1/admin/content/preview/*`
- `/api/v1/admin/content/publish/*`
- `/api/v1/admin/prices/*`
- `/api/v1/admin/inventory/adjustments`
- `POST /api/v1/admin/support-intents/:id/moderate`
- `POST /api/v1/admin/orders/:id/prepare`
- `POST /api/v1/admin/orders/:id/hold`
- `POST /api/v1/admin/orders/:id/resume`
- `POST /api/v1/admin/orders/:id/deliver`
- `POST /api/v1/admin/orders/:id/refund`
- `POST /api/v1/admin/payments/:id/reconcile`
- `POST /api/v1/admin/webhook-events/:id/replay`
- `POST /api/v1/admin/dead-letters/:id/retry`
- `GET /api/v1/admin/payment-configs/draft`
- `POST /api/v1/admin/payment-configs/validate`
- `POST /api/v1/admin/payment-configs/publish`
- `POST /api/v1/admin/payment-configs/:version/rollback`

要求：

- 公共 API 使用限流、输入 schema、统一错误码和 request ID。
- BFF 必须从已校验的 `/:locale` route 生成 canonical `LocaleContext`；内容读取接口必须显式携带规范化 locale，响应返回 `requestedLocale / resolvedLocale / fallbackUsed / translationRevision`。禁止以任意字符串、IP 国家或隐式全局 `Accept-Language` 直接选择内容/缓存。
- 管理 API 使用 OIDC Authorization Code + PKCE、服务端会话、RBAC、CSRF 防护和审计；角色权限保存在平台数据库。
- 粉丝购物车使用至少 256-bit 的 opaque random token 与 HttpOnly/Secure/SameSite cookie 绑定，数据库只存带 pepper 的摘要；禁止 JWT/自包含业务字段和连续 ID 作为授权。
- 购物车 token 不得出现在 URL、日志、分析或响应正文；上述 `/cart` API 只从受保护 cookie 解析当前购物车，数据库仅保存 token 摘要。
- 查单 token 只允许在禁用 request-body logging 的交换接口中出现；成功交换后设置短时、受订单范围约束的 HttpOnly cookie，普通订单接口同时校验该 cookie 与 `publicOrderId`。
- checkout session、capability、attempt 与 status 接口必须绑定创建它的 cart/checkout HttpOnly 会话并校验 market/currency；仅知道 session/attempt UUID 不能读取或推进状态。return state 使用独立高熵摘要或同一受保护会话，且不能确认付款。
- `endpointId` 是不可枚举用途但不作为秘密的随机标识，服务端在读取 payload 前把它唯一映射到 `provider_account_id + environment + 验签密钥引用`；禁止先信任 payload 内账户字段来选择密钥。轮换 endpoint 时保留受限重叠窗口和审计。
- 所有高风险管理命令必须在 OpenAPI 中逐个定义 RBAC、`Idempotency-Key`、`expectedVersion` 和强制审计 reason；不得用通配 CRUD 绕过状态机。
- API 错误不得泄漏栈、密钥、内部 ID 映射或供应商原始响应。
- OpenAPI 与 Zod 合同必须由同一来源生成或在 CI 中校验一致性。

## 15. 安全与隐私

- 卡号、CVV、支付凭证只进入 PCI 合规托管页面/组件，平台禁止存储。
- 偶像真实收货地址只在受限履约系统中可见，不进入购物车属性、分析和普通日志。
- 邮箱、留言、显示名和订单 token 按 PII 处理；日志默认脱敏。
- 留言与显示名使用版本化 envelope encryption；数据密钥由 KMS/Secret Manager 保护，数据库不保存可解密主密钥。
- 查单 token 只向粉丝展示一次，服务端保存不可逆摘要；支持过期、轮换和撤销。邮件链接使用 fragment，交换页禁止第三方脚本并立即清除 fragment，token 不得进入服务端访问日志、分析、Referrer 或普通页面历史。
- 前台富文本必须白名单清洗；留言防 XSS、双向文本混淆和异常 Unicode 滥用。
- 留言在交付偶像前经过自动规则与受限运营复核；拒绝骚扰、威胁、仇恨、性内容、个人联系方式和索取私下联系。审核流程必须覆盖七种首发语言；自动检测不支持或低置信度时进入具备对应语言能力的人工队列，绝不能因“不认识语言”自动批准。保留/删除期限由隐私政策配置并可审计。
- 管理员必须启用 MFA；退款、强制状态变更和渠道启停需要二次确认。
- 全站 HTTPS、HSTS、CSP、`frame-ancestors`、X-Content-Type-Options、Referrer-Policy 与合理 Permissions-Policy。
- 所有密钥从 Secret Manager 注入并支持轮换；前端 bundle 和仓库中不得出现私钥。
- 对登录、查单、购物车、支付创建、退款和 webhook 做差异化限流与滥用防护。
- 数据保留、删除请求、退款和消费者条款必须在生产上线前由经营主体确认。

## 16. SEO、性能与分析

### 16.1 SEO

- 首页、偶像和礼物按 locale 服务端渲染，设置正确的 `<html lang>`/`Content-Language`，具有本地化且唯一的 title、description、self-canonical、OG 文案/图和适用的 `inLanguage`。
- 正常发布态中，每个语言页输出互返且包含自身的七个 hreflang，并加 `x-default` 指向对应英文 URL；禁止把七语言 canonical 全指向英文。
- 生成 sitemap index 与按 locale 分片的 sitemap；只收录真实已发布翻译，`lastmod` 来自该翻译/内容 publication。正式环境不得输出全站 `noindex`。
- 输出 Organization、Product/Offer、BreadcrumbList 等适用结构化数据。
- 多语言使用稳定 locale URL，不以客户端脚本替换完整页面内容。某实体的目标 locale 发生英文事故 fallback 时，该页必须 `noindex` 并从 sitemap 移除；同时从该实体所有其他语言页的 alternate cluster 双向移除失败 locale 并精确 purge，修复并重新批准后才恢复七语言互返。
- 购物车、支付回跳、成功与安全查单页必须 noindex。

### 16.2 性能预算

- 真实用户 p75：LCP <2.5 s、INP <200 ms、CLS <0.1。
- 移动 Lighthouse 性能目标 ≥90，但不能用单次实验室分数替代 RUM。
- 首屏 JS 建议 <150 KB gzip；非关键动效与第三方脚本按路由加载。
- 首屏海报优化后 SHOULD <600 KB；常规页面图片 SHOULD <400 KB/张。
- 图片有固定尺寸、`srcset`、现代格式与正确加载优先级。
- 首页不得加载支付 SDK、后台代码或所有商品数据。
- 已发布公共内容使用 ETag、CDN `s-maxage ≤ 60` 与精确 purge；多实例部署不得只依赖某个 Next.js 实例的本地 `revalidateTag` 保证一致性。
- 公共 HTML、DTO、ETag、cache key/tag 必须包含规范化 locale；涉及可售性时还包含 market，涉及价格时包含 market + currency。翻译发布 outbox/purge 必须带 locale；英文源变化还要失效所有依赖英文事故 fallback 的投影。显式 locale URL 不使用 `Vary: Accept-Language`。
- preview、cart、checkout、order 和管理接口必须 `private/no-store`；任何共享 CDN 缓存键不得包含或泄漏 token、邮箱、留言和个性化订单数据。

### 16.3 分析事件

- `view_home`
- `view_idol`
- `view_gift`
- `select_idol`
- `add_to_cart`
- `cart_open`
- `begin_checkout`
- `payment_method_shown`
- `payment_succeeded`
- `payment_failed`
- `order_viewed`
- `fulfillment_delivered`
- `refund_completed`

事件可以包含 allowlist 后的 `locale` 维度，但不得把 locale 当成国家/市场。事件禁止包含完整邮箱、留言文本、偶像地址、支付凭证和未脱敏供应商响应。

## 17. 可观测、故障处理与运维

- 一个 request/trace ID 能串联 storefront、API、queue、webhook 和通知。
- 指标至少覆盖 API 延迟/错误、支付成功率、渠道失败原因、webhook backlog、队列延迟、通知失败、内容同步延迟。
- 对支付成功率突降、重复事件激增、队列积压和内容发布失败配置告警。
- `UNKNOWN` 支付、死信 webhook、通知多次失败进入运营待处理队列。
- 生产数据库开启时间点恢复；定期演练恢复。
- Storefront、Admin、API、Worker 使用带 digest 的不可变 OCI 镜像，可分别回退到上一已验证版本。
- 支付配置可在 1 分钟内熔断或恢复上一版本。
- 建议目标：代码回滚 ≤15 分钟、RPO ≤5 分钟、RTO ≤60 分钟。

## 18. 测试与质量门禁

### 18.1 测试分层

| 层级 | 内容 | 门槛 |
|:--|:--|:--|
| 单元 | 状态机、价格快照、路由、匿名规则、幂等 | Domain branch coverage ≥90% |
| i18n 合同 | 七语言消息 key/ICU 参数/plural、SupportedLocale、fallback、格式化 | 缺失/多余 key、参数漂移或编译失败即阻断 CI |
| 属性测试 | 路由确定性、金额边界、非法状态跳转 | 失败 seed 可复现 |
| Schema | API、queue、webhook fixture | 未知版本安全拒绝/兼容 |
| Adapter 契约 | PSP/OIDC/media/email/webhook/refund | 同类 adapter 共用认证套件 |
| 集成 | test DB + object storage emulator + fake PSP/queue | CI staging 必跑 |
| E2E | 核心购买、失败、取消、返回、退款 | 首发浏览器全部通过 |
| 视觉 | 360/390/768/1024/1440/1920 | 未批准差异为 0 |
| 可访问性 | axe + 键盘 + VoiceOver/NVDA 冒烟 | critical/serious 为 0 |
| 性能 | Lighthouse CI + RUM | 达到性能预算 |
| 安全 | SAST、依赖、secret、XSS、越权、重放 | High/Critical 为 0 |
| 弹性 | 超时、乱序、重复、队列积压 | 无丢单、无重复扣款 |

### 18.2 必测 E2E

1. 选择偶像、礼物、留言并游客结账。
2. 同一购物车中为不同偶像购买礼物，归属保持独立。
3. 支付失败/取消返回后，偶像、礼物和留言不丢失。
4. 价格、库存或偶像状态变化时，结账前阻止旧数据。
5. 支付回跳先到、webhook 后到时显示处理中并最终一致。
6. 相同 webhook 连续发送 10 次不产生重复副作用。
7. 退款、部分退款和拒付正确更新订单。
8. `PAID → PREPARING → DELIVERED` 并发送一次通知。
9. 后台关闭渠道后新结账不再展示，已有支付不受影响。
10. 运营替换桌面/移动海报，预览并发布后 60 秒内前台更新。
11. 七种 locale 的首页→偶像→礼物→购物车→checkout→查单核心路径均能完成，且 `<html lang>`、日期、金额、复数和订单/邮件文案正确。
12. 从深链切换七种语言仍停留在同一实体/步骤，并保留 cart、market、currency、价格与支付 attempt；非法 locale 为 404。
13. 七语言 self-canonical、互返 hreflang、`x-default`、sitemap 与本地化 metadata/OG snapshot 正确；英文事故 fallback 页面 noindex、不进入 sitemap，且从同一实体的整个 alternate cluster 双向移除。
14. locale-aware cache 不串语言；英文源更新、翻译发布和回退能精确失效，PSP 不支持目标语言时只回退托管 UI 并保留订单/金额/路由。

开发环境增加 `PseudoLocale = en-XA` 用于文本膨胀与漏译检查；它是 dev/test-only presentation 类型，绝不加入 `SupportedLocale`，也不得进入 PostgreSQL、cookie、公共 API、cache key、analytics、SEO 或 sitemap。视觉/可访问性回归至少覆盖英语、一个 CJK、泰语、越南语和最长西/葡语文案；Phase 3/7 发布门禁仍须覆盖全部七种公开 locale，并在 390×844 与 1440×900 检查核心页面。

### 18.3 PR Gate

每个 PR 必须通过：

- format、lint、typecheck、build
- unit、schema、adapter contract
- 受影响页面的视觉与可访问性回归
- 无 High/Critical 安全问题
- 无新增硬编码 secret、域名、生产 locale 特判、币种、偶像 ID 或支付方式
- S.U.P.E.R Quick Check 全部通过
- 高风险支付、迁移和权限代码至少一名非作者审查

### 18.4 Release Gate

- Staging 全链路 UAT 完成。
- 每个首发支付方式完成真实小额支付和退款。
- webhook backlog 为 0，可安全重放。
- Storefront、Admin、API、Worker、对象存储、支付配置和数据库恢复/回退演练完成。
- 公司主体、政策、客服、邮件和收款信息一致。
- 七语言静态目录、动态 `CRITICAL + REQUIRED` 内容、政策、支付/退款/订单状态、信息性图片 alt 和事务邮件均 100% `APPROVED`，翻译缺失/过期为 0，并有人工复核证据。
- 性能、错误率、支付成功率和队列告警生效。
- 正式页面无占位文案、演示数据、错链、破图和未批准素材。

## 19. 分阶段实施顺序

执行代理必须按 `MASTER.md` 的 Phase 解锁矩阵推进。唯一允许同时 `ACTIVE` 的跨 Phase 组合是 Phase 1 与 Phase 2，且只能在 Phase 0 退出门禁通过后启用；其余 Phase 必须等待前置退出门禁。每个 Lane 同时最多一个 executor，不得只凭任务依赖绕过 Phase 状态。详细任务、依赖和验收命令见 `docs/plan/` 与 `docs/progress/`。

### Phase 0：基线与可运行骨架

目标：建立一个所有后续工作都能复用的、可安装、可构建、可部署的单仓库。

1. 初始化 pnpm workspace、Turborepo、TypeScript、共享 lint/format/test 配置。
2. 创建 `storefront / admin / api / worker` 应用和包含 `packages/i18n` 的 `packages/*` 空边界；禁止先写业务大类。
3. 建立本地环境、配置 schema、示例环境文件和 secret 注入约束；Phase 0 不在 config/apps 复制 locale 常量，七语言合同由 P1-01 唯一冻结。
4. 建立 Next.js Storefront/Admin、NestJS API、Worker、PostgreSQL 和对象存储的本地/预览环境及最小 health endpoint。
5. 建立 CI、依赖/secret 扫描、OpenTelemetry request ID 和结构化日志基线。

退出门禁：全新 checkout 可用一条文档化命令安装依赖；format、lint、typecheck、unit、build 全绿；Storefront、Admin、API 和 Worker 能在本地启动；PR 能生成安全预览。

### Phase 1：合同、领域与数据真相源

目标：先锁定业务规则和跨模块合同，再接 UI。

1. 在 `packages/contracts` 用 Zod 唯一定义七值 `SupportedLocale`、默认 `en`、ordered values/native names、`LocaleContext`、领域/API schema、事件 envelope、错误码、订单/通知语言快照和 `schemaVersion` 策略；`packages/i18n` 只消费该合同。
2. 定义偶像、礼物、媒体、政策、价格簿、库存、首页与七语言 revision/translation schema、完整度/过期规则，并创建验证 fixture；本步骤不直接修改 migration。
3. 以纯 TypeScript 实现偶像/礼物适用关系、金额、状态机、幂等和支付路由规则。
4. 建立 PostgreSQL 迁移、显式 translation/review/locale config 表、核心交易表、inbox/outbox 和审计 append-only 约束。
5. 定义 persistence、media、identity、notification、payment、cache-purge、key-management ports；完成 PostgreSQL repository、S3-compatible/CDN purge、获批 KMS 与 fake adapters。
6. 用重复、乱序、无效签名 fixture 验证 webhook inbox 和队列处理。

退出门禁：Domain 可在无网络、无数据库、无框架时测试；迁移可从空库完整执行并回滚最近一版；七语言合同/消息目录/translation publication 能被 CI 检测；locale 不改变 market/currency；重复 webhook 无重复副作用。

### Phase 2：设计系统与交互样板

目标：先证明高级视觉、可访问性和动效语言，再批量做页面。

1. 实现 design tokens、按 locale 分包字体、流体排版、网格、主题和偶像 accent 安全覆盖。
2. 实现 Button、Link、Media、Price、Status、Dialog/Drawer、Toast、Quantity 与独立 Language/Region 控件等原语。
3. 实现 Hero、IdolPortrait、GiftTile、IdolContext、CartLine、OrderTimeline 组合组件。
4. 建立桌面/移动响应式媒体策略、图片焦点和错误降级。
5. 完成主海报进入、偶像切换、加购/成功三个标志性动效及 reduced-motion 等价状态。
6. 建立组件展示页和 6 个基准视口的视觉、键盘、axe、性能回归；覆盖 CJK、Thai、Vietnamese、长 Spanish/Portuguese 和 pseudo-locale。

退出门禁：品牌样板经人工批准；所有原语只使用令牌；键盘路径完整；axe critical/serious 为 0；移动真实设备无明显掉帧。

### Phase 3：自研 Admin、内容与浏览前台

目标：运营能发布真实内容，粉丝能完整浏览但尚不支付。

1. 实现 locale-aware 内容/媒体/发布 API、不可变七语言 revision、preview、outbox 与按 locale 的 CDN 缓存失效。
2. 实现自研管理后台的首页、偶像、媒体库与翻译完整度矩阵、source diff、审核、导入导出、七语言预览、发布与回退。
3. 实现自研管理后台的礼物/variant、七语言内容、适用偶像、价格簿、库存流水与上下架。
4. 实现 `/:locale` 粉丝前台 layout、导航、语言切换、首页、偶像目录和偶像详情。
5. 实现七语言礼物详情、偶像选择、政策、加载/空/下架/图片失败/网络失败与事故 fallback/noindex 状态。
6. 完成七语言、currency、SEO、structured data、locale sitemap、self-canonical/hreflang/x-default 和 3/5/8 分钟运营验收。

退出门禁：真实 PostgreSQL seed/fixture 与对象存储媒体驱动所有页面；无硬编码偶像/商品；七语言关键内容批准、路由/切换/SEO/cache 隔离与桌面/移动视觉通过；发布后 60 秒内可见；浏览性能达到预算。

### Phase 4：加购、结账与订单闭环

目标：实现第一个可重复验证的真实购买纵切片。

1. 实现自研 cart、cart item、加密 `support_intent`、presentation/fan-message locale、幂等与并发控制。
2. 实现购物车抽屉/页面、数量、删除、留言编辑和多偶像行隔离。
3. 结账前服务端重新校验偶像、礼物、市场、价格、币种和库存，锁定 cart revision，创建库存预占、`PENDING_PAYMENT` 订单并固化 `presentation_locale`；偶像/礼物/媒体分别保存 `TranslationSnapshotRef`，政策接受保存 policy + translation revision。
4. 实现自研 checkout session、FakePaymentAdapter、首个经批准 PSP adapter、平台→provider locale 映射、支付回跳查询和 `PENDING/UNKNOWN` 体验。
5. 用验签 webhook 或受控 reconcile 推进既有 payment/order，提交或释放 reservation，并实现查单 token 交换、成功页和履约时间线；不得重复创建 P4-03 已生成的订单与快照。
6. 实现按订单固化 locale 的七语言邮件通知、英文事故 fallback 告警、失败重试以及过期 reservation/intent/cart/token 的幂等清理。

退出门禁：沙盒完成选择偶像到查单的完整链路；失败/取消不丢上下文；重复 webhook 不重复订单/通知；敏感留言不进入公共购物车响应、日志、分析或第三方元数据。

### Phase 5：运营、退款与支付扩展边界

目标：让日常运营无需开发者，同时证明未来支付渠道可控扩展。

1. 建立自研 Admin、OIDC 登录、服务端会话、RBAC、CSRF、MFA 要求和审计。
2. 实现订单列表、详情、七语言/低置信度留言人工审核、`PREPARING/DELIVERED` 操作和通知重发。
3. 实现退款、部分退款、取消、拒付和对账工作台。
4. 实现 payment capability、路由、健康熔断和统一 adapter 契约测试。
5. 实现含七语言用户可见名称/提示的支付配置 `draft → validate → publish → rollback` 与 60 秒传播。
6. 实现 webhook 重放、死信、`UNKNOWN` 支付和人工待处理队列。
7. 编写新增 PSP runbook，但首版不为展示能力而接入多余渠道。

退出门禁：最小权限角色不能越权；退款和强制变更均有审计；配置可回退；新 adapter 能只通过 port 接入；既有支付不因渠道开关被改路。

### Phase 6：质量、安全与韧性加固

目标：从“能买”提升到“不会轻易丢单、泄露或失控”。

1. 跑全量单元、i18n 目录、属性、schema、adapter、集成、七语言 E2E、SEO/cache 与视觉回归。
2. 完成七语言 WCAG 2.2 AA 键盘、读屏、缩放、断行和 reduced-motion 验收。
3. 完成按 locale 字体/消息分包、性能预算、图片策略、bundle 和第三方脚本收敛。
4. 完成权限、XSS、CSRF、SSRF、重放、secret、依赖和 PII 检查。
5. 注入网络超时、重复/乱序事件、队列积压和通知失败。
6. 演练数据库恢复、部署回退、配置回退和 webhook 安全重放。

退出门禁：Release Gate 的技术项全部有证据；High/Critical 为 0；无丢单和重复扣款；恢复目标达到第 17 节要求。

### Phase 7：上线准备与渐进发布

目标：用可观测的灰度发布代替一次性全量上线。

1. 冻结正式品牌、经营主体、市场、币种、政策、客服和邮件配置。
2. 导入并复核正式偶像、礼物、七语言翻译、政策/邮件、价格、库存和媒体；缺失、过期和未审核关键翻译为 0。
3. 在 staging 做七语言业务 UAT、语言切换保持、真实小额支付/退款和移动设备验收。
4. 建立 dashboard、告警、值班联系人、客服与事故 runbook。
5. 按内部 → 小流量 → 目标市场逐步放量，实时观察支付和错误指标。
6. 完成上线后 24/72 小时复盘，记录问题与下一轮而不临时扩展范围。

退出门禁：第 18.4 节全部通过；产品负责人、运营、财务和技术负责人签署上线清单；不存在未说明的占位能力。

## 20. Codex / Claude Code 执行协议

任何自动化开发代理进入仓库后必须执行以下顺序：

1. **读取上下文**：完整读取本文件、`docs/progress/MASTER.md`、候选任务所在的 `ACTIVE` phase 文件、任务分解和其直接依赖。
2. **选择单一任务**：只领取一个位于 `ACTIVE` phase、状态为 `READY`、依赖已完成且 Lane 当前无 executor 的 Task ID；在 phase 文件中标记 `IN_PROGRESS`、执行者和开始时间。
3. **复述边界**：在动手前写出本任务的输入、输出、不会修改的区域、验证方法和已知风险。
4. **测试先行**：先写能证明行为的失败测试或验证脚本；纯文档/基础设施任务需要等价的可重复检查。
5. **最小实现**：遵守现有目录和 port；禁止顺手重构无关模块、替换技术栈或扩展产品范围。
6. **分层验证**：先运行受影响单元测试，再运行 lint/typecheck/build，最后执行该任务规定的集成、浏览器或安全验证。
7. **真实界面验证**：任何前台变化必须至少在 390×844 和 1440×900 的真实浏览器中检查；关键流同时做键盘与 reduced-motion 检查。
8. **记录证据**：把命令、结果、截图/日志路径、风险和下一任务写入 phase 文件；不得只写“已完成”。
9. **更新主索引**：只有验收条件全部满足，才把任务标记 `DONE` 并更新 `MASTER.md` 计数；失败则标记 `BLOCKED` 并写清解除条件。
10. **停在边界**：完成当前任务后停止，除非上层明确要求继续执行另一个满足 Phase、依赖和 Lane 门禁的 `READY` 任务。

### 20.1 严禁事项

- 未读规范直接生成整套应用。
- 将参考站的品牌、图片、文案或代码直接复制到生产。
- 以 demo 假数据替代真实 PostgreSQL、对象存储、PSP 沙盒集成并宣布功能完成。
- 在浏览器、日志、队列、截图、fixture 或进度文档中写入真实 secret/完整 PII。
- 为了“全球支付”绕过 PSP、商户主体、税务、KYC、退款或消费者保护规则。
- 引入 Shopify 或其他建站/CMS/商城 SaaS 作为内容、商品、购物车、订单或结账真相源。
- 修改 `PAID`、退款或履约状态而不经过状态机、幂等和审计。
- 使用任意动态代码加载实现支付热插拔。
- 未经用户确认将旧调研中的排行榜、社区、活动、主播后台等加入范围。

### 20.2 并行开发边界

可并行的 lane：

- Lane A：合同、领域、数据库、事件
- Lane B：设计令牌、组件、前台页面
- Lane C：自研 Admin、内容、媒体、商品、价格、库存与运营流程
- Lane D：CI、测试、观测、部署与 runbook

并行前必须先冻结相关合同；每个 Lane 同时最多一个 executor。不同代理不得同时修改同一迁移、同一共享合同或同一视觉令牌文件；需要变更时由合同所有者先合并，再通知消费方同步。`dependency-graph.md` 的同一波次只列不同 Lane、确实可同时领取的任务。

## 21. 上线前决策门

这些不是留给开发代理猜测的变量。未决定时可使用明确标注的 sandbox 默认值搭建，但不得进入对应生产门禁。

| 决策 | 最晚时间 | 未决定时允许 | 未决定时禁止 |
|:--|:--|:--|:--|
| 品牌名、Logo、正式字体与摄影授权 | Phase 2 人工批准前 | 使用本规范默认令牌和内部素材 | 将占位品牌作为正式上线 |
| 生产运行区域、容器平台、PostgreSQL、对象存储、CDN/WAF | Phase 0 退出前 | Docker Compose 与本地兼容服务 | 宣称生产部署/恢复完成 |
| 经营主体、收款国家、银行账户、KYC | Phase 4 真实支付前 | FakePaymentAdapter 与 PSP sandbox | 生产收款或承诺某渠道可用 |
| 管理员身份源、MFA、账号恢复与紧急访问 | Phase 5 管理 UAT 前 | 本地开发身份 adapter | 开放生产管理后台 |
| 首发主语言与 locale 集合 | 已确认 | ADR-006 的 `en/zh-CN/th/vi/ja/es/pt` | 改变 tag/default/fallback 或把语言绑定国家/币种 |
| 首发国家、币种与支付方式 | Phase 3 路由冻结前 | 七语言 + 测试市场/币种/FakePaymentAdapter | 硬编码“全球全覆盖”或根据语言猜测市场/支付方式 |
| 礼物法律属性、税务、退款与拒付政策 | Phase 4 UAT 前 | 草案页面 noindex | 正式结账与收款 |
| 采购/准备/送达 SLA 与客服承诺 | Phase 3 内容冻结前 | 明确写“待确认”的内部 fixture | 对粉丝展示未经批准时效 |
| 偶像授权、肖像、收货与隐私流程 | 导入正式偶像前 | 虚构测试人物 | 上传或公开真实偶像内容 |
| 偶像/粉丝可能涉及未成年人时的年龄、监护授权与留言政策 | 导入正式偶像前 | 不收集生日的测试流程 | 面向未成年人正式运营或传递未经审核留言 |
| 邮件域名、发件人和客服入口 | Phase 4 通知验收前 | 本地捕获邮箱 | 向真实粉丝发送事务邮件 |
| 观测、告警、备份服务供应商 | Phase 6 前 | 接口与本地实现 | 无告警/备份上线 |

所有生产决策写入 `docs/decisions/` 的 ADR 或运营决策记录，包含日期、负责人、依据和回退方案。

## 22. 全局完成定义

一个任务只有同时满足以下条件才是 `DONE`：

- 行为与本规范及 Task ID 的验收条件一致。
- 没有通过硬编码、复制状态或供应商对象泄漏绕过架构边界。
- 新行为有自动测试；关键用户路径有真实浏览器证据。
- format、lint、typecheck、相关测试和 build 成功。
- 视觉变化覆盖桌面、移动、键盘、加载/空/错误和 reduced-motion。
- 数据迁移可重复、可审查并有回退或向前修复方案。
- 日志、分析和 fixture 不含 secret、完整 PII、留言明文或偶像地址。
- 文档、OpenAPI、运行手册和进度索引已同步。
- 剩余风险被明确记录，不以“以后再说”替代阻断条件。

一个 Phase 只有其所有必须任务为 `DONE`、退出门禁有证据且无未解释 blocker 时才完成。代码存在不等于已验证；本地测试通过不等于已上线。

## 23. 依据、参考与变更规则

### 23.1 项目内依据

- `docs/双站调研与类似平台技术架构规划.md`：参考站产品与技术研究；只作背景，不覆盖当前精简范围。
- `research/mxcheer/`、`research/sonnystar/`：参考站浏览器证据。
- `research/tech/`：技术指纹与复现记录。
- `docs/fan-support-platform-architecture.drawio`：全源码自研架构图；其中通用 i18n 边界由本 2.1.0 规范定义，发生冲突时仍以本规范为准。

### 23.2 实现时优先核对的官方资料

- Next.js App Router：<https://nextjs.org/docs/app>
- Next.js 国际化路由：<https://nextjs.org/docs/app/guides/internationalization>
- Next.js 自托管：<https://nextjs.org/docs/app/guides/self-hosting>
- NestJS：<https://docs.nestjs.com/>
- PostgreSQL：<https://www.postgresql.org/docs/current/index.html>
- Drizzle ORM：<https://orm.drizzle.team/docs/overview>
- pg-boss：<https://github.com/timgit/pg-boss>
- Amazon S3 对象存储模型：<https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html>
- OpenID Connect Core：<https://openid.net/specs/openid-connect-core-1_0.html>
- PCI DSS：<https://www.pcisecuritystandards.org/standards/pci-dss/>
- WCAG 2.2：<https://www.w3.org/TR/WCAG22/>
- W3C HTML 语言声明：<https://www.w3.org/International/questions/qa-html-language-declarations>
- W3C 语言标签选择：<https://www.w3.org/International/questions/qa-choosing-language-tags>
- Unicode CLDR：<https://cldr.unicode.org/>
- Google 多区域/多语言版本：<https://developers.google.com/search/docs/specialty/international/localized-versions>
- OpenTelemetry：<https://opentelemetry.io/docs/>
- OWASP ASVS：<https://owasp.org/www-project-application-security-verification-standard/>

框架版本、PSP 资格、支付方式、地区规则和 PCI 要求会变化。执行对应任务时必须以官方当前文档、PSP sandbox/账户后台和真实商户资格为准，并把核验日期写入 phase 证据；不得只依赖本文件中的静态描述。

### 23.3 规范变更

- 修正文案、示例和不改变行为的澄清：patch 版本。
- 增加兼容字段或非破坏性能力：minor 版本，并更新合同测试。
- 改变范围、真相源、状态机、支付边界或删除合同字段：major 版本，必须有 ADR、迁移计划和用户确认。
- 任何变更必须同步 `MASTER.md`、相关 phase、任务依赖、测试和运营手册。
