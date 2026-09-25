# UI 字体子集测试范围

运行入口：

```sh
mise exec node@24.20.0 -- node --test scripts/font-ui-subset.test.mjs
```

有效 RED：`font-ui-subset-valid-red.log`，5 tests / 3 PASS / 2 FAIL。日文当前完整 default copy 有 303 个不同 Unicode codepoints，按原 Fontsource CSS 需要 25 个资源；中文 322 个点需要 15 个资源。两项失败都来自 `<= 2` 的指定目标，不是缺文件或解析异常。首轮 `font-ui-subset-red.log` 另包含 pnpm symlink 与 realpath 相同文件的路径比较差异，已通过统一 realpath 修正；不将首轮额外失败当成产品 RED。

测试读取当前 `packages/i18n/src/storefront/ja.ts` 和 `zh-CN.ts` 的全部 default copy 字符串，包括当前未必出现在某个首屏的文案和插值模板字符，不改字、不删文案、不只挑一种页面。它按真实 profile import 顺序展开 Fontsource 和新增本地 CSS，再按相同 family/style/weight 的最后一个 unicode-range 匹配 face 计算候选资源集合。条件化 import、未知 at-rule、无法解析范围或多来源字体会明确拒绝，不静默忽略。

兼容正例完整检查：

- 原 Fontsource 全量 import 保留且在首位，每个原 face 的源路径、描述符、unicode-range 和声明顺序完全一致。
- 全量原 CSS 声明的 Unicode 覆盖集合不减，也不新增未经原字体声明的覆盖；所有非 UI 原支持点仍选择原来的 font resource。
- family、normal style、100–900 variable weight 保持，实际 WOFF2 文件存在且具有 WOFF2 文件头。
- 所有 face 经当前既有 PostCSS 策略后仍为 font-display optional。
- 模型自身有重叠范围后声明优先、通配符、补充平面字符、缺字与非 UI 回退的正例。

`scripts/font-ui-subset.test.mjs` 与 `scripts/font-ui-subset-support.mjs` 的格式及 scoped ESLint 已通过；本子任务没有修改生产字体、词库、foundation guard、正式 Lighthouse 配置或预算。

## 不能由该模型证明的事情

这是静态 CSS 请求图模型，既不是真实首屏网络请求数，也不是传输预算、字体渲染完成时间或 Lighthouse LCP。浏览器实际只请求被渲染文本所需字形，且受 font-display optional、布局、字体可用性和请求调度影响；全 UI 词库计数不能冒充每个页面的实测结果。

CSS unicode-range 声明与 WOFF2 文件头不能证明二进制 cmap、字形轮廓、advance、kerning 或 variable 插值相同。新增字体是否保留原样，须由 root 的可重现生成链与实际字体二进制字形/metrics 验证另证；若只是放宽 unicode-range、换成别的字体或指向空字体，不能靠本测试宣称视觉等价。

同样，原始字体的全部 CSS 覆盖保留不等于支持所有 Unicode 字符。这里严格指“此前 Fontsource 已声明支持的字符不退化”；任意艺人/礼物内容仍沿原 Fontsource 和系统后备规则处理，未为运营文本限制可输入字符。

后续需要同源码编译产物的真实字体请求数、截图/任意非 UI 文本回退以及全部原性能样本验证。不降低 2500 ms LCP、0.9 performance score 或原资源 SHOULD 阈值。
