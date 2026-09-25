# P3-06 — 浏览前台验收检查点

状态：**IN_PROGRESS**。本文件是本轮工作入口，尚不构成 Phase 3 退出记录。

最新结论：完整 `pnpm check` attempt6 已在最终59ebd051来源一次整条exit0（19:30:54–19:51:02 UTC，1207.834秒）。七语88项UI、lazy9项51断言和共享P2回归通过；LCP仅1/21组达标，真人运营/读屏/关键译审仍待完成。统一入口为 `validation.json`，历史失败与下文各中间检查点原样保留。

- 基线：`6eacb83ff39776cb09be16ae6ac398699d180129`。
- 分支：`codex/p3-06-storefront-acceptance`；只做本地检查点，尚未推送或合并。
- Owner：`/root`，Lane D 唯一 executor。Phase 3 ACTIVE，Phase 4 LOCKED。
- 权威需求：`docs/FAN_SUPPORT_PLATFORM_SPEC.md`、`docs/progress/phase-3-storefront.md`、P3-06 Task 卡。
- 运行手册：`docs/operations/storefront-acceptance.md`。

## 实现

1. PostgreSQL 当前发布证明驱动的 SEO entity、分页索引与轻量 sitemap catalog；前台 canonical、hreflang、x-default、OG、真实 Product/Offer 和分页 sitemap。
2. 私密/未知参数、筛选投影、失效发布、事故 fallback、无效价格范围均关闭索引资格。语言不推导市场或价格，不虚构评分、库存或交易结果。
3. 公开 JSON/XML 使用带完整规范化 scope 的 ETag；每次先重新读取当前业务证明，再判断 304。Cookie/Auth 为 private no-store；HTML/RSC/BFF 仍 no-store。没有正数共享 TTL，也没有把节省响应字节说成减少了源站计算。
4. 0021 扩展持久发布失效路径至 SEO 与根/locale sitemap，保留旧任务和严格精确重试；迁移没有增加业务表。
5. 公共发布读取使用共享行锁，写入保持原排他锁。在实际并发失败后修复公共读取之间的锁升级冲突；不宣称任意并发写入从此不会出现数据库冲突。
6. 七语言实际 UI、发布到可见性、移动 Lighthouse 和资源采样 harness，以及不预建待测商品的真实非开发运营 UAT 准备工具。
7. 同一 SEO 请求的七语言投影共用一次完整发布证明校验，各语言仍分别校验媒体、内容和最终响应。没有新增跨请求缓存或绕过审核的可信开关。

## 兼容与独立复核

`compatibility.json`：旧 378 合同根与 117 OpenAPI schemas 不变，增加 4 根与 3 schemas。旧 11 个公开 GET 仅调整缓存头、If-None-Match/304 与对应描述；原请求和响应业务格式兼容。

独立复核按职责分别保存在 `seo-backend-directory-review.md`、`seo-frontend-independent-review.md`、`seo-purge-independent-review.md`、`public-get-cache-independent-review.md`、`public-read-locks-directory-review.md`、`public-openapi-directory-review.md`、`acceptance-helpers-directory-review.md` 和 `operations-uat-directory-review.md`。这些是各自已审源码/轻量验证范围，不代替最终真实联合检查。

## 验证记录规则

