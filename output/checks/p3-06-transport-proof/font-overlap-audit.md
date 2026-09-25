# P3-06：中文字体分片重叠只读审计

日期：2026-09-21。状态：**初始全 Unicode 互斥候选已废弃；真实 cmap 核验后，Root 授权仅对可打印 ASCII 去重复，已完成 RED→GREEN。WOFF2 不变，浏览器收益仍待 Root 验证。**

本记录承接 `prior-critical-path-audit.md`。**不能按所有后写 CSS 范围删除较早范围**：原 latin 的宽范围包含其实际 cmap 不提供的字符，全 Unicode 去重复会令 JP 丢失 19 个实际字符、SC 丢失 15 个实际字符。详见后面的 cmap 更正。本记录保留原静态推导作为被实际字体证据否定的中间假设，不能把它当成最终实现。

最终候选只让非 UI 可打印 ASCII（U+0020–007E）的 fallback 声明互斥；所有其他字符逐 face 保持既有范围（仍减既有 UI 集），并保留每个字符原有的后写优先资源。不重打包 WOFF2、不内联字体声明、不修改 Lighthouse 门槛。

## 结论与边界

旧三次同一中文礼物导航实际都请求九份字体。保存的 HTML 正文按当前仓库 `selectFace` 模型只需七份：UI 子集、latin，以及 SC112/113/115/116/117。额外的 SC108 在这份正文中仅匹配 `$`，SC119 仅匹配拉丁字母、数字和句点；这些字符均由后写的 latin face 优先提供。

因此，仅消除 fallback 之间的可打印 ASCII 重叠，就是有具体资源证据支撑的最小候选。若浏览器确认这两份请求消失，本导航可少下载 **141,352 资源字节 / 142,057 传输字节**，字体资源从 553,700 降至 412,348 字节，约 **25.53%**；九份变七份。这仍是静态预测，不是已验证的浏览器性能收益。

Root 在本审计收尾时报告新的六个 H2 样本都通过预算，但其官方 LCP 图中包含 **零份字体**。本记录没有独立重跑该批测量。该现象不能证明字体重叠已解决，也不能用这些 LCP 图宣称上述字体候选已取得收益；必须同时看实际请求集合、字节和官方图纳入的资源。

## 输入与源码证据

原始样本目录：

`output/checks/p3-06-storefront-acceptance/run-2026-09-21T13-25-04-359Z/browser-attempt-2/gift-render-trace/`

- `zh-CN-gift-mobile-{1,2,3}.json`：`audits.network-requests.details.items` 中的实际字体请求及资源、传输字节。
- `zh-CN-gift-mobile-{1,2,3}-artifacts.json`：`MainDocumentContent`，即同一次导航保留的 HTML。
- `output/checks/p3-06-transport-proof/prior-critical-path-audit.md:21–53`：旧候选的 document → CSS → font 终端路径；同一九字体集合因 observed LCP 截止点不同而进入图中的数量为 9/2/5。

以下源码行号以候选修改前、基线 `c252c52` 的本次读取为准：

