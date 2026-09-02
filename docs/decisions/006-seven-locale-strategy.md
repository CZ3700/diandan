# ADR-006：英文主语言与七语言 URL/内容策略

> 状态：Accepted  
> 日期：2026-09-02  
> 决策者：用户明确指定英文为主语言，并要求简体中文、泰语、越南语、日语、西班牙语和葡萄牙语切换  
> 关联：P0-01、P0-03、P1-01、P1-02、P1-04、P2-01、P2-03、P3-01～P3-06、P4-01～P4-06、P6-01～P6-03、P7-01～P7-03；R-08、R-13、R-14、R-17

## 背景

平台面向全球粉丝，必须提供稳定、可索引、可审核且不会影响价格/支付的语言切换。旧基线只明确保证 `en + zh-CN`，其余语言停留在“以后可扩展”，不足以指导路由、数据库、Admin、订单快照、邮件、SEO、缓存和发布验收。

语言并不等于经营市场：使用葡萄牙语的粉丝可能处于日本市场并使用 JPY；PSP 托管界面是否支持某语言，也不能反向决定订单价格或支付路由。

## 决策

1. `SupportedLocale` 固定为 `en | zh-CN | th | vi | ja | es | pt`。`en` 是默认语言、内容源语言和最终事故 fallback；七种语言均为 MVP 首发公开 locale。其 Zod schema、TypeScript type、ordered values/default/native names 只由 `packages/contracts` 拥有，`packages/i18n`、config、apps 与 adapters 必须导入而不得复制。
2. `es`、`pt` 首版分别表示经人工审校的中性西班牙语与中性葡萄牙语，不代表某一国家。未来需要 `es-MX`、`pt-BR`、`pt-PT` 等时新增 BCP 47 locale，不静默改变现有 tag 的含义。
3. 所有 storefront HTML 页面使用 `/{locale}/...`，handle 在七语言间保持一致；API/webhook/Admin API 不加 locale 路径。`/` 不承载可索引页面：有效 `site_locale` cookie 存在时临时跳转到对应语言，否则跳转 `/en`；`Accept-Language` 只用于首次访问的非阻断建议。
4. URL 中显式 locale 优先于 cookie。语言切换只改变 presentation locale，保持同一页面/实体、购物车、checkout/payment attempt、market、currency 和价格；非法 locale 返回 404。
5. 静态 UI、错误与校验消息采用源码内类型化 ICU 目录；偶像、礼物、首页、政策、SEO 和媒体本地化元数据采用 PostgreSQL 显式 revision translation 表。禁止万能 JSON 翻译表和外部 CMS。
6. 英文源变化通过 source hash 标记相关译文过期；机器翻译/批量导入只生成草稿。首发七语言的 `CRITICAL + REQUIRED` 字段必须完整且人工批准，发布/回滚以完整七语言 revision 为原子单位。
7. 英文 fallback 只用于事故保护。动态对象异常缺译时整对象回退并记录 requested/resolved locale；对应目标语言页 noindex 且从 sitemap 移除，并从该实体所有其他语言页的 hreflang alternate cluster 双向移除失败 locale。checkout、政策、支付/退款/状态和事务邮件缺译时阻止整个七语言 revision 或该 locale 启用配置发布，禁止单语言 published pointer；邮件运行时 fallback 必须告警。
8. 订单、政策接受、支付适配与通知固化 requested/resolved/provider locale、template/content revision 和用户实际看到的本地化快照；历史订单不随实时翻译变化。
9. 正常发布态中，每个已发布翻译页 self-canonical，并输出互返且含自身的七语言 hreflang 与 `x-default` 英文 URL；事故态按第 7 条缩减整个实体的 alternate cluster。sitemap、缓存、ETag、发布 outbox/purge 均按 locale 隔离；涉及可售性/价格时缓存另含 market/currency。
10. Locale、Market、Country、Currency 与 PaymentCapability 是独立合同。PSP adapter 可以把不支持的语言映射到英文托管 UI并记录 fallback，但不得因此改变金额、币种、市场、路由或订单 locale。

## 考虑的方案

| 方案 | 优点 | 缺点/风险 | 结论 |
|:--|:--|:--|:--|
| 只保证 `en/zh-CN`，其余以后再加 | 首期工作少 | 路由、schema、字体、SEO、邮件会返工；不满足需求 | 拒绝 |
| 一个无前缀默认语言，其余加前缀 | 英文 URL 更短 | 路由与 canonical 分支增多，切换/缓存容易出错 | 拒绝 |
| 七语言全部显式前缀，英文为默认/源语言 | URL 对称，合同与缓存明确，易扩展 | 首期翻译与 QA 工作增加 | 选择 |
| 按 IP/国家自动强制语言与币种 | 首次访问看似本地化 | 错判、无法分享稳定 URL，并把语言和商业规则耦合 | 拒绝 |
| 缺译长期静默回退英文 | 上线快 | 形成混合语言页面，法律/支付风险高，SEO 重复 | 拒绝 |

## 后果

- 不改变全源码自研模块化单体与 48 个任务拓扑，但 i18n 从 Phase 0/1 贯穿设计、内容、交易、测试与上线，不得全部推迟到 P3-06。
- Admin 需要英文源栏、七语言完成度、source diff、审核/批准、导入导出、预览和发布阻断；已有译文可在源字段未变化时安全复制到新 revision。
- 需要 Thai/CJK/Vietnamese/Latin Extended 分包字体，以及文本膨胀、断行、`html lang`、键盘和 reduced-motion 浏览器证据。
- 运营的 3/5/8 分钟目标只衡量结构化编辑、导入、预览和发布，不把人工完成七语言翻译时间计入。
- 所有七语言内容在首发前均需人工审校；这增加内容运营工作量，但避免把 fallback 误当正式支持。

## 验证与回退

- 合同/CI：`SupportedLocale` 精确等于七个 tag；七语言消息 key、ICU 参数和 plural/select 分支一致；任一关键译文缺失/过期时发布失败。
- 浏览器：七语言各完成核心浏览→购物车→checkout→查单/邮件路径；切换保留实体、cart、market、currency 和 attempt；390×844 与 1440×900 无裁切。
- SEO/缓存：self-canonical、互返 hreflang、`x-default`、locale sitemap、fallback noindex 与 locale-aware cache snapshot 全部通过。
- 数据：订单/通知/政策接受保留 locale 与 revision；发布/回滚不会分别漂移某个语言。
- 回退只允许发布前一套仍满足七语言完整度的 revision 或回退应用部署；不能删除 locale、改 tag 或在生产静默变更 `es/pt` 口径。若某 locale 出现严重法律/内容事故，可通过受审计配置临时下线该 locale 并让其 URL 返回维护/noindex，但恢复前必须重新完成翻译审核，不得长期伪装为英文页面。