- 所有失败尝试保留。首次 fixture 因不可发布的首页推荐被业务门正确阻止；后续浏览器实际暴露并发锁冲突，原始诊断在 `run-2026-09-07T10-17-40-907Z/`。
- 共享 P2-04 已刷新通过。P2-05 两次长任务失败后，增加阶段时间记录与失败日志，按原预算复测通过；没有充分证据认定波动的单一原因或永久修复。见 `shared-motion-regression-review.md`。
- 完整 `pnpm check` attempt 1 因共享浏览器指纹过期停止；attempt 2 因旧目录迁移测试仍确认旧 HEAD 停止。退出码和时间见各 `check-attempt-*-result.json`，不能把前缀通过当成整条通过。三个旧迁移验证入口随后分别以 308/64/30 项真实 PostgreSQL 断言通过，独立复核见 `migration-head-adaptation-review.md`，最终整仓待复跑。
- `run-2026-09-07T11-18-22-930Z` 的真实 protocol PASS：32,461 累计准备/协议断言、6,090 正常管理 API 请求、606,823ms；150 SEO 实体、8 分片，63 个并发请求全部成功，owned PostgreSQL deadlocks 0→0。PUBLISH 可见性门实际 FAIL：首次扫描中出现一次 8 秒 XML 超时，第二轮已读取全部新内容但总计 84,923ms，超过固定 60 秒预算。原数据已通过正常 rollback 恢复，旧运行正常清理；正在减少多语言 SEO 重复证明计算，后续必须重新冷启动验证。
- `run-2026-09-07T11-46-25-432Z` 的新 protocol PASS：32,461 累计准备/协议断言、6,090 正常管理请求；63 并发请求通过，owned PostgreSQL deadlocks 0→0。七语言真实发布/回退可见性分别 14,562ms / 17,291ms，均通过原 60 秒门。随后 compiled browser callback 于 12:02:19 UTC PASS，22,692 断言；84 页面组合和 4 项交互、88 PNG、85 axe 扫描零 violations。仍保留 30 incomplete rules（536 节点），不能宣称全部无障碍检查自动通过。等待环境后来结束并记录通用 FAIL；它不覆盖已完成 callback 的结果，也不构成性能通过。
- 冷测试原默认并发先后遇到 content / observability 的 5 秒超时。仅对 content 测试限制为两个文件 worker 后，以 `turbo run test --force --concurrency=2 --output-logs=errors-only` 完成全部 58/58 任务、零缓存；断言和超时未放宽。该结果只证明所记录并发条件通过，不宣称默认冷并发已通过。见 `content-test-worker-review.md`。
- 2026-09-08 继续时重新核对全部 1,515 项实现/测试/配置输入，没有新增、删除或字节变化；对应 `implementation-source-browser-with-worker-bound.json`，SHA256 `fe46825ee20b329c3291f632a556388381e4f80a9fa6ec76e92ff19e9da6d000`。已完成的浏览器证据保留，性能和最终整仓门仍待补齐。
- Lighthouse 保留每组全部三次及中位数/最小/最大值，不取最好一次；实验室指标不是 RUM/真实用户 p75。

## 第二轮性能修复检查点

首轮 63 次 Lighthouse 已完整收集，但 LCP 21/21 组未达标，性能分数仅 5/21 组达到 90；84 页面 JS 未满足建议预算。已据此完成主视觉与目录拆分、礼物读取并行、临时加载字体与公共合同依赖调整，并修复实际弹层被 sticky 顶栏遮挡的问题。前台 46 files / 316 tests、类型和相关静态检查通过；新生产构建与真实性能仍待验收。详见 `performance-iteration-2-implementation.md`，不将旧结果覆盖为通过。

## 第三轮首屏依赖与交互回归

首屏客户端退出Zod与内部发布证明初始化；63条公开route编译入口已独立复核。商品价格/库存与筛选初值由Server渲染，完整搜索/筛选schema按实际请求或提交加载。第三轮6页同条件资源实测203,468–207,239 bytes，相比最初约332–345KB显著下降；LCP2,785.8–3,918.9ms仍未达当前lab目标，不能称性能验收通过。

全前台52files377tests、全前台types、全仓format:check/lint通过。两个异步取消竞态保留真实closure RED2→GREEN3；独立root边界review 76tests通过。实际Chrome首次交互故障注入最终9cases/51assertions/9PNG PASS，涵盖加载期间编辑/IME/关闭/取消/latest-wins、筛选503整页恢复和搜索503原按钮重试；首次attempt仅Drawer fixture定位不唯一失败，未改产品或放宽断言，原报告保留。根已实际查看恢复搜索与手机筛选关闭后的截图。

