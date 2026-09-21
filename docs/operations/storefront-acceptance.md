# 浏览前台验收与 SEO 运行手册

任务：P3-06。当前工作记录和实际通过范围以 `docs/progress/phase-3-storefront.md`、`output/checks/p3-06-storefront-acceptance/` 为准。测试环境可索引元数据的校验，不代表允许 TEST 站点被搜索引擎收录。

## 页面身份与翻译

- 正常可索引页面使用自己的 locale canonical；互返语言和 `x-default` 来自同一真实 publication 及对应原文/translation revision。没有凭语言数组伪造某实体已发布的翻译。§9.0/ADR-012 的日常内容可直接发布原文；没有目标译文时保留原文 `lang`，相应非原文详情页 `noindex`，不进入该语言 sitemap/alternate。
- 纯内容礼物详情可以没有地区和价格；指定有效 market/currency 后，价格及 Product/Offer 来自当前真实商品、规格和价格读取。语言不推导地区或币种，结构化数据不虚构库存数量、评分或评价。
- 普通礼物分页每页 self-canonical；默认页码/排序归一化。搜索、筛选、非默认排序、艺人定位、收礼人、无效/重复/未知参数不进入可索引 alternate cluster。私密参数不进入 canonical、OG 或 JSON-LD。
- 事故 fallback 或前后读取的 publication 不一致时，metadata 关闭索引资格。严格发布模式仍要求完整七语证明，日常直接发布使用真实原文证明；不能为了模拟事故而削弱任一模式的发布门。正式 UI 翻译批准仍由真实 review manifest 控制，TEST 的全站 noindex 不应复制为生产配置。

## Sitemap

`/sitemap.xml` 是所有 locale/分片的索引；`/:locale/sitemap.xml` 是该语言的索引；其真实 INDEX 游标指向最多 20 个实体的 URL set。根索引按最多 50 个分片描述符一批读完 CATALOG，不加载整站详情后再任意截断。

游标绑定目录版本，发布、更名、归档或授权状态变化会使旧目录失效。409 应重新从根索引读取；503 是当前证明或数据不可用，不能改写成成功的空站点地图。旧 handle 不进入新 sitemap。`lastmod` 采用内容/翻译 publication 时间，不使用请求时钟。

CATALOG 的轻量扫描仍随目录和历史规模增长；每个 INDEX 的内容加载有上限，不代表整个 SQL 工作量恒定。需在 production-like staging 用正式规模继续测量。

## 公共缓存与私有边界

成功的公开 JSON 读取及 sitemap XML 使用 ETag 与 `public, max-age=0, s-maxage=0, must-revalidate`。每次条件请求先执行完整当前读取、发布证明和响应 schema/scope 检查，再决定是否返回无正文的 304。JSON 标签包含固定资源名称、规范化查询 scope 和完整响应，空结果也隔离 locale/market/currency。

Cookie 或 Authorization 请求使用 `private, no-store`，不返回 ETag/304；失败仍 no-store。Next HTML/RSC 和 storefront BFF 读取保留 no-store。本轮没有开放正数 TTL，也没有声称减少了源站证明计算量。

发布 Outbox/purge 保留原 locale 页面路径，并扩展根/locale sitemap（含游标）及 SEO API。0021 迁移兼容旧、新精确路径集合；重试保留原任务路径，不允许扩大范围。回退应用前停止新路径写入，迁移 down 后旧新任务可按原路径处理，但不能继续创建新格式 root job。

真实 CDN 验收仍需确认 min TTL 为 0、完整规范化 scope、Cookie/Auth bypass、RSC/HTML 区分，以及常规公共 DTO 的对应失效映射。当前常规 DTO 依靠每次 origin revalidation 保证不会在 TTL 内遮蔽变化，不能宣称这些 API 已有独立精确 CDN purge 证据。

## 本地复跑

```sh
mise exec node@24.20.0 -- corepack pnpm check
mise exec node@24.20.0 -- corepack pnpm verify:storefront-acceptance:browser
mise exec node@24.20.0 -- corepack pnpm verify:storefront-acceptance:performance
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api preview:storefront-acceptance
```

这些命令使用真实临时 PostgreSQL、TLS S3、媒体 worker、受审 TEST 发布和编译后的 Next。完整浏览器覆盖七语、390×844/1440×900、120 艺人与分页礼物、SEO、键盘/IME、错误和 reduced motion。性能运行与编译/其他压力测试串行；保留全部三次移动 Lighthouse 原报告及每组中位数、最小/最大值，不能挑最好一次。

资源字节在首次导航、不滚动、不强制 eager 前采集；图片检查截图和资源预算使用不同步骤。测试图片与正式摄影不同，实验室 LCP/CLS 和 Lighthouse 不能代替真实用户 p75、INP、RUM 或新真机结论。

## 人工验收

使用当前[单一管理中心](management-center.md)做真人操作验收，避免与性能采集并行：

```sh
mise exec node@24.20.0 -- corepack pnpm preview:management-center
```

命令先执行现有自动回归，再打开一个已授权的 TEST 管理中心窗口；环境准备人等待 `MANAGEMENT_READY` 后再开始真人操作，自动回归时长不计作真人验收。提前提供有权使用的测试照片、名字、描述与售价。测试礼物由操作人现场创建，不能拿自动回归已经建好的对象冒充完成。该环境临时，停止命令后清理，单独关闭浏览器窗口不会立即停止环境；不上传需要长期保存的正式内容。TEST 会话不代表正式 OIDC/MFA 上线验收。

接受一次培训的非开发人员在同一个管理中心完成：

| 操作 | 计时目标 | 完成条件 |
| :-- | :-- | :-- |
| 更换首页海报 | ≤3 分钟 | 上传一张图并替换，等待发布完成，刷新前台确认。历史恢复另作独立功能场景，不计入本项计时。 |
| 更新艺人照片与简介 | ≤5 分钟 | 打开艺人，上传照片、填写名字与描述并提交，前台读回新内容。 |
| 新增礼物 | ≤8 分钟 | 上传图片，填写名称、描述、价格、分类与礼物类型并提交；前台显示正确内容、价格及可售状态。 |

计时从操作人开始该项界面操作起，直到前台读回确认；上传、处理、保存、发布等待和必要重试计入。素材撰写与培训不计入，但必须记录准备范围。默认按单准备不要求填写虚构库存；限量库存作为独立补充场景。日常描述用实际录入语言直接发布，不要求七语导入、多角色切换或独立译审；政策、支付、订单和邮件仍保留严格译审门。

每项记录操作者、日期、源码提交、运行目录、开始/结束时间、耗时、是否需协助、实际成功回执和前台读回证据，结果填 PASS/FAIL/PENDING；有见证者时可一并记录，不要求另找第二个人。截图只含授权测试内容；不记录会话凭据或粉丝私密资料。由真实操作者确认并保留可复核证据，代理不能代签或从自动回归生成真人 PASS。

`storefront-operations-uat.mjs` 与旧 `operations-uat-README.md` 仅保留为旧严格内容工作台的历史验收工具，不再作为默认日常操作门。实际 VoiceOver/NVDA 的朗读、搜索提示、焦点和恢复另留可核验记录；axe/DOM 检查不能替代读屏实测。
