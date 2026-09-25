# 公开首页、艺人与礼物浏览

本入口覆盖 P3-04/P3-05：七语言首页、连续艺人目录和姓名搜索、礼物分页与筛选、规格详情、艺人选择、地区币种及已发布政策。完整 SEO、历史 handle 重定向、正式运营计时与性能门属于 P3-06；购买与私密留言归 Phase 4，当前浏览页明确提示下单未开放。

## 配置与运行

使用仓库固定的 Node / pnpm，通过 `mise exec node@24.20.0 -- corepack pnpm` 运行。公开 HTML 使用 `/:locale`，根路径按有效 `site_locale` cookie 或英文默认值跳转；它不选择市场、币种或支付方式。

- `FAN_SUPPORT_STOREFRONT_NAME`：显式站名；没有正式品牌默认值，`.env.example` 只提供 TEST 名称。
- `FAN_SUPPORT_INTERNAL_API_ORIGIN`：既有内部 API 配置；服务端只请求固定公开内容路由，不转发浏览器 Cookie 或 Authorization。
- `FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN`：精确 HTTPS 图片 origin，也是 **Next 构建输入**。切换媒体域名/端口须重建部署产物，不能仅重启旧产物。
- `FAN_SUPPORT_DEPLOYMENT_ENV` / `NODE_ENV`：必须符合既有配置组合。TEST 可以读取草稿界面译文；production 必须通过人工审核清单和实际文案 hash 检查。