第三轮实现入口 `performance-iteration-3-implementation.md`；最终源码含独立lazy browser模块共1,540files，`implementation-source-before-final-matrix.json` SHA256 `662dcb3e30ca0d97e070e90262a7e8b6945d5b52ba12088a338ea7d119cc148f`。完整新七语双端matrix已独立PASS：88cases/88PNG、85axe零violations但30incomplete/536nodes；实际弹层9/9点命中，pageErrors0，真实发布/回退10,418/10,240ms。63次LH全部收集：score20/21组达标，LCP1/21组达标（2,416.4–5,415.9ms），CLS21/21组均0。84资源页JS203,468–207,239B仍超150KB SHOULD；236图片全达预算，0资源失败。性能COLLECTED_BUDGET_FAILED；详见browser-attempt-4/performance的README与verification-summary。Fixture所属进程/6端口/2容器均已正常清理，外层exit0仅证明清理，不覆盖性能失败。

最终P2-04/P2-05共享浏览器回归通过（各27.023s/37.3s）；原414项未跟踪文件已再次逐SHA完全一致。全仓冷test及完整check串行执行中；第三轮S.U.P.E.R 1–9 ACCEPT，第10 PARTIAL。Root另实际查看最终英文桌面礼物页、泰语手机艺人目录截图，未见遮挡/横向溢出，不将视觉观察当作泰语含义批准。

## 最终静态门同步

整仓attempt3实际在设计基础检查停止：原检查器把locale常量限定在locale.ts本地声明。随后仅同步四个验证器/测试文件，读取locale-values唯一值并检查公开值导出、Zod schema绑定和精确locale拒绝链；类型导出、缺leaf、嵌套声明/注释诱饵不接受。Foundation有效RED4→32全GREEN；Interaction有效RED14/57及空函数RED1/59均保留，最终59/59及实际两个gate、format/lint通过，独立复审另记。

新全仓输入仍1540项，SHA256 `3572b837e0ed6d532fc6d967a22763d64a1c6fb921c1281443104c61e4c75c94`，详见 `implementation-source-before-complete-check.json`。与662浏览器来源相比仅这四个checker变化，全部产品/素材/构建输入一致；P2两个渲染指纹不含这些文件。没有为验证器修正重复采集同一产品的63次性能，完整 `pnpm check` attempt4正在运行。

整仓attempt4随后实际在商品历史保护测试停止：113个先行断言通过，但旧.at(-1)取到了新增0021，未执行原目标0020。现在精确按version=0020选择回退SQL，原交易/55000/回滚断言不变，真实PG重跑117项PASS，独立复审ACCEPT，SQL与业务代码未变。另保留检查器独立复审发现的三个参数/hoisted遮蔽反例，最小修复后66项tests及实际gate独立PASS；此前报告的59项为修正前检查点。

最终冻结1540输入 `implementation-source-before-check-5.json`，SHA256 `b0cab59fda6be4618eb2645f8da56d10df2d9580b66ec61dcaa26561955f74bd`；与662浏览器来源相比仅四个静态检查器与一个PG测试脚本变化，没有运行时、SQL、合同、素材或部署配置变化。完整check attempt5从此冻结重新执行。

完整check attempt5于19:20:13 UTC实际退出1：PG/API/S3/媒体全通过，format/lint通过，typecheck58/58（29 cached）、test58/58（54 cached）、build35/35（25 cached）通过，但最后adapter边界发现contracts的测试AST辅助模块位于src并被编译到dist，导入typescript不符合内层生产依赖门。该失败未删除；正在将辅助模块移至包内测试专用目录并保持生产rootDir/输出布局不变，guard本身不放宽。完整单条check尚不能报PASS。

## 人工门与环境范围

两次 UAT 准备环境已真实启动，各自通过 1,796 准备断言、581 正常管理请求，第二次在 1440×900/390×844 观察到三组材料、34 个复制按钮、raw 默认收起、无横溢出及 pageErrors 0；计时始终为空。受控 SIGINT 后共享 runner 实际退出 1 并输出通用 FAIL，端口和所属进程已确认停止，不把该退出码写成正常 0。详见各 operations-uat run 的 smoke/cleanup。

