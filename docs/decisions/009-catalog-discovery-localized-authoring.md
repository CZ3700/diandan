# ADR-009：艺人发现、礼物目录与多语言商品编辑

> 状态：Accepted for implementation — 依据用户 2026-09-05 新需求及继续开发授权
> 日期：2026-09-05
> Owner：项目负责人；工程归档 Codex `/root`
> 关联：规范 2.2.0，P3-01 至 P3-06，R-08/R-14/R-17

## 决定与范围

用户接受 V2 中性黑金视觉作为后续开发基础，装饰动效随后打磨。P2-06/Phase 2 关闭，Phase 3 激活；正式品牌/Logo/字体采用/摄影授权在正式内容导入前且不晚于 P7-01/P7-02 确认。此决定不包含母语审校、实际艺人授权、生产发布或付款能力批准。

产品定位保持“艺人风采展示 + 自研独立电商”。下列要求属于 MVP 内容发现与商品编辑，没有新增社区、排行、推荐算法或外部 CMS。

| 需求 | 基础 | 后台 | 前台 | 综合验收 |
|:--|:--|:--|:--|:--|
| 艺人持续浏览、名字/别名搜索、直接定位 | P3-01 查询与上下文合同 | P3-02 别名管理 | P3-04 原生横滑/分批加载、combobox 与目标窗口 | P3-06 大样本、IME/键盘/读屏、性能 |
| 横竖比例不一照片 | P3-01 构图 recipe、处理与发布校验 | P3-02 焦点/裁切/完整展示、双端预览 | P3-04 响应式人物图 | P3-06 异常素材/慢网 |
| 礼物分页、筛选、金额排序 | P3-01 服务端查询、同价稳定排序 | P3-03 分类/价格/库存 | P3-05 页码/前后页、筛选抽屉、URL 恢复 | P3-06 数据变化/SEO/七语言 |
| 自由编辑商品详情及翻译 | P3-01 受控结构与兼容迁移 | P3-03 编辑、译文审核与预览 | P3-05 多语详情渲染 | P3-06 3/5/8 分钟运营验收 |

## 艺人与礼物发现

艺人横向轨道使用原生滚动/scroll-snap，不复制卡片或自动轮播。接近末端分批读取真实数据，保留明确结束/重试反馈；搜索首版即启用。按已发布本地化姓名、handle、维护别名检索，精确优先于前缀、包含，再按 displayOrder/id 确定顺序。只规范化搜索投影，不去掉泰语或越南语原文附标。先用 PostgreSQL 索引与参数化查询，规模增长后依据测量决定是否需要 pg_trgm；不先引入独立搜索服务。

搜索返回稳定 ID，选择后直接读取包含目标的窗口，避免先下载前面几百张照片。cursor 绑定目录版本和查询，变更/过期需重载；前台处理竞态，只采用最新请求。IME 合成期间不抢查；键盘选择与屏幕阅读器语义遵循 [WAI Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)；横向浏览保留 [WAI Carousel](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/) 所要求的用户控制原则，但不滥加轮播语义到普通列表。

礼物采用服务端页码分页，每页默认 12、最多 48，offset 设置合理边界（首版最多 1000 页；超过时保留总数并以 paginationLimited 提示缩小筛选，上限处无下一页）；普通目录拥有实际 URL/链接，筛选与排序变化回第一页，语言变化保持查询/艺人/交易上下文。推荐首版定义为已发布时间倒序加 ID，价格排序采用同一 market/currency 中可售、可送达规格的最低价；价格区间沿用同一口径，售罄无价项置后，不用浏览器汇率或格式化字符串排序。相同数据版本保证顺序确定；发布/价格/库存变化会改变目录，不能承诺跨版本绝不位移。依据 [PostgreSQL LIMIT/OFFSET](https://www.postgresql.org/docs/current/queries-limit.html) 保留唯一排序，并在数据规模增长时实测 offset 成本。

各基础页 self-canonical，前后页使用 `<a href>`；搜索/任意筛选/替代排序 noindex，避免重复索引。遵循 [Google 电商分页指南](https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading)，不把所有页 canonical 指向第一页。

## 媒体与详情内容

原图私有保存，解码并校正方向后按用途处理。4:5 人物、16:9 桌面 Hero、4:5 手机 Hero、1:1 礼物使用明确 master 画布。COVER 围绕焦点裁切，CONTAIN 保留整图并加固定中性衬底；不拉伸、不静默放大。独立双端 Hero 仍需逐张确认。recipe 绑定 source checksum、asset、metadata revision，公开 `picture/srcset` 使用可追溯衍生图；[MDN picture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/picture) 支持按视口选不同构图。

英文统一作为源稿，粉丝按自己的语言阅读完整的审核译文。运营自由填写文字和图片，页面结构限制在标题/段落/列表/规格/媒体块；不允许任意 HTML/CSS/脚本。结构和媒体引用属于 gift revision，文本属于礼物专属 translation rows，通过稳定 block/item ID 配对，不做万能 JSON 翻译表。机器辅助只能生成草稿，继续采用现有独立审核、source hash/stale、七语言整体发布/回退。价格/库存/适用艺人与所有语言共享，不能藏在文案中成为业务来源。

## 兼容与交付纪律

新增能力采用独立 schemaVersion 1 roots；现有 v1 gift.description 的含义及 hash 不变。新图文结构、角色构图必须先有合同测试，再通过 additive migration、旧数据/新数据 fixtures、导入、公开投影、审核与发布门接入。现有 `media-qualification` 严格原图比例门在迁移和真实产物校验完成前保留，不仅删除检查或加 object-fit。构图规划通过不代表图片已处理。

P3-01 当前缺少实际内容 repository/API、preview/session 接线及 content purge consumer，需分检查点实现；不得以本次新增合同代替完整 P3-01 的退出证据。数据库/OIDC/图片处理/purge 的待完成列表见实施计划；本轮不进行 AWS/Akamai、staging 或 production 操作。

官方资料核验日期：2026-09-05；以上是结合本仓库约束的设计决定，不是“世界最先进”的排名或未经验证的性能承诺。
