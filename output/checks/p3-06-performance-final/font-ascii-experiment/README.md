# 临时可打印 ASCII 对照

本目录仅为开发实验，未修改正式生成器、CSS、字体、fallback 或预算，也未运行 Chrome/Lighthouse。输入是现有锁定 TTF、FontTools 4.64.0/Brotli 1.2.0，沿当前生成器的全部 layout feature 选择策略。

候选字符集为全部当前日文/中文 storefront 静态词库与 `U+0020–007E` 的并集，未选择夹具商品名或价格。两个原词库各含 19 个可打印 ASCII 字符，候选各补 76 个。ASCII 包含 `$`，不包含 `€`、`¥`、全角货币符号等非 ASCII 字符；其他文字仍需原 fallback。

| Profile            | 当前 UI WOFF2 |  临时候选 |      增长 | 可被替代的原 Latin WOFF2 | UI + ASCII 模型总 body 变化 |
| ------------------ | ------------: | --------: | --------: | -----------------------: | --------------------------: |
| Japanese           |     125,004 B | 165,020 B | +40,016 B |                 24,840 B |                   +15,176 B |
| Simplified Chinese |      92,296 B | 132,384 B | +40,088 B |                 25,240 B |                   +14,848 B |

CSS 模型中，完整词库加可打印 ASCII 可从两个资源变为一个，但总字体 body 反而增大。表中是本地 WOFF2 文件实际字节，未把 HTTP header/网络调度或请求数收益推算为真实 LCP。当前结果不支持将此候选直接纳入产品。

`results.json` 保存来源、SHA、实际 cmap、100/400/900 字重的轮廓与 advance 对照、垂直 metrics、轴信息。两份候选全部字符在这些对照上零差；这不等于任意字符串 shaping 或浏览器性能证明。

## 与原 Fontsource features 的实际差异

`feature-comparison.json` 逐一检查正式 manifest 列出的日文 25/中文 15 个原 Fontsource 分片，包含原 Latin；每个参与文件均重新核对 SHA。原参与分片的 GSUB feature union 都是 `ccmp/liga/locl/vert/vrt2`。当前 UI 子集额外保留：

- 日文：`aalt/dlig/fwid/hwid/jp78/jp83/pwid`。
- 中文：`aalt/dlig/fwid/hwid/pwid`。

当前 UI 与 ASCII 候选均没有超出原 union 的 GPOS feature tag。原 Latin 分片各映射 218 个码点，日文 255 glyph、中文 256 glyph。当前 UI 字体为 546/393 glyph；ASCII 候选为 942/795 glyph。新增 76 个码点时，所保留的 glyph 因 lookup/closure 扩大了 396/402 个。

`table-deltas.json` 显示主要解码表增长来自 `glyf`、`gvar`，另有 GPOS/GSUB 增量。解码表大小不等于 WOFF2 传输大小，feature tag 相同也不等于 lookup/字形/字符串布局等价。因此这里只记录真实差异，没有直接删除 feature，亦未声称某一个 tag 单独造成全部体积增长。

可重跑临时生成与只读 feature 对照：

```sh
.turbo/font-tools-venv/bin/python -B output/checks/p3-06-performance-final/font-ascii-experiment/experiment.py
.turbo/font-tools-venv/bin/python -B output/checks/p3-06-performance-final/font-ascii-experiment/inspect-features.py
```

`corpus.json` 是本次全词库与 ASCII 并集及原 CSS cascade 选中字形来源的固定输入。目录中的 `candidate/` 为实验产物，不供网站加载。
