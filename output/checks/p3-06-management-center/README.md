# P3-06 简洁管理中心

本次承接 e38297a，用户明确要求单入口与三个短表单。任务仍为 P3-06；不解锁 Phase 4，不推送或合并。

## 交付范围

- 默认 Admin 为艺人、礼物、首页海报，单图上传、自动适配、原文发布、列表编辑。
- 四类礼物与库存分开；默认按单准备，真实限量库存和价格仍写 PostgreSQL 权威账目。
- 海报上传替换与历史恢复，恢复只替换图片，保留当前首页其他内容。
- 一个实际授权操作者提交，真实媒体加工、事务发布、outbox、前台读取；不制造译文审核或另一审核人。
- 旧严格工作台保留在受保护的 /:locale/advanced，旧 382 合同定义完全不变。

## 当前证据状态

最终综合状态以 validation.json 为准，不能把以下分段成功拼成一次完整通过。

- runtime9：10 个操作成功、双端七语言 Admin 通过；公开原文读取失败，已修复真实 API/Application 旧 locale 门禁。
- runtime10：首次礼物检查点 UPDATE23514；原日志没有新旧时间。受控真实 PostgreSQL 后续证明较晚 prior event 会触发旧守卫，保持守卫并修复事件时间单调性，12 项通过。
- runtime11：旧 TEST 政策在刚生效边界校验失败。两份夹具保留原生效时间与正式校验，仅等实际生效满 1 秒再继续。
- runtime12：10 个操作、70 个公开详情页通过；最终观察器记录 26 次响应读取失败，不能称完整浏览器通过。原因与后续修复验证单独保留。
- runtime13：完整环境与浏览器 exit0，7 场景、10 个操作、70 个公开详情页、98 PNG / 98 axe，0 violations / 0 pageErrors / 0 observationFailures，1 项 incomplete 保留人工复核。完整仓库 check attempt5已整条通过。attempt1 旧 webhook 约束一次失败，原样独立PG复跑通过；attempt2 暴露旧目录脚本的最新迁移仍写0021，其余四处同类TEST假设已纳入修正。原生产守卫不变。attempt3 旧三秒短会话HTTP正例遇403，原样复跑通过，受控跨实际expiry复现同形；夹具改为15秒准备预算并以PG实际到期轮询，完整436断言/68请求通过。attempt4在旧媒体HTTP小图CONTAIN负例失败，原输入已与新保全规则冲突；只将该负例明确为COVER，1798断言/159请求通过，旧失败/重试/不可变历史检查全保留。完整attempt5 exit0，1187.855秒；type58/58（56cache）、test58/58（56cache）、build35/35（30cache）、31实际Node出口通过。93个组合类型/单测任务亦已单独通过。
- P2-04/05 已实际重跑通过；迁移 up/down/up 22 个版本、159 张表通过；原 382 合同深比较不变。

原始失败和 RED 日志只在本地保存，不覆盖为成功。最终源码指纹、完整检查退出码、浏览器最终结果和保留性复核分别见 source-final.json、full-check-final-meta.json、run-* 和 preservation-final.json。

## 视觉与范围

root 实际查看 runtime12 的 zh-CN-390-artists-form.png 与 zh-CN-1440-posters-list.png，确认短表单、完整比例图片和清晰历史恢复入口。公开首页 axe 的 1 项 color-contrast incomplete 涉及横向艺人列表 6 个节点，不能写成已自动证明对比度；真实读屏与人工可访问性验收仍在 P3-06。

本地入口与复跑命令见 docs/operations/management-center.md。LOCAL_TEST_DEV 使用临时 PostgreSQL/S3，窗口最多 110 分钟，结束后清理测试数据。没有新增正式运营账号、持久部署、真实支付、staging、手机真机或生产上线证据。

## 窗口保留前的键盘回归修正

runtime14 的10次操作和84个Admin矩阵面板通过，但file输入框焦点检查失败；失败截图中焦点回到了“添加礼物”标题。已有无条件requestAnimationFrame在键盘已Tab到file后执行，抢回标题。原失败见runtime-fourteenth-summary.json，未包装成浏览器PASS。

仅新增Admin小焦点调度helper、单元测试并接入workspace标题/成功提示；用户已移焦时跳过，旧帧可取消，卸载会清理。独立受控真实Chrome旧实现RED、新实现3caseGREEN，原完整管理browser checker完全未改。directory非作者复核ACCEPT。

完整check的7a60源码后仅这4个UI/验证文件变化（含独立浏览器probe），后端、数据库、合同及共享P2输入逐SHA未变，见full-check-scope-preservation.json。最终1640项源码SHA为7bc844b288300d40a55b8b37449258c2e2126e761b7a3d2ca41011c9bbe30622；全仓format/lint及type/test/build组合105/105（99缓存）、边界和31Node出口于final-ui-gates-meta.json通过。最终完整管理窗口复验单独记录，不把上述组合写成该最终源码又执行了一次整条pnpm check。

## 最终本地检查点

runtime15 `run-2026-09-08T00-27-54.438Z-de8e9e67` 全部7345检查、1481浏览器断言通过；10次操作、70公开详情页、98PNG/98axe，0violations/pageErrors/observationFailures，1项incomplete仍保留。之后opener实际读取中文管理入口HTTP200、看到ARTISTS列表，才打开并保留唯一已登录窗口；runtime.json记录真实地址与到期时间。此窗口2026-09-08 10:17:54北京时间到期，属于临时TEST存储。最终源码与浏览器、最终UI gates输入完全一致。

root实际查看最终runtime15桌面海报历史截图，确认当前使用/历史恢复清晰可辨。原852文件仍未跟踪且逐SHA不变；780旧tracked output中仅34个P2刷新文件保留新版本，两项旧回归报告先保存本轮新副本后按原字节恢复。当前综合状态PASS_FOR_LOCAL_CHECKPOINT，P3-06继续IN_PROGRESS，Phase4仍LOCKED。

Git保留最终runtime15全套截图与报告、关键源指纹和验证摘要。早期失败的完整原始日志与截图仍在本地；历史结果引用不等于这些大文件全部提交。所有命令与实际退出状态见相应meta/log，不把临时试用或本地通过称为生产发布。
