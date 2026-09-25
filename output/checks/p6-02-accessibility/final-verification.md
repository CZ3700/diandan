# P6-02 本地验收与首页直接礼物浏览

执行基线 `40854787`，分支 `codex/p6-02-accessibility`；最终浏览器冻结执行源 `c7b2e52ba36558e104d10fead2a1e0c7f69cca65e3319ea8310231438a2b2903`。本地自动范围执行通过；非作者最终接受见 `final-independent-acceptance.md`。不代表真人读屏、真实手机、生产或真实商户验收。

## 交付

- 按 ADR-017，首页艺人后直接展示真实上架礼物的图片、名称与简介，提供分类和分页。默认每页 12、最多 48；无地区的独立礼物目录也能直接浏览。明确地区/币种后才读取报价并沿用原加购、库存及结账重验。
- 新只读合同、应用服务、PG 仓储、HTTP/BFF 完整接通；不推测默认市场，不创建购物车，不写价格或库存。旧 700 个 JSON Schema 定义、204 个 OpenAPI schema、127 个路径保持原值。
- 修复后台搜索/筛选提交时焦点随旧列表卸载的问题，复用稳定标题焦点；输入 draft 和请求完成不触发重复抢焦点。真实 Thai 320 延迟响应先红后绿，完整矩阵逐单元重验。
- 新增独立源码副本的可重复可访问性入口、严格完成门和失败清理。原用户实例保持，同配置、四服务 ready；不 reset 用户数据。

## 最终命令与结果

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm check:dev` | format/lint、64 typecheck、64 test、36 build PASS；缓存 60/62/34 | `check-dev-final.txt` |
| 后台受影响测试 | 62 files /219 tests PASS | `admin-focus-tests.txt` |
| 六个受影响 workspace 的完整单测 | 前台746、后台219、API314、application642、contracts520、persistence746；全仓任务包含其余包 | `workspace-tests/`、`check-dev-final.txt` |
| `pnpm test:accessibility-tools` | 17/17 PASS | `tools-final-3.txt` |
| 新工具最终格式/lint | PASS | `format-search-final.txt`、`lint-search-final.txt`；相关先前门同目录保留 |
| `pnpm check:contracts` | 生成物新鲜，canonical locale 保持 | `contracts-final.txt` |
| 设计基础 | 57 tests 与真实 token/font 检查 PASS | `design-foundations.txt` |
| adapter / build artifacts | 依赖边界通过，32 包公共导出可导入 | `adapter-boundaries.txt`、`build-artifacts-final.txt` |
| 独立 PG | 旧目录315、新目录803、strict publication69；49 单测 PASS | `storage-independent-review.md`、`../p6-02-gift-browse/` |
| 完整新轮 `run-4` | 七语28单元、196核心页面、额外越界页1、199 PNG；506键盘目标、8对话框、28延迟搜索焦点；axe violations/incomplete/pageerror均0 | `run-4/report.json`、`browser-final-summary.json` |

实际执行 Node 24.20.0、Chrome 153.0.8010.53，原生 PostgreSQL 18.6；数据库检查使用 `POSTGRES_TEST_BIN`。完整入口：`node scripts/accessibility-runner.mjs --output output/checks/p6-02-accessibility/run-4`。前台是正式 Next 构建，后台是本地 Next 开发模式。完整脚本成功 stop/reset 自有 TEST 数据；临时 Chrome profile 已删除，cleanupFailures 空。

真实 200% 证明：同物理窗体 1710×929，CSS viewport 从1710×842变为855×421，DPR从2变为4；100%/200% PNG同为3420×1684。未用 CSS zoom 或缩窄模拟视口冒充缩放。七个原生缩放单元均执行。

首个单元完成一笔真实独立 TEST PSP 签名支付、独立邮件一次性授权、私密留言审核、准备和送达。其余单元各自完成键盘加购/结账表单，并仅在内存中复用真实短期授权检查已付款订单。不能称为28笔支付或28次独立邮件交换。实际 daily 发布七语投影49项通过；PG故障测试是在正常真实发布后的 SQL 返回叶子模拟缺译，未修改不可变发布行。

## 保留失败与复核

- `run-1` FAIL：验收工具与邮件授权后的自动刷新竞争。增加真实延迟刷新失败测试后修正等待。
- `run-2` FAIL：工具在临时 PAID 渲染后抢在规范订单路径 replace 前再次导航。真实 Chrome 延迟跳转测试先红后绿；产品授权/期限未放宽。
- `run-3` FAIL：后台同页搜索卸载焦点控件，且工具操作旧搜索行。产品最小修复与本次真实请求/结果/焦点门共同解决；`run-3-diagnostics/` 保留 RED/GREEN。仅诊断副本刷新一行，不改原冻结报告。
- 最终接受使用全新 `run-4` 自身完整 PASS，不拼接前三轮局部结果。前台、存储及工具非作者报告在本目录；独立审查发现的清理中断问题也已通过各资源失败注入验证关闭。

## S.U.P.E.R

1. 新模块按合同、应用、仓储、HTTP/BFF、目录与验证职责拆分。
2. 分页复用已有独立组件；复杂验证步骤分为浏览、邮件、搜索、清理等单一用途。
3. 业务依赖保持 Route → Application → Port → Adapter，前台只消费公开合同。
4. workspace/domain/adapter 门未发现循环或反向依赖。
5. 新跨边界输入输出均有 Zod/schemaVersion，旧合同逐值兼容。
6. API/port/验证证据可序列化；会话仅在工具内存，不进入报告。
7. 生产来源、市场与支付由配置决定；无新生产域名、艺人、币种或密钥常量。
8. 无新增依赖或锁文件升级。
9. 无价格的浏览仓储与界面可分别替换，购买路径保持原边界。
10. 受影响与全仓质量、真实 PG、完整本地浏览器范围均通过；外部门明确保留。

## 交接与范围

原8017未跟踪文件逐SHA不变，私有用户配置SHA不变；持久实例 `acceptance-e143d720dd1a4357a3c3` 已恢复且四服务 ready。原实例中文首页有效 TEST CA 的只读 HTTP 检查200，已上架礼物直接出现且没有 cart cookie。最终秘密扫描 exit0（`secrets-final.txt`）；`source-final-comparison.json` 确认2782执行输入与run-4的路径/字节/mode及新增删除均一致，仅5份进度/运行文档变化。`verification-index.json` 汇总全部最终门。

P6-02 在本地自动范围接受后仍保持 IN_PROGRESS，等待真人 VoiceOver/NVDA、七语人工理解与读屏等原门；不增加 DONE。P6-03 原依赖就绪复核见 `p6-03-readiness.md`；本轮已获独立 ACCEPT、Lane D 已释放，P6-03 已登记有限本地 READY 且尚未领取；RUM、真实商户、正式内容、云/staging/灰度和远端CI均未由本轮代签。只本地提交，不 push。

后续复验入口见 `docs/operations/accessibility.md`。复现时先区分请求/导航未稳定与产品缺陷，保留原失败，不用扩大等待或跳过焦点门掩盖问题；本次后台缺陷须继续由实际延迟请求覆盖。