可重复入口：

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:storefront
mise exec node@24.20.0 -- corepack pnpm verify:storefront:browser
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api preview:storefront
```

第一条使用临时 PostgreSQL、TLS S3-compatible 服务、真实图片 worker 与管理/公开 API。第二条另构建 Next 并用 Chrome 验证前台；这是本地 TEST 服务上的编译产物验证，不是 staging 或 production 发布。预览命令输出当轮 URL，进程结束后临时服务与数据销毁；不要把随机端口写入站点配置或文档。

## 内容读取与定位

首页从一个 SERIALIZABLE 只读事务取得当前发布首页及其明确引用的艺人/礼物。稳定 ID 经 PostgreSQL 转为当前 handle；严格验证七语言发布和媒体证明。Hero 必需对象不可用时整页显示恢复状态，其他失效推荐保留明确不可用状态，不换成其他艺人。首页没有选定市场时不展示猜测价格。

艺人目录首批 12 项，之后按服务器 cursor 分批横向加载；搜索提供最多 6 项建议，采用已发布姓名、别名和 handle。选中建议后按稳定 ID 加载对应目录窗口，定位并聚焦其详情链接。游标绑定 locale、查询与目录版本，目录更新会提示重新加载。暂停收礼艺人仍可查看详情。

`anchorId` 保存在 URL，搜索定位、详情链接及返回目录保留它；从头浏览移除它。语言切换保留等价路由、查询和 hash，不改变商业上下文。重复或不合法 anchor 明确报错，不静默换成首位艺人。数据库内部 ID 用于公开目录中的稳定实体关联，不含内部地址。

首页/详情关键内容服务端渲染，字体按五类脚本路由分包。发布读取使用 `no-store`，新发布不依赖浏览器保留的旧卡片；追加目录请求仍验证当前发布版本。生产 canonical、hreflang、sitemap 与历史 slug 重定向统一在 P3-06 验收。

首页和目录在页面内部提供加载状态；艺人详情先确认实体存在，再开始输出页面。不要在这些公共路由的共同祖先重新加入 `loading.tsx`，否则不存在的艺人可能在已发出的 HTTP 200 流中显示 404 文案。当前七语言不存在艺人及未知语言均已验证真实 HTTP 404。

## 图片与语言

媒体只来自已有 READY、已授权且绑定发布版本的衍生物。手机和桌面 Hero 各有独立构图，卡片统一容器并使用焦点裁切，图库保留原比例。Next image 是可重建投影，不写业务数据库；`srcset` 候选不超过发布源图宽度。

图片优化器仅允许配置 origin 下的 `/processed/v1/*/*.avif|webp|jpg`，禁止任意本地路径、查询参数、重定向和 SVG。只有显式 development/test 允许测试回环地址。缓存最小 TTL 为 60 秒，实际可受上游更长 Cache-Control 影响；新不可变媒体 URL 可立即被新发布引用，但撤销已经公开图片的 CDN/浏览器缓存仍需正式 purge 运行手册和部署证据，不能声称瞬时抹除已下载字节。

界面译文在 `packages/i18n/src/storefront/`，英语为源，七份 review manifest 当前维持 DRAFT。正式读取须验证源文和请求译文的实际 SHA-256、APPROVED、审核人及完整提交引用；不能填入合成审核人来打开门。动态艺人/首页/礼物文案继续使用数据库七语言独立审核与原子发布，不从界面字典或机器临时翻译补齐。

正常发布要求全部七语言证明完整，缺失/损坏返回不可用。客户端可防御性识别合同允许的英文 fallback provenance，标明动态文字语言并禁止索引；不在 503 后自动请求英文，也不降低发布门来制造 fallback 成功。

## 测试证据与排障

证据入口：`output/checks/p3-04-storefront/README.md` 和 `output/playwright/p3-04-storefront/`。大目录使用 120 个明确 TEST 身份；两组原创双端照片在这些身份间重复使用，仅用于目录规模测试。低像素原图嵌入中性测试画布，原始像素未上采样，画布、来源 hash 与几何检查记录在媒体证据中。这些数据不代表真实艺人、正式摄影或正式语言批准。

图片失败优先检查构建时 origin、TLS 信任、发布衍生路径和真实字节；保留可访问的媒体错误状态，不回退到无授权源图。内容失败检查公开 API 的固定错误码与 request ID，禁止把数据库凭据、私密留言、完整署名或艺人地址写进日志/截图。

管理目录的因果事件时间由稳定事务时间与本次必要授权/历史下限决定；会话、MFA、权限和到期仍实时验证。确定性 PostgreSQL 回归在 `packages/persistence-postgres/scripts/postgres-admin-catalog-time.mjs`，纳入正常数据库集成门；不要通过忽略提交错误或重试成功来隐藏此类故障。


## 礼物目录、详情与地区币种

`/:locale/gifts` 及艺人详情中的礼物目录使用相同服务器分页：默认 12，最多 48，页码最多 1000。页数/总数来自同一数据库快照，越界页保持实际空页并提供返回入口。排序为推荐、价格升序、价格降序；类别、金额、可售状态和页码保存在 URL。筛选或排序变更重置第一页，浏览器后退/刷新恢复已应用条件。金额输入按当前币种精度解析为整数最小单位，不用浮点乘法求值。

语言和 `market/currency` 分开。没有明确商业上下文时显示数据库提供的可选组合，不根据语言、IP 或测试国家猜测价格。`GET /api/v1/storefront-context` 只投影当前有效市场/币种与已发布政策 key/kind。市场显示的是已配置代码，不把代码擅自解释成国家。切换币种清除旧金额筛选；语言切换保留艺人、规格、商业上下文及查询。

目录起价取当前市场/币种、有效发布、适用艺人及可售规格的最低价。无可售规格时目录无价格；不可用状态仍可查看。详情使用 `GET /api/v1/storefront-gifts/:handle`，将内容与逐规格价格、库存和艺人证明放在同一 SERIALIZABLE 读取中；半开有效期使用 PostgreSQL 微秒时间。未指定规格时选择最低可用价规格，显式规格失效不静默换成别的。选艺人支持搜索与继续加载，暂停收礼艺人在列表和搜索中均不可选。艺人的 UUID、规格和市场选择使用公开导航参数，艺人地址从不返回前台。

礼物分类和库存策略独立：

- `TRACKED`：展示当前一个可履约位置能够提供的实际数量；数量上限不能把多个仓位相加。0 表示售罄。未设定营销性质的“低库存”阈值，有限数量直接显示实数。
- `PROCURE_ON_DEMAND`：付款后由工作室采购或准备，不依赖现货；不创造大库存余额。界面数量边界复用商业命令的安全整数上限，并不表示现货数量。
- `PREORDER`：展示预售及发布的预计转交区间，付款后由工作室按商品说明准备。

虚拟、实体、心愿、周边和其他礼物都按工作室转交艺人的语义展示；分类不触发自动送达、余额或众筹行为。这里的价格和数量是浏览信息；本阶段不创建购物车、预占或支付，不收集私密留言。Phase 4 必须再次在服务器校验交易条件。

## 商品文案与政策

礼物名称、说明、履约文本和受控详情块来自已审核发布版本。英语是源稿，六语言各自审核，英语变化使旧译文失效；继续使用后台已有七语言原子发布流程。受控详情支持标题、段落、列表、规格与经验证媒体，不执行任意作者 HTML/CSS/脚本。礼物图片保留原颜色，目录和主图完整 contain，图库和详情媒体保留原比例。

政策链接取实际发布的 key/kind，正文使用当前 locale 的真实已发布内容。关键政策缺失、失败或 fallback 时显示不可用，不回退英文正文；页面禁止索引。浏览页的基础 self-canonical 单独筛选公开页面参数，购物车、支付 attempt 和追踪参数不会进入 canonical。完整 SEO 与上线文案批准仍由后续门禁处理。

## P3-05 可重复验收和预览

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:gift-storefront
mise exec node@24.20.0 -- corepack pnpm verify:gift-storefront:browser
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api preview:gift-storefront
```

默认模式运行真实 PostgreSQL/API/TLS S3/图片 worker 与协议矩阵；浏览器模式再编译 Next 并验证 Chrome。预览打印当轮 URL 和 owner PID，进程退出后临时服务销毁。`SIGUSR1` 重建当前预览并运行完整 UI，`SIGHUP` 重建并运行短 smoke，`SIGUSR2` 仅暂停该预览的 Next，`SIGTERM` 清理整套临时服务。运行共享组件/动效或全仓构建前先暂停预览 Next，避免两个构建同时写 `.next`。

新证据写入 `output/checks/p3-05-gift-storefront/`、`output/playwright/p3-05-gift-storefront/`，每次浏览器尝试独立存储。夹具为 27 个礼物身份（25 可见）、3 个艺人、2 个 TEST 市场/币种和 4 项测试政策；重复图片与名称用于规模和状态验证，不代表正式商品、真实艺人或人工译审批准。`PRICE_UNAVAILABLE` 分支有领域/SSR 测试；当前真实协议夹具包含实际价格，不能声称该分支被真实 HTTP 穷尽。

真实 PG 联调曾发现 `array_agg(currency_code)` 的 DOMAIN 数组被 node-pg 读为字符串。聚合 `currency::text` 后返回可验证数组；保留正常业务谓词并通过新真实 context 协议回归。探针入口为 `output/checks/p3-05-gift-storefront/domain-array-probe.mjs`。不要放宽 schema 或把解析失败改为空地区列表。

根 `pnpm check` 的历史 storefront 协议会写 P3-04 固定 `http-results.json`。本轮先用 `protect-regression.py backup` 保存原字节，检查后用 `restore` 将新回归结果归档 P3-05/regression 并恢复 P3-04；脚本校验原 hash，拒绝覆盖现有备份。不要用破坏性 Git 操作覆盖旧证据。原始 `.log` 保留本地，提交选择源码、文档和结构化结果，避免强行跟踪被忽略的日志。

## 首页直接看礼物（ADR-017）

首页艺人下方自动读取已发布礼物，管理中心上架后无需另设首页推荐位。初访无需选地区即可看图片、名称、简介，使用分类和分页寻找礼物；点入详情后再确认地区与币种来查看价格和选购。已有地区/币种/艺人选择会随链接保留。

数据来自只读 `/api/v1/gift-browse`，默认每页12、最多48件。它不提供报价或承诺可购，不创建购物车；正式价格、库存和可用性仍由既有市场目录和服务端加购/结账重验决定。

七语言、键盘、窄屏与真实缩放的重复验收入口见 [可访问性本地验收](./accessibility.md)。