| 文件与行                                                             | 事实                                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/storefront/src/app/(public)/(simplified-chinese)/layout.tsx:2` | 中文路由直接导入字体 CSS。                                                                           |
| `packages/design-tokens/styles/fonts/simplified-chinese.css:1–2`     | 先 fallback，后同 family 的 UI 子集。                                                                |
| `packages/design-tokens/styles/foundations.css:76–77`                | 中文 profile 的 `--font-ui` 为 Noto Sans SC Variable。                                               |
| `apps/storefront/src/app/globals.css:11–19`                          | 页面 body 继承这一字体。                                                                             |
| `apps/storefront/src/storefront/gift-detail.css:37–42`               | 标题只改变字号、500 字重、行高等，没有另一套标题字体 family。                                        |
| `scripts/fonts/sources.json:22–27`                                   | SC 子集只读取完整的中文 storefront 静态 UI catalog。                                                 |
| `scripts/fonts/ui-corpus.mjs:17–29`                                  | 从 catalog 全部字符串生成 codepoint 集合，不包含商品自由编辑正文和运行时格式化的价格等内容。         |
| `scripts/fonts/generate-fallback-css.mjs:148–170`                    | 读取、散列原 WOFF2；只在 CSS 中减去 UI 范围，并继续引用完整原二进制。                                |
| `scripts/fonts/generate-fallback-css.mjs:183–188`                    | 当前已经保证 fallback 与 UI 不相交、总 union 与原声明一致，但没有要求各 fallback face 相互不相交。   |
| `scripts/font-ui-subset-support.mjs:38–41`                           | `selectFace` 使用 `findLast`，按 CSS 声明后写优先选择范围。                                          |
| `scripts/font-ui-subset-support.mjs:55`                              | 该工具明确是仓库 CSS 源序模型，不是浏览器引擎。                                                      |
| `scripts/fonts/README.md:3,25,27,31`                                 | 原文件不重写；现有 UI 互斥设计及浏览器重复请求的历史证据；范围测试不替代实际 cmap/轮廓和浏览器验证。 |

本次对 storefront 源码的 `next/font` 搜索没有结果。这里的九份请求不是 Next Font 自动给标题、正文各选一套字体，而是普通 CSS 下同 family 的分片选择。生成 fallback 源码中的 `font-display: swap` 会由 `apps/storefront/postcss-font-display-optional/index.cjs:10–16` 的现有构建插件改为 `optional`，插件入口见 `apps/storefront/postcss.config.mjs:3`。`optional` 不等于不请求字体，也不能据此抹去 Lighthouse 实际记录中的资源。

## 九份请求及实际正文归属

以下资源、传输字节取旧第 1 次 LHR；旧三次请求的字体集合一致。

| 文件                             | 资源字节 | 传输字节 | 当前正文按后写优先模型所需的非 UI 字符                      |
| -------------------------------- | -------: | -------: | ----------------------------------------------------------- |
| `simplified-chinese-ui`          |   108856 |   109210 | 静态 UI 字符；整个文件覆盖 416 codepoints                   |
| `noto-sans-sc-latin-wght-normal` |    25240 |    25592 | `$.012345ABDFGJLNOPRSTUY`                                   |
| `noto-sans-sc-117-wght-normal`   |    52464 |    52816 | 传元创简                                                    |
| `noto-sans-sc-112-wght-normal`   |    57648 |    58000 | 递                                                          |
| `noto-sans-sc-116-wght-normal`   |    52984 |    53336 | 构                                                          |
| `noto-sans-sc-115-wght-normal`   |    56508 |    56860 | 仅画                                                        |
| `noto-sans-sc-113-wght-normal`   |    58648 |    59000 | 插                                                          |
| `noto-sans-sc-119-wght-normal`   |    76800 |    77153 | 无；原范围命中 `.012345ABDFGJLOPRSTUY`，均被后写 latin 覆盖 |
| `noto-sans-sc-108-wght-normal`   |    64552 |    64904 | 无；原范围只命中 `$`，被后写 latin 覆盖                     |
| 合计                             |   553700 |   556871 | 当前实际请求九份，源序选择模型需要七份                      |

直接范围证据：

- `packages/design-tokens/styles/fonts/generated/simplified-chinese-fallback.css:1731–1734`：SC108 的范围仍含 `U+24`，即 `$`。
- 同文件 `2019–2031`：SC119 仍含数字、拉丁字母等，并同时保留它独有的假名、月、网、全角句点等字符；候选不能删除整份声明或整份字体。
- 同文件 `2070–2076`：后写 latin 包含上述 `$`、数字、拉丁字母范围。
- `apps/api/scripts/gift-storefront-copy.mjs:33,43`：动态文案“传递”和“仅用于内部测试的原创虚构礼物插画”分别引入 117/112 和 115/117/116/113。
- `apps/api/scripts/gift-storefront-fixtures.mjs:290,313–328`：商品名称和商品翻译由发布内容提供。
- `apps/storefront/src/storefront/gift-detail.tsx:99–108,154–155`：渲染真实商品标题、副标题和详情。
- `apps/storefront/src/storefront/commerce-context.tsx:111–116`：动态市场标识、`Intl.DisplayNames` 的币种名称及币种代码；保存的 HTML 中包含 GLOBAL、USD、JAPAN、JPY、美元、日元。

三份保存的 HTML 提取结果都为 **539 个正文字符 / 168 个不同字符**，选中文件集合相同，模型缺字数量为 0。HTML 提取排除了 script、style、template，保留 body 中 streamed 片段的文字；它不是重新执行浏览器、不是视口可见性采集，也没有宣称已经覆盖运行时新增 DOM、CSS 伪元素或所有未来商品内容。

## 已废弃：全 Unicode 互斥的静态演算

设原 face 范围为 `R_i`，完整 UI 集为 `U`，按原 CSS 源顺序排列。候选范围：

`R'_i = R_i − U − union(R_j for j > i)`

