# P3-06 字体重复下载修正

已修复中日字体 fallback 对可打印 ASCII 的重复声明。真实同fixture H2对照中，中文礼物页三次均由9份字体降至7份：553700→412348 resource B，减少141352B（25.53%）；原UI和225份原字体二进制不变。这是已验证的下载减量，不等于P3-06完整验收通过。

## 实现与防回归

生产改动只在生成器按原后写优先规则为U+0020–007E分配唯一fallback声明，重新生成两份CSS及其manifest。每个非ASCII字符的原逐face范围仍完整保留；原源顺序、资源、family/weight/style/display不变。日文17929/中文15605个CSS声明码点覆盖不变，原WOFF2、静态词库和UI字体不变；没有新增网站运行时依赖。

最初考虑过全Unicode范围去重。实施前真实cmap审计发现该方案会让日文19/中文15个实际字符失去来源，因为CSS大范围声明不代表字体文件真的含有每个字形。该方案未实施；其RED和审计保留。最终ASCII方案的两个profile各95字符后写owner真实cmap均存在；其余字符逐face不动。准确复跑命令、225原字体SHA与7个UI产物SHA见 `implementation-verification.json`，生成入口见 `scripts/fonts/README.md`。

## 真实对照

同一真实PG/TLS S3/worker内容fixture、同viewer origin/证书，旧版与候选各固定3次原standard profile Lighthouse；中途仅按原流程重新构建候选。未改图片/缓存策略、浏览器参数、预算或替换慢样本。Node/browser测试证书范围沿用前一传输实验；并非部署或系统信任验收。

| 源码阶段 | 字体请求 | 字体resource B | 三次LCP ms | LCP中位ms |
| --- | ---: | ---: | --- | ---: |
| 旧版 | 9 | 553700 | 4968.4245 / 2405.4873 / 1955.1059 | 2405.4873 |
| 候选 | 7 | 412348 | 4275.773 / 1955.0864 / 2256.0191 | 2256.0191 |

以原件数组和 `comparison-summary-verified.json` 为准。两组中位数预算通过，**两组各有一次超过2500ms，全部保留**；图像缓存和实际绘制截止会影响模型，不能声称稳定端到端提速。真正逐样本确定的收益是去掉SC108/119、存留7份字体path/SHA/长度相同。H2实际font transfer B旧554751/554752/554752，候选413167/413166/413156；协议头会波动，不把旧HTTP/1.1的传输字节预测当实际收益。

54原文件SHA/长度、同原件内容/配置/Chrome启动参数、native读取0+1、12个官方FCP/LCP重放与其5输入SHA绑定均通过。两个阶段API发布响应与fixture manifest原字节相同。基线测量之后的两条辅助图片请求取消仍保留；最终156个服务器记录按stage完整分段闭合，viewer已关闭、active/overflow为0，不把导航有效与所有辅助请求无失败混为一谈。`comparison-summary.json`是初版，`comparison-summary-verified.json`补了严格launcher和replay输入键绑定，是最终入口；均保留，没有重采。

## 功能、显示与工具验证

- ASCII-only RED：19tests中11通过、8预期失败；GREEN定向23/23。原全范围方案的RED另存且明确废弃。设计/字体完整门57tests通过。
- 全仓check:dev、adapter/artifact通过，最终命令/时间/退出码见对应 `*-result.json`。最终检查在新增离线工具完成后重跑；不是完整pnpm check或生产验收。
- 同fixture原HTTP入口七语言390×844/1440×900回归：88场景、88PNG、85axe，零违规、零页面错误；30项照片叠字相关incomplete仍留人工门。包含键盘艺人定位/语言保持、礼物分页金额筛选、返回、抽屉焦点/reduced motion、取消/错误、SEO和发布/回退（9957/9715ms）。root已查看七语言礼物截图，未见本次缺字或主文案裁切。见 `ui-summary.json`，不冒称H2 UI或物理手机/读屏验收。
- 独立受控Chrome字体对照：95 ASCII＋4组动态混排/保留符号、中日两profile、400/500/600/700字重，共792项尺寸/像素零差异；CDP证明两边实际使用自定义字体，55个字体响应SHA与各自源字节匹配，8PNG保留。首次工具复用family导致SC实际回退系统字体，严格门正确FAIL；改为每profile独立family后通过，未修改产品或重采性能。见 `rendering-summary.json` / `rendering-harness-note.md`；只证明本平台已加载字体的这些样例，不涵盖所有字重/平台/冷加载像素。
- 候选2348输入SHA在采样、UI后不变；原5227未跟踪逐SHA不变。两fixture及Chrome所记录10个端口已无监听，自有服务正常清理，第二fixture完整exit0。第一传输诊断的fixture/reader FAIL原样保留。

## 复跑与后续

`plan.md`、`run-comparison.mjs`、`stage.json`用于保持同fixture分段：baseline3次后用日志指定的owned PID暂停Next；候选源验证后将stage写candidate并触发原SIGUSR1重建；最后stage=ui触发原全UI回归，再SIGTERM正常清理。原数据目录：`output/checks/p3-06-storefront-acceptance/run-2026-09-21T15-55-54-248Z/`。生成独立新run，不能覆盖本轮原件或挑最好样本。其余命令：

```sh
mise exec node@24.20.0 -- corepack pnpm check:design-foundations
mise exec node@24.20.0 -- corepack pnpm check:dev
mise exec node@24.20.0 -- node output/checks/p3-06-font-range/verify-fallback-rendering.mjs
mise exec node@24.20.0 -- node apps/api/scripts/storefront-gift-trace-analysis.mjs --input <original-capture> --output <new-replay-directory>
```

离线比较脚本绑定本轮原件，运行会拒绝覆盖最终summary。原trace、完整PNG及报告保留本地并由SHA清单指向；提交保留源码、可复跑入口和精简证据。最终非作者复核、S.U.P.E.R、秘密扫描与Git范围见 `final-review.md` / `final-verification.json`。

P3-06仍IN_PROGRESS，29 DONE / 2 IN_PROGRESS / 18 PENDING=49。下一步是在已验证资源修正基础上收敛仍超时的样本，完成与部署传输一致的完整七语言性能矩阵；真机/VoiceOver、人工译审/图片叠字、真实PSP及staging门继续保留。仅本地提交，不push或解锁其他Phase。
