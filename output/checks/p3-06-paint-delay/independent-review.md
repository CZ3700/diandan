# P3-06 compositor诊断profile独立复核

## 范围与当前结论

只读审查 `apps/api/scripts/storefront-gift-trace-verification.mjs` 与其 `.test.mjs` 相对 `a560ac7` 的最终diff，另核pinned Lighthouse13.4.1类型/Trace实现以及本轮RED/GREEN日志。未运行测试、Chrome、服务、构建或trace重放；只写本报告。

**工具代码审查无阻断项，可继续登记的固定三次真实取证。当前不是完整检查点ACCEPT：实际采集、全仓开发门、收尾保护/扫描及根因结论仍待独立核验。** 此profile只增观察，生产页面未在这两文件修改中改变，不扩大到未登记的UI重测或Chrome参数实验。

## diff逐项确认

1. `traceProfile`仅允许`standard`与`compositor-diagnostic`，默认值为standard；旧caller没有新增必填参数。collector在mkdir/runLighthouse前验证；TEST callback在mkdir、公开API读取及Chrome启动前验证。未知profile不会静默退回standard。
2. standard生成的Lighthouse options与原版本一致，未附加空的additionalTraceCategories；Chrome launcher函数没有修改。诊断profile唯一新增的Lighthouse选项是六个类别的逗号字符串：`cc,disabled-by-default-cc.debug,renderer.scheduler,disabled-by-default-renderer.scheduler,blink,viz`。目标、类别审计、simulate、mobile、预算和内容检查未改变。
3. pinned Lighthouse的 `types/lhr/settings.d.ts:65` 明确接受 `additionalTraceCategories?: string | null`。`Trace.getDefaultTraceCategories()` 后concat此字符串并join逗号，实际含义是保留默认类别后追加这六项，不是替换默认类别。conditions中的`defaultTraceCategories:false`表示不再仅使用默认集合，不能误读为默认类别被禁用。
4. 新profile明确写入组级conditions，并保留追加类别数组；每次config原本就保存options、LHR settings与artifacts settings。诊断模式新增断言要求两份实际settings精确包含请求字符串，避免只请求类别但结果未使用仍标成功。配置声明一致不等于每个类别必定产生事件，真实trace还需检查。
5. retainAttempt仍先保存LHR、原Trace/DevTools/完整artifacts、config、HTML与原生日志等九文件，随后执行原完整性与新增settings断言。失败留在attempt.failure；固定三次全部完成后才AggregateError，未新增重试、补采或删除失败行为。
6. 输出schemaVersion仍为1，conditions仅增加说明字段；读取计数/实际发布proof/最终aggregate路径保留。没有新增域名、凭据、资产、生产依赖、应用配置或业务合同。

冻结SHA：

| 文件 | SHA-256 |
| --- | --- |
| storefront-gift-trace-verification.mjs | `5c72cf5ef39c2aac454ee04eb5d22e12c21a1b3cf862bbca17363f7cd77c16a9` |
| storefront-gift-trace-verification.test.mjs | `bcd398a0ca8d43eeb181c7c09c93ab18d3e3300e1fcfdf7e10bfb93eb58171f0` |

## 测试证据与可读性

已读取作者保留的 `trace-profile-red.log`：14 tests，原9通过/新增5失败；最终 `trace-profile-green-final.log`：14/14通过，0失败，352.978ms。限定format日志通过，作者结果文件exit0。审查者没有重跑命令。

新增五项覆盖缺省/显式standard的原options完整相等、诊断类别与保存config一致、collector与TEST callback未知profile拒绝，以及LHR/artifacts分别篡改类别后仍先保存全部三次再拒绝。旧九项继续覆盖Chrome flags、两种读取模式、缺trace/network/version/runtime异常和内容失败保存。mock只能确认编排合同，不替代实际Chrome类别是否生效或定位根因。

code-simplifier轻量审查：没有建议追加清理。统一profile校验函数避免分散白名单；options中仅在诊断时添加一个字段，明确保留standard字节形状。参数从TEST callback传到collector与验证路径清楚，不为缩短代码合并保存与断言阶段。

## S.U.P.E.R与实测待验边界

S.U.P.E.R第1–9项在本次工具范围静态PASS：职责限于profile选择与证据校验；函数含义单一；TEST编排依赖方向不变、无新增循环；profile接口显式；配置与报告仍为可序列化数据；环境/Chrome参数不改；无新依赖；runLighthouse注入与原失败替换边界保留。第10项当前只有14定向tests与限定格式证据，完整开发/真实三次与收尾证据待提供，不提前标全PASS。

真实采集复核应限定既定范围：三次同当前build、无额外预热或优选重试；实际settings/原始文件SHA与profile标记一致；核新增类别实际事件及可关联字段；保留所有预算失败。追加类别改变观察开销，新三次应独立列为扩展诊断，不与原48份默认条件报告计算前后收益、不替代正式63次矩阵。

根因主张必须能连接目标frame/layerTree/sourceFrame的commit、activate、submit/presentation及调度/抑制状态；同renderer邻近事件、任意同URL图片、累计DroppedFrame数量或新样本未复现均不足以认定原因或修复。具体测量排除项与缺失信息见同目录 `measurement-audit.md`。P3-06性能/人工/商户门保持OPEN。

## 固定三次扩展采集复核