只改变声明中的范围，不改 family、style、weight、display、二进制 src 或各字形。范围为空的 face 才省略，其余仍保留。独立只读演算对整个 SC 声明范围得到：

| 项目                                |  结果 |
| ----------------------------------- | ----: |
| 原声明 union                        | 15605 |
| UI codepoints                       |   416 |
| 候选 fallback union                 | 15189 |
| 候选 fallback + UI union            | 15605 |
| 原／候选 union 对称差               |     0 |
| 全部非 UI codepoints 的优先资源变化 |     0 |
| 候选 fallback 重复归属次数          |     0 |
| 原 fallback face 数                 |   101 |
| 候选非空 fallback face 数           |    99 |

这是 CSS 声明模型的结果，**不能证明浏览器真实字形不变**，实际 cmap 检查已否定直接实施此公式。正式候选不使用此全 Unicode 公式，亦不会把 SC fallback face 降至 99 个。

## 实际 cmap 更正与最终 ASCII 候选

使用仓库现有锁定的 FontTools 4.64.0 / Brotli 1.2.0，在 offline 环境只读所有原 Fontsource WOFF2 的 `getBestCmap()`。每个“较早声明被删除”的码点都检查后写 CSS owner 是否真有字形，同时核对较早字体是否提供该字形。

| 全 Unicode 候选审计           |  JP |  SC |
| ----------------------------- | --: | --: |
| 原 face 数                    | 124 | 101 |
| 拟删除的重复归属次数          | 400 | 649 |
| 后写 owner 缺实际 cmap 的次数 |  25 | 319 |
| 会删除较早实际字形的次数      |  20 |  16 |
| 会丢失的不同实际字符          |  19 |  15 |

例如 SC91 有 U+2010/U+2011，SC119 有 U+2027，但其后写 latin 只有对应 CSS 声明、没有这些实际 cmap 字形。完整记录：`output/checks/p3-06-font-range/cmap-audit-before.json`。原 `font-range-red.log` 为该已废弃假设的 RED：19 tests，11 PASS / 8 FAIL，保留且不作为最终验收。

Root 因此收窄范围。独立检查 **全部 95 个可打印 ASCII**，JP/SC 的每个原后写 owner 都具有实际 cmap 字形；扣除 UI 后，两 profile 均只消除 **73 次 / 73 个 ASCII 字符**的重复归属，后写 owner 缺字为 0。完整记录：`output/checks/p3-06-font-range/cmap-ascii-audit-before.json`。

最终公式，其中 `A = U+0020–007E`：

`R'_i = R_i − U − (A ∩ union(R_j for j > i))`

生成后 JP 仍为 124 个 fallback face、完整 union 17929（UI 384 / fallback 17545）；SC 仍为 101 个 fallback face、完整 union 15605（UI 416 / fallback 15189）。任何非 UI、非可打印 ASCII 字符仍由全部原 face 按原顺序广告，不仅保留最后一个 CSS owner。