当前仍需真实非开发运营者的一次培训与 3/5/8 分钟操作记录，以及可核验的 VoiceOver/NVDA 实测。`operations-uat-README.md` 和操作卡仅准备材料、角色窗口与计时工具；不会把自动化执行、预填商品或自报耗时自动判成人工 PASS。

实际开启过 VoiceOver，但工具没有取得可核验的朗读反馈，已恢复原开关状态，详见 `voiceover-attempt.md`。axe、DOM 和可访问树不能替代读屏。

正式 UI/动态内容的人工翻译批准、正式素材/经营主体/市场/政策、生产身份源、真实 CDN、PSP、staging/生产及新真机仍有独立门。所有本轮数据与发布都是明确 TEST fixture；不把本地通过写成发布完成。

## 证据保护

本轮开始前的 414 项未跟踪产物由 `untracked-baseline.json` 保护。既有 output 原始字节已在本地 `pre-check-evidence.tar.gz` 及 manifest 备份；该大文件不进入检查点。需要刷新的 P2 证据保留 Git 历史；旧协议脚本重写的历史输出须在保留本轮副本后恢复。只暂存本轮拥有的代码、文档和必要结构化证据，不暂存原始日志、备份包或用户原有未跟踪文件。

## 测试 helper 生产边界修复及最后完整检查

完整 check5 的末端 adapter guard 实际拒绝 src 下的 TypeScript 测试工具，失败保留。已把 helper 移至合同包 test-support，noEmit 与 build 的 rootDir 分别明确；九项受影响测试、合同包类型/构建、实际 adapter/31 exports 均通过。独立重算其余 296 个编译文件完全一致，仅移除四个测试工具产物，详见 `contracts-test-helper-review.md`。最终源 `59ebd051a135110a3cf01b6b22bc5c373f83e41ad2b79a0b07e2dd166fe2a04d` 与七语浏览器/性能来源 662dcb3e 的差异仅是已记录测试/静态校验与测试配置，不改变生产运行产物。P2-04/05 已刷新通过，完整 check6 正在执行；状态仍 IN_PROGRESS。

## 最终本地技术检查点

完整 check6 exit0，类型58/58（28 cached）、test58/58（29 cached）、build35/35（30 cached），31 package exports经Node实际导入；包括所有实际PG/API/TLS S3与媒体worker、格式/lint和依赖门。独立bounded冷test另为58/58零缓存，不混称这次整条check零缓存。最终run `run-2026-09-07T19-44-16-684Z` 协议32,461断言/6,090 setup请求、277,319ms通过；这不替代编译浏览器和性能证据。

`final-protection.json`证明1540项实现与59ebd051冻结清单完全一致、原414项未跟踪产物字节一致且仍未跟踪。880个旧output中只允许62个P2文件按新回归刷新；其余818逐SHA一致，两个被协议入口重写的JSON先存 `revalidated-legacy-output/after-check-6/` 再恢复旧字节。大型备份、原始日志和原414文件不进入检查点。

当前是可复审的本地技术检查点；性能预算、非开发真人计时、实际读屏和当前关键译文批准仍未通过，不标P3-06 DONE，不关闭Phase3或解锁Phase4。下一项技术工作见 `performance-next-steps.md`。新的人工准备环境只作为操作入口，其准备断言和空计时不能变成人工验收PASS。只本地提交，不push/merge。

新真人准备入口已真实READY并保留：指导页 http://127.0.0.1:59939，中文Admin http://localhost:59200/zh-CN，上限约北京时间2026-09-08 04:52。1796准备断言/581请求和双端只读22断言通过，未预建待测礼物，计时0。root查看双端首屏；详见 `operations-uat-README.md` 与新run `final-preparation-smoke.json`。只准备和检查操作卡，人工状态仍PENDING。