已独立读取 `run-2026-09-17T12-38-57-411Z/browser-attempt-1/gift-render-trace`，逐文件重核 **27原始文件长度/SHA全部匹配**。三次conditions均属compositor-diagnostic，LHR/config/artifact settings完全相同，实际additionalTraceCategories与登记六项一致，显式Chrome flags仍为原四项。逐份原生日志按capture起始sequence切窗，均只有一个成功STOREFRONT_GIFT请求、无GIFT_CONTENT请求（0+1）；内容检查通过、runtimeError和attempt failure均为空。

另逐行核原trace的类别：三次均实际包含全部六个追加类别，非只在配置中声明。各次`cc`事件计数12,817 / 11,686 / 11,569，`disabled-by-default-cc.debug`为11,073 / 11,764 / 11,708；renderer.scheduler及其debug、blink、viz也均非零。此计数仅证明观察类别生效，不把类别中任意事件自动归到目标图像。

三次官方observed LCP为628.637 / 433.427 / 371.471ms，未复现约一秒的原等待；模拟LCP为5273.910 / 2785.393 / 2110.707ms，原聚合状态仍为 **COLLECTED_DIAGNOSTIC_BUDGET_FAILED**。已核官方离线分析六个FCP/LCP复算记录差值均0。新增三份只列“扩展诊断”，不并入原48份默认条件报告作性能收益比较，更不是正式63份矩阵通过。

已核fixture-result：exit0、341.989秒；原日志32,461协议断言与三次采集回调通过。affected-result及日志为四文件25 tests通过、0失败。审查者没有重跑这些命令。

旧慢/快阶段关联另做独立原trace核对：在各自PID/TID、id2.local及对应reporter时间范围内，慢`0x40`的EndActivateToSubmit为610.490→1594.008ms（983.518ms），Submit→Presentation为1594.008→1597.291ms；快`0x3b`对应314.419→314.592ms（0.173ms）、314.592→316.253ms。与`trace-audit.compact.json`完全一致。**这定位了旧等待阶段，没有定位触发原因，也没有实施或证明修复。** 同意保留pending-frame/调度/可见性等竞争解释；新profile未复现不能关闭其中任何一个。

## 有界ESLint证据目录修正

首轮check:dev在lint停止（exit1、15.093秒），原日志保留2,333 errors，来自上轮19份已捕获的压缩浏览器响应body。已独立审查登记后的 `eslint.config.mjs` diff：只对精确目录 `output/checks/p3-06-image-response/script-comparison/bodies/**` 添加全局ignore及说明，未忽略整个output、未改任何lint规则、未修改旧body证据。该目录内容是已绑定SHA的生成响应数据，不是待维护源码。

已读取ESLint API范围证据 `lint-evidence-scope.json`：19份body被忽略；邻接分析器、本轮runner、TEST collector及storefront生产factory四路径仍被检查。此修正不会使本轮工具或生产代码逃过lint，无阻断发现。它发生在真实采集后，不能伪装成当时两文件冻结输入的一部分；最终应单列配置delta。最终check:dev及其后的保护/秘密扫描仍待结果。

## 最终收尾与局部 ACCEPT

已复核最终check-dev日志/结果：exit0、28.463秒；typecheck/test各62/62（各61缓存），build36/36（35缓存），format/lint均通过。adapter边界4.015秒、artifact边界0.560秒均exit0；与前述25定向tests和真实32,461协议/三次trace证据共同满足本轮开发验证。没有声称运行完整pnpm check或新七语言UI。

`protection.json`记录初始4,419文件SHA不变，2,229采集输入除登记的采集后ESLint配置外全保持，生产应用未变。`post-capture-source-delta.json`准确单列此配置差异，最终聚合SHA为`b9d3fb5b842c6a6ac028018a0063e3bd0fcfa45fa30553e776b6c83342f9cf7c`。独立再核两工具冻结SHA保持、ESLint当前SHA为`58c76f5768685041331be9e157794e19f2facf09987fac473e8d35f22435023b`，与记录一致。fixture自动清理exit0，final-verification记录65486/65488/65487均无监听。

扩展诊断报告和compact记录将首次文本FCP与最终图像LCP分开，未拿FORKED partial reporter冒充完整帧链。新三个最终图像帧激活后至提交仅0.225 / 0.389 / 0.341ms；导航至LCP窗口内开始的pending区间最长19.073 / 17.407 / 17.546ms，全部结束点关联同compositor ACK调用；一条结束晚于LCP被明确保留。第1次已有文本FCP后的162.477ms BeginImplFrame空档有needsBeginFrame=0→1记录，不应计为另一阻塞。当前报告对这些事实的限定合理：只说明扩展类别拿到了所需观察字段，不能把三次未出现旧异常推导成原因已排除或问题已修复。旧983.518ms阶段定位仍成立，触发根因UNKNOWN。

已读取当轮 `secrets-result.json` / `secrets.log`：30个精确路径暂存后执行的秘密扫描exit0、40.430秒。由此 **ACCEPT本地诊断profile、精确归档lint边界及本轮取证检查点**，没有阻断发现。S.U.P.E.R第1–9静态项保持PASS；第10在这一工具/本地开发验证范围PASS，最终提交检查已补齐。

此局部ACCEPT不改变P3-06正式性能失败：原48份默认诊断与新增3份扩展诊断分列，正式63份矩阵、人工译审/运营/读屏/实机、商户/PSP/staging门继续OPEN；没有生产修复、性能收益、GitHub推送或部署结论。报告冻结，审查者没有追加采样或运行测试/构建/服务。