定向测试保留所有非 ASCII 范围、全 union、每个非 UI 字符原优先资源、所有非 range 描述符、原资源顺序、实际 WOFF2 字节及生成可重复性。ASCII RED 单独记录在 `font-ascii-range-red.log`：19 tests，11 PASS / 8 FAIL，明确因 U+24 等 ASCII 重叠失败。最小实现后四份定向测试 `font-ascii-range-green.log`：**23/23 PASS**。这些是源码/产物验证，不是浏览器字节或 LCP 验收。

## 为什么不优先重打包字体

仅减去已经由 UI 文件供应的字符，在本导航八份原字体的声明集合中占比如下。这里的数量是 **码点归属次数**，不是独立字形数，也不是压缩字节比例：

| 原分片 | 原声明码点数 | 与 UI 重复 | 除 UI 外被更后 face 覆盖 |
| ------ | -----------: | ---------: | -----------------------: |
| 108    |          188 |          2 |                        1 |
| 112    |          188 |          6 |                        2 |
| 113    |          188 |         18 |                        3 |
| 115    |          188 |         42 |                        1 |
| 116    |          188 |         65 |                        2 |
| 117    |          188 |         90 |                        3 |
| 119    |          276 |         35 |                      102 |
| latin  |          387 |         25 |                        0 |
| 合计   |         1791 |        283 |                      114 |

UI 重复码点归属为 **15.80%**；尤其旧第 1 次模型的终端 SC108，仅 2/188 与 UI 重复。没有生成新二进制，无法把该比例换算成 WOFF2 压缩节省，更不能承诺裁字后九份请求会减少。先让范围互斥，有机会直接省掉两份合计 141352 字节的请求，改动和验证范围也更小。

## 实际执行的只读复现命令

以下两条原始静态命令在修改前从仓库根目录执行，仅读取已有文件，在内存中计算并写 stdout；没有生成字体、编辑产品文件或调用测试框架。第一条读取当时的旧 CSS，候选实施后重跑会读取新 CSS，不能将其输出冒充旧版本。原内容采集与旧版源码绑定由 Root 独立保留。

### 保存的 HTML → 当前优先资源

```sh
python3 - <<'PY'
import pathlib,re,json,collections
from html.parser import HTMLParser
base=pathlib.Path('packages/design-tokens');css=(base/'styles/fonts/generated/simplified-chinese-fallback.css').read_text();ui=set(json.loads((base/'styles/fonts/generated/manifest.json').read_text())['profiles'][1]['codepoints']);faces=[]
for b in re.findall(r'@font-face\s*\{([^}]+)\}',css):
 n=re.search(r'noto-sans-sc-([\w-]+)-wght-normal',b).group(1);ps=set()
 for t in re.search(r'unicode-range:([^;]+)',b).group(1).strip().split(','):
  a=t.strip()[2:].split('-');ps.update(range(int(a[0],16),int(a[-1],16)+1))
 faces.append((n,ps))
class Text(HTMLParser):
 def __init__(self):super().__init__();self.skip=0;self.body=False;self.text=[]
 def handle_starttag(self,t,a):
  if t=='body':self.body=True
  if t in ['script','style','template']:self.skip+=1
 def handle_endtag(self,t):
  if t in ['script','style','template']:self.skip-=1
  if t=='body':self.body=False
 def handle_data(self,d):
  if self.body and not self.skip and d.strip():self.text.append(d)
for run in [1,2,3]:
 p=pathlib.Path(f'output/checks/p3-06-storefront-acceptance/run-2026-09-21T13-25-04-359Z/browser-attempt-2/gift-render-trace/zh-CN-gift-mobile-{run}-artifacts.json');d=json.loads(p.read_text());parser=Text();parser.feed(d['MainDocumentContent']);text=''.join(parser.text);matched=collections.defaultdict(set);allmatch=collections.defaultdict(set);missing=set()
 for c in text:
  if ord(c) in ui:matched['UI'].add(c);continue
  found=False
  for n,ps in faces:
   if ord(c) in ps:allmatch[n].add(c)
  for n,ps in reversed(faces):
   if ord(c) in ps:matched[n].add(c);found=True;break
  if not found:missing.add(c)
 print('run',run,'length',len(text),'unique',len(set(text)),'needs',sorted(matched),'missing',repr(''.join(sorted(missing))))
 if run==1:
  print('BODY', ' | '.join(parser.text))
  for n,chars in matched.items():
   if n!='UI':print('chosen',n,''.join(sorted(chars)))
  for n in ['108','119']:print('raw-overlap',n,repr(''.join(sorted(allmatch[n]))))
PY
```

