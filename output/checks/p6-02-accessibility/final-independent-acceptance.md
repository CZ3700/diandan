# P6-02 run-4 最终独立证据验收

结论：**PASS / ACCEPT，本次本地自动验收证据完整，无未解决阻塞。**

复核者：`/root/home_gift_audit`。本轮只读取已经完成的报告、日志、源码和截图并核对字节，没有重新启动浏览器、测试、服务或修改产品。实现独立审查见同目录 `frontend-independent-review.md`、`storage-independent-review.md`、`harness-independent-review.md`。复核者此前参与合同/应用/API 实现，不把那部分的作者自验包装成独立代码审查。

## 运行身份与完整性

- 运行：`run-4`，ID `eb449603-544a-43cd-b1fe-a568304769ba`。
- 完成时间：`2026-09-23T18:23:02.741Z`。
- 自有实例：`test-regression-b643408543a946c4`。
- outer：`run-4/report.json` 为 PASS，五个步骤全部 PASS，browser 子进程退出码 0。
- owned：`run-4/artifacts/checks/p6-02-accessibility/browser/test-regression-b643408543a946c4/result.json` 为 PASS，build/start/stop/reset 均退出 0，`dataPreserved=false`。
- inner：上述目录的 `pages/report.json` 为 PASS，最终 stage 为 `pt-native-zoom:operations`；与 owned receipt 内的 browser 对象逐值一致。
- 归档实际 **249 文件**，与 outer 声明相等；逐个 SHA-256 对比隔离 workspace 的原 output，**0 缺失、0 字节差异**。

源码身份：冻结清单共 **2,866 文件**，其中 **2,782 执行输入**。重新计算执行输入清单摘要与 source.json / outer report 三者一致：

```text
c7b2e52ba36558e104d10fead2a1e0c7f69cca65e3319ea8310231438a2b2903
```

隔离执行副本的全部 2,866 文件字节和 mode 与清单一致；root 的全部执行输入也一致。读取时 root 只有 `docs/operations/accessibility.md`、`docs/progress/phase-6-hardening.md` 两个文档与冻结版本不同，没有执行源差异或文件缺失。

## 真实矩阵与截图

七语言为 `en / zh-CN / th / vi / ja / es / pt`，每种恰好四个不同单元，无重复或缺失：

| 模式 | 单元数 | 各核心页实际 CSS 视口 | reduced motion |
| --- | ---: | --- | --- |
| mobile | 7 | 390 × 844 | true |
| desktop | 7 | 1440 × 900 | false |
| narrow | 7 | 320 × 844 | true |
| native-zoom | 7 | 855 × 421，实际浏览器 200% | true |

每格恰好检查 home / gift / cart / checkout / order / management / operations 各一次，因此是 **28 × 7 = 196 个核心页面检查**。全部 passed；实际语言与格子语言一致，document/body 宽度均不超出 CSS viewport，尺寸和 reduced-motion 测量与声明吻合。147 个 reduced-motion 核心页的运行中 transform animation 均为 0，document scroll behavior 为 auto。

截图清单与磁盘均为 **199 个不同 PNG**：196 核心页 + 1 个英文手机首页越界页 + 2 张 native baseline / zoom 图。所有文件存在且 PNG 头部、非零尺寸有效。setup 产生的其他截图属于前置内容发布流程，不计入这 196 个页面或199张矩阵图片。

首页 28 格均记录无预设 market/currency、艺人之后直接可见已发布礼物、进详情前无需市场选择、浏览没有创建购物车。分类 GET、清除分类、越界恢复真实通过；该浏览器实例只有一个已发布礼物，因此报告明确 `paginationNextBack=NOT_EXERCISED_SINGLE_PUBLISHED_GIFT`。多页真实数据的 SQL 分页证据另见 storage 独立复核，不扩大本次浏览器分页声明。

## 原生 200% 缩放

使用 Chrome `153.0.8010.53`，临时 HostZoomMap profile、headed browser、`viewport:null`；静态实现审查确认没有用 CSS zoom、device metrics 或 page scale 模拟该路径。

| 测量 | 100% baseline | 200% zoom |
| --- | --- | --- |
| outer window | 1710 × 929 | 1710 × 929 |
| inner CSS viewport | 1710 × 842 | 855 × 421 |
| devicePixelRatio | 2 | 4 |
| visualViewport scale | 1 | 1 |
| physical PNG | 3420 × 1684 | 3420 × 1684 |

