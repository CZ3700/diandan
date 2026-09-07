# 公开首页与艺人浏览

本入口覆盖 P3-04：公开七语言首页、导航、连续艺人目录、名字搜索定位及艺人详情。礼物完整分页/筛选/详情和政策正文属于 P3-05；SEO、历史 handle 重定向、正式运营计时与完整性能门属于 P3-06。当前预留交易页明确展示准备中，不能下单。

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