stdout 摘要：

```text
run 1 length 539 unique 168 needs ['112', '113', '115', '116', '117', 'UI', 'latin'] missing ''
chosen latin $.012345ABDFGJLNOPRSTUY
chosen 117 传元创简
chosen 112 递
chosen 115 仅画
chosen 116 构
chosen 113 插
raw-overlap 108 '$'
raw-overlap 119 '.012345ABDFGJLOPRSTUY'
run 2 length 539 unique 168 needs ['112', '113', '115', '116', '117', 'UI', 'latin'] missing ''
run 3 length 539 unique 168 needs ['112', '113', '115', '116', '117', 'UI', 'latin'] missing ''
```

### 完整原范围 → 互斥候选，不写产物

```sh
python3 - <<'PY'
import pathlib,re,json
p=pathlib.Path('packages/design-tokens');ui=set(json.loads((p/'styles/fonts/generated/manifest.json').read_text())['profiles'][1]['codepoints']);css=(p/'node_modules/@fontsource-variable/noto-sans-sc/wght.css').read_text();faces=[]
for b in re.findall(r'@font-face\s*\{([^}]+)\}',css):
 n=re.search(r'noto-sans-sc-([\w-]+)-wght-normal',b).group(1);ps=set()
 for t in re.search(r'unicode-range:([^;]+)',b).group(1).strip().split(','):
  a=t.strip()[2:].split('-');ps.update(range(int(a[0],16),int(a[-1],16)+1))
 faces.append((n,ps))
original={point:n for n,ps in faces for point in ps};seen=set(ui);candidate=[]
for n,ps in reversed(faces):candidate.append((n,ps-seen));seen.update(ps)
candidate=list(reversed(candidate));mapping={point:n for n,ps in candidate for point in ps};union=set(mapping)|ui
print(json.dumps({'originalUnion':len(original),'ui':len(ui),'fallbackUnion':len(mapping),'candidateUnion':len(union),'unionDifference':len(set(original)^union),'nonUiPriorityResourceDifferences':sum(mapping.get(pt)!=n for pt,n in original.items() if pt not in ui),'originalFaceCount':len(faces),'nonEmptyCandidateFallbackFaces':sum(bool(ps) for _,ps in candidate),'candidateDuplicateMemberships':sum(len(ps) for _,ps in candidate)-len(mapping),'eliminatableRawBytes':64552+76800,'eliminatableTransferBytes':64904+77153,'rawSavingsPercent':(64552+76800)/553700*100},ensure_ascii=False))
PY
```

stdout 为本记录“候选的全范围静态演算”表及 25.528625609535847% 的资源比例。字节常量来自上述原 LHR 的网络条目，未替换或编辑 LHR。

### 实际执行的 ASCII cmap 核验命令

