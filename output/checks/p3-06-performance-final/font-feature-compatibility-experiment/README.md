# 原 Fontsource feature 范围兼容实验

仅生成临时候选。正式生成器、CSS、字体、fallback 与预算均未修改，没有运行 Chrome/Lighthouse。

完整读取原日文 124、中文 101 个 CSS face 的真实字体表，其 GSUB/GPOS feature tag union 与当前 UI 实际参与的 25/15 个分片完全一致。候选生成只把 `layout_features = ["*"]` 改为这些真实原 GSUB 和 GPOS tag 的并集，包含 `kern` 等 GPOS 功能；其余生成选项保持不变。

| Profile            | 字符数 | 原 UI WOFF2 | 候选 WOFF2 |              减少 | 原/候选 glyph 数 |
| ------------------ | -----: | ----------: | ---------: | ----------------: | ---------------: |
| Japanese           |    303 |   125,004 B |   96,956 B | 28,048 B（22.4%） |        546 / 406 |
| Simplified Chinese |    322 |    92,296 B |   84,152 B |   8,144 B（8.8%） |        393 / 329 |

没有补 ASCII，也没有缩减 UI 字符。所有字符在 100/400/900 字重与当前真实 Fontsource 字形的分解轮廓、advance 对照均零差，实际 cmap、可变轴和关键垂直 metrics 检查通过。

两候选的 GSUB 都仅剩 `locl/vert/vrt2`；GPOS 保留该字符集对应的原定位功能，没有超出原 union 的新 tag。`ccmp/liga` 等功能依然包含在生成时的可选集合，若当前字符集没有对应 lookup，FontTools 会裁去空功能；这不是只按 GSUB 筛选或人为删除 kerning。

候选 SHA256：

- Japanese：`925cbc2fb4d52a47759323b4607f3f92b9ad7841d44b2a97f7c069ae100e433a`
- Simplified Chinese：`b717bd33ed6162211eaaef71e0046ea7c4f9b7ba039feef9bbd592405e0be121`

`results.json` 包含全部 225 个原字体的 SHA、feature tag、glyph 数，以及候选的 cmap、字重轮廓和 metrics 证明。`generate-function.py` 保存唯一临时改动后的生成函数，`corpus.json` 保留全部 UI 字符与原 CSS cascade 来源。

这证明了体积收益和上述兼容性检查，不等于任意字符串/feature 配置的 shaping 等价，也不等于真实浏览器 LCP 通过。正式策略修复后仍需对最终字体字节运行真实 Chrome 的文字布局/像素对照和固定性能门。

本轮执行命令：

```sh
.turbo/font-tools-venv/bin/python -B output/checks/p3-06-performance-final/font-feature-compatibility-experiment/experiment.py
```

该命令针对 `results.json` 记录的生成器 SHA，正式生成器策略改变后不会静默假定它仍是同一次实验。
