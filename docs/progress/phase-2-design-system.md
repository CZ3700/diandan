# Phase 2 — 设计系统与交互样板

> 状态：LOCKED  
> 任务：6  
> 解锁条件：Phase 0 退出门禁通过；与 Phase 1 同时激活

## 目标

用真实响应式界面证明“电影感偶像画册 × 精品零售 × 可信支付”的视觉和交互语言，然后再扩展页面。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P2-01 | PENDING | — | P0-04 | Tokens/分 locale 字体/type/grid/theme |
| P2-02 | PENDING | — | P2-01 | 基础原语 |
| P2-03 | PENDING | — | P2-02 | Overlay/menu/toast/language-region/focus |
| P2-04 | PENDING | — | P2-02 | 七语言长文案组合组件与状态 |
| P2-05 | PENDING | — | P2-03、P2-04 | 三段标志性动效 |
| P2-06 | PENDING | — | P2-04、P2-05 | 人工品牌样板批准 |

## 必须证明

- 390×844 与 1440×900 人工视觉批准，六个标准视口无破版。
- 所有交互有键盘和 reduced-motion 等价状态。
- axe critical/serious 为 0；真实移动设备无明显卡顿。
- 正式品牌/摄影未确认时，只使用有权使用的内部素材和默认 tokens。
- Latin/Vietnamese/SC/JP/Thai 字体按 locale 分包；CJK/Thai/Vietnamese/长西葡语与 pseudo-locale 在 320/390/1440、200% zoom 下无裁切，语言切换保持 route/cart/market/currency。

## Phase 退出证据

尚未解锁。