```sh
uv run --offline --no-project --with fonttools==4.64.0 --with brotli==1.2.0 python - <<'PY' > output/checks/p3-06-font-range/cmap-ascii-audit-before.json
import pathlib,re,json
from fontTools.ttLib import TTFont
base=pathlib.Path('packages/design-tokens');profiles=json.loads((base/'styles/fonts/generated/manifest.json').read_text())['profiles'];results=[]
for profile in profiles:
 root=base/'node_modules'/profile['fontsourcePackage'];faces=[]
 for block in re.findall(r'@font-face\s*\{([^}]+)\}',(root/'wght.css').read_text()):
  resource=re.search(r'url\((?:[\'\"])?([^\)\'\"]+)',block).group(1);points=set()
  for token in re.search(r'unicode-range:([^;]+)',block).group(1).strip().split(','):
   a=token.strip()[2:].split('-');points.update(range(int(a[0],16),int(a[-1],16)+1))
  with TTFont(root/resource,lazy=True) as font:cmap=set(font.getBestCmap())
  faces.append({'file':pathlib.Path(resource).name,'points':points,'cmap':cmap})
 ui=set(profile['codepoints']);owners={point:i for i,face in enumerate(faces) for point in face['points']};ascii_points=set(range(0x20,0x7f));removed=[]
 for i,face in enumerate(faces):
  for point in (face['points']-ui)&ascii_points:
   owner=owners[point]
   if owner!=i:removed.append({'point':f'U+{point:04X}','from':face['file'],'owner':faces[owner]['file'],'ownerHasGlyph':point in faces[owner]['cmap']})
 results.append({'profile':profile['profile'],'all95AsciiSelectedOwnerHasGlyph':all(point in faces[owners[point]]['cmap'] for point in ascii_points),'removedMemberships':len(removed),'removedUniquePoints':len(set(x['point'] for x in removed)),'ownerMissingCmapCount':sum(not x['ownerHasGlyph'] for x in removed),'removed':removed})
print(json.dumps({'schemaVersion':1,'tool':'fonttools==4.64.0 / brotli==1.2.0','readOnly':True,'profiles':results},ensure_ascii=False,indent=2))
PY
```

该命令只写审计 JSON，不改字体、源码、依赖或系统环境；uv 使用缓存，未下载包。完整 Unicode cmap 审计使用同一读取流程，将 ASCII 过滤去掉，记录缺 cmap 以及较早字体实际有 glyph 的情况；证据 JSON 保留所有具体码点和文件名。

### 最终候选 RED / GREEN 命令

```sh
mise exec node@24.20.0 -- node --test scripts/fonts/generate-fallback-css.test.mjs scripts/font-ui-subset.test.mjs > output/checks/p3-06-font-range/font-ascii-range-red.log 2>&1
# 确认上述 ASCII RED 之后，才修改生成器并执行：
mise exec node@24.20.0 -- node scripts/fonts/generate-fallback-css.mjs
mise exec node@24.20.0 -- node --test scripts/fonts/generate-fallback-css.test.mjs scripts/font-ui-subset.test.mjs scripts/font-ui-artifacts.test.mjs scripts/font-loading-policy.test.mjs > output/checks/p3-06-font-range/font-ascii-range-green.log 2>&1
```

## 实施验收约束

Root 在固定旧版三次导航完成并暂停其 Next 后，授权先 ASCII RED 再最小 GREEN。本子任务未运行 Chrome、全仓检查或构建；Root 负责实际候选浏览器与后续验收。

- 全 union、每个非 UI 字符优先选择的原资源、原字体文件摘要均须保持；只规范化完整可打印 ASCII，不能为测量页面硬编码例外字集。
- CSS 范围并不自动证明实际 cmap 支持所有重分配字符；须检查实际字符覆盖、组合字形与必要 shaping，并保持完整七语字形和布局验证。当前字体二进制不变也不能代替浏览器字体选择验证。
- 浏览器必须证明冷缓存实际请求集合和字节的变化；未含字体的官方 LCP 图不可作为消除字体冗余的证据。
- 保留当前 UI 与动态商品内容、语言、字体 family、字号、行高、字重与可读性。不隐藏内容、不换系统字体、不预热、不改预算。
- 本记录未验证生产 CDN、真实 RUM 或所有未来商品文案的请求数量；SC108/119 保留的独有字符在将来内容中出现时仍应正常按需下载。
