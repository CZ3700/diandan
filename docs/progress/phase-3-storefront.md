# Phase 3 — 自研 Admin、内容与浏览前台

> 状态：LOCKED  
> 任务：6  
> 解锁条件：Phase 1 与 Phase 2 退出门禁均通过

## 目标

让运营通过自研 Admin 管理首页、偶像、媒体、礼物、七语言翻译、价格和库存；让粉丝以英语为主语言并可切换简体中文、泰语、越南语、日语、西班牙语和葡萄牙语完整浏览首页、偶像与礼物。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P3-01 | PENDING | — | P1-02、P1-04、P1-05、P1-06 | Locale-aware content/media/publish API + preview/cache/outbox |
| P3-02 | PENDING | — | P2-03、P3-01 | Admin 首页/偶像/媒体/翻译矩阵/审核 UI |
| P3-03 | PENDING | — | P2-03、P3-01 | Admin 七语言礼物/价格/库存 UI |
| P3-04 | PENDING | — | P2-06、P3-01 | `/:locale` Storefront shell/语言切换/首页/偶像 |
| P3-05 | PENDING | — | P2-04、P3-01、P3-04 | 七语言礼物/选择偶像/政策/fallback/错误状态 |
| P3-06 | PENDING | — | P3-02/03/04/05 | 七语言 i18n/SEO/cache/运营/性能验收 |

## 必须证明

- 页面由真实 PostgreSQL seed/fixture 和对象存储媒体驱动，无硬编码正式偶像或礼物。
- 内容发布后 60 秒内前台可见，失败有状态和重试。
- `en/zh-CN/th/vi/ja/es/pt`、self-canonical/hreflang/x-default/locale sitemap、locale cache、图片裁切、空/错/暂停/售罄/fallback-noindex 状态完整。
- 运营达到 3/5/8 分钟更新目标。
- 七语言关键译文批准、缺失/过期为 0；语言切换保留同一实体、购物车、market、currency 和支付上下文。

## Phase 退出证据

尚未解锁。