两张归档原 PNG 的尺寸与 SHA-256 分别精确匹配报告：100% 为 `39c44177cfa260928176052ca3761b6b005ce10b92976c6ee9c9498dc4546ec9`，200% 为 `0244e9e7fada2eb6f2c18958b079fda4240e544c53e8006d28695295909917b3`。独立打开这两张图确认内容与重排真实存在，并抽看 `th-narrow-operations.png`：订单界面保持单列、标题可换行、焦点环可见、没有展开私密内容。没有声称逐张人工视觉审读199张图。

## 交互、实际发布、错误与清理

- **真实 daily 发布读取：** `actualDailyBrowse` PASS，七语言 **49 checks**，sourceLocale=en；经真实实例 PostgreSQL 仓储和既有 projector 校验，不是仅页面 mock。
- **订单搜索：** 恰好 **28 条**，逐格唯一；before-submit focus、精确 request 匹配、pending h1 focus、response validation、complete h1 focus、next Tab in workspace 六项全部 true。数据来自本次真实请求放行与响应校验，旧列表不能充当结果。
- **键盘：** **506 条**几何/焦点证据全部 reached、visible、unobscured、focusVisible、outline=true 且尺寸为正；**8 条**modal 记录均证明 Tab/Shift+Tab 围合与 Escape 归还焦点。首个 checkout 另有 required-email 的 valueMissing/focused/named/described 全真记录。
- **交易范围：** payment create 恰好 **1 次**，观测状态为 REQUIRES_ACTION 后 SUCCEEDED；journey payment / mailAccess / fulfillment 均 true。是一次完整 TEST 支付、清 cookie 后的独立邮件交换和审核/准备/送达。其他格子复用仅在内存中的已授权 session 检查订单布局，不声称28笔独立交易或28次单次链接兑换。
- **axe：** 核心196页及额外越界页使用4.13.0；实际 violations **0**、incomplete **0**，不只是严重项为零。
- **运行错误：** pageErrors、observations、cleanupFailures 均为空。
- **隐私：**报告结构未出现 cookie/token/password/CSRF/email/message/displayName/request/response/body 敏感负载字段；源码截图/axe 在私密面板关闭后执行，输入遮蔽。该结构核对和抽图不冒充全面DLP扫描。
- **清理：** native profileRemoved=true；stop/reset 原始日志和退出0一致。只读检查确认 run-4 自有实例 `config.json` 已不存在。没有连接、重置或读取用户实例的私有配置。

## 其他质量证据与历史失败

已读 `tools-final-3.txt` 的原始 **17 tests / 17 pass / 0 fail**，包含真实Chrome helper fixture 回归。独立读取不计作再次执行；旧 `tools-final.txt` 的13项与 `tools-final-2.txt` 的14项保留历史。

已读 root 的 `check-dev-final.txt`：workspace/boundaries/format/lint 通过，typecheck **64/64**、test tasks **64/64**、build **36/36**。这些是任务计数，不描述成单测用例总数。日志本身明确 PG/S3/browser/formal acceptance 不在 check:dev 中；这里的真实浏览器证据来自独立 run-4。

| 历史运行 | 当前原始状态 | 归档文件数 | 处理 |
| --- | --- | ---: | --- |
| run-1 | FAIL | 54 | 保留邮件会话 reload 竞态原件 |
| run-2 | FAIL | 54 | 保留 canonical order route 竞态原件 |
| run-3 | FAIL | 112 | 保留后台搜索卸载/焦点问题原件及独立 RED/GREEN 诊断 |
| run-4 | PASS | 249 | 新实例、新冻结输入、完整重新执行通过 |

不能将 run-1/2/3 的局部诊断与 run-4 拼接成一次通过；本报告的28格全部来自 run-4完整归档。

## 接受边界

接受的是 P6-02 当前登记的**本地自动化范围**，其中前台为生产 Next 构建、后台为本地 Next 开发模式，支付为独立 TEST PSP。`humanScreenReaderVerified=false`、`physicalPhoneVerified=false` 保留明确边界；没有据此声称真人 VoiceOver/NVDA、七语人工译审、真实手机辅助技术、真实商户支付、生产基础设施或完整 WCAG 合规认证已经完成。后续若产品执行源变化，应按影响范围重新验证。
