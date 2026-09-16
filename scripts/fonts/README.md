# 常用界面字形子集

只把完整的日文/中文 storefront 静态词库聚合到各一个 WOFF2。各字体 profile 先引入生成的 fallback CSS，再引入相同 family 的 UI 字体；fallback 的每个原 Fontsource 分片只从 unicode-range 中减去完整 UI 词库字符，使两者范围互斥。其余字符仍按原顺序选择原分片，全部原字符覆盖不变，艺人姓名与自由编辑礼物正文不受词库限制。原分片 WOFF2 不重写、不复制、不删字；无线上字体 API、运行时生成或全量文字下载依赖。

输入从 `sources.json` 的精确 Google Fonts Git 提交与 SHA256 定位，和当前 Fontsource 5.3.0 对照，字体内部版本均为 2.004-H2。保留 wght 100–900 可变轴、subsetting 按当前实际 Fontsource 原分片的 GSUB/GPOS feature 集合（同时包含定位与替换规则）选择，并保留所选字形需要的 lookup/closure、原 hinting 和时间戳；font-display 为 optional。生成后检查 cmap 与词库集合完全一致、可变轴不变，以及原分片的 hhea/OS2 关键垂直 metrics 一致，并逐字符在 100/400/900 三档字重比较当前 Fontsource 原分片的分解轮廓及字宽。原 TTF 还包含原网页字体没有提供的替代字形功能，生成时不额外引入；manifest 保存原始与候选 feature 集合并拒绝新增功能漂移。三档抽样不冒称每个连续字重、所有 shaping 序列和全部平台的像素证明，最终浏览器回归独立记录。

## 可重现生成

从仓库根目录，使用 Node 24.20.0 与锁定 pnpm 依赖；Python 工具只用于开发时重新生成，网站启动/构建无需 Python：

```sh
mise exec node@24.20.0 -- uv run scripts/fonts/generate-ui-subsets.py --source-dir .turbo/font-sources --download
mise exec node@24.20.0 -- node --test scripts/fonts/generate-fallback-css.test.mjs scripts/font-ui-subset.test.mjs scripts/font-ui-artifacts.test.mjs
```

`--download` 只获取不存在的官方固定输入，并在写入前校验 SHA256；已有文件若校验失败会直接退出。已有正确原始文件时可省略此选项。输出为 `packages/design-tokens/styles/fonts/generated/` 的 CSS、WOFF2、OFL 原文和可重复 manifest；不包含生成时钟或开发机绝对路径。两份词库变化时重新生成，整仓设计检查会检测词库/字节摘要漂移。

Python 生成器在 UI 产物完成后调用 `generate-fallback-css.mjs`，并把本轮 `--output-dir` 同时作为 `--ui-dir`，避免误读旧 UI manifest。仅需重现 fallback CSS 时，无需运行 Python 或重新计算字体二进制：

```sh
mise exec node@24.20.0 -- node scripts/fonts/generate-fallback-css.mjs
mise exec node@24.20.0 -- node scripts/fonts/generate-fallback-css.mjs --output-dir .turbo/font-fallback-reproduction
```

独立命令默认从已提交的 UI 目录读取 manifest/CSS/WOFF2，可用 `--ui-dir` 指定新的完整 UI 输入。所有输出始终按正式 `styles/fonts/generated/` 安装位置编码相对资源路径；临时输出用于逐字节比对，不用于从临时目录直接加载字体。资源引用经声明的 `design-tokens/node_modules/@fontsource-variable/.../files/` 路径解析并验证真实文件，不把 pnpm 存储路径写入 CSS。原 face 的 family、weight、style、display、format 及顺序保留，完全被 UI 覆盖的空 face 才省略；storefront 既有构建规则仍统一把 display 转为 optional。

生成前验证当前完整 catalog 的 SHA256、codepoints、UI CSS 范围、UI WOFF2 与原分片摘要。`fallback-manifest.json` 记录原 CSS、UI 与所有原分片字节摘要，以及完整覆盖数量；生成器测试要求已提交输出可逐字节重现。语义测试逐原 face 验证范围差集、完整 union，以及每个非 UI 字符仍选中同一个真实原字体文件。CSS 声明范围的检查不替代实际 cmap/轮廓检查或真实浏览器验证。

原字体来自 [Google Fonts Noto Sans JP](https://github.com/google/fonts/tree/66a36c8c94b1a5d992ee4e7f392fccfe4945767c/ofl/notosansjp) 与 [Noto Sans SC](https://github.com/google/fonts/tree/a85815a42757630ce188fdad368c2dfc444d4773/ofl/notosanssc)；裁字使用 [FontTools subset](https://fonttools.readthedocs.io/en/latest/subset/index.html)。随输出分发原始 OFL 1.1 许可证及版权，未采用 Reserved Font Name “Source” 为子集字体名称。

CSS 资源选择测试使用全部当前 UI 字符，不截取某个测试页面。曾经允许原分片与 UI 范围重叠的后写优先模型不能证明浏览器只下载 UI 字体；本轮冷缓存实测发现重叠仍触发多个原分片请求，因此改为互斥范围。该模型的 ≤2 请求目标与完整 21 组三次 Lighthouse、真实 JS/图片预算、全部语言文字渲染和真实用户指标相互独立。既有近似像素对照不会因 CSS 覆盖测试通过而升级为全字重、全平台的视觉等价证明。
