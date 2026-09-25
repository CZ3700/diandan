# P3-05 — 礼物浏览前台验收

本目录记录 `codex/p3-05-gift-storefront` 相对本地 `4c7adf15dbb0933d3afea382f4a6f333b8b0b7e5` 的实现与验证。P3-05 已完成本地验收，状态 DONE；最终命令退出码及证据索引见 `validation.json` 和 Phase 3 验收记录。

最终完整 `pnpm check` 于 2026-09-07T08:48:57Z 整条 exit 0，真实 PostgreSQL/HTTP/TLS S3/媒体 worker、格式、lint、类型、测试、构建与 31 包出口导入全部通过。最终 typecheck/test 各 58/58、build 35/35，均复用已通过缓存；另有最终同源完整冷测试 58/58、0 cached。首轮 exit 1 和测试超时反证保留，详见下文。七语言双端完整浏览器为 55 PNG、8 场景组、10 axe 零违规/零 incomplete，全部 1,428 源码输入指纹一致。

## 交付与边界

- 七语言礼物目录使用真实 PostgreSQL 发布投影，提供结果数、服务端分页、分类/可售状态/金额筛选与艺人范围和价格排序。URL 支持刷新和后退恢复；桌面筛选栏与手机抽屉沿用原色黑金视觉。
- 礼物详情包含完整彩色图片、受审七语描述/结构化详情、艺人搜索选择、规格、实际价格与数量限制、工作室转交说明和真实发布政策。未选市场时明确选择数据库配置的市场/币种，不按语言猜测地区。
- VIRTUAL/PHYSICAL/WISH/MERCHANDISE/OTHER 与 TRACKED/PROCURE_ON_DEMAND/PREORDER 独立。TRACKED 展示单一有效位置实际最大可用量；按单准备和预售不需要伪造现货记录。选中暂停/不适用艺人或无效规格时保留明确不可用状态，不悄悄替换。
- 所有礼物由工作室准备或采购后转交艺人。完整购物车、加密 support_intent、库存预留、支付与履约事务属于 Phase 4；本轮结算入口保持明确不可用，不生成假订单。
- 两条新增公开 GET 和五个 schemaVersion 合同根采用 Route → Application → Domain → Port → PostgreSQL。实际数据库保持唯一真相源，无迁移或新外部依赖。旧 373 合同根及全部原 HTTP operations 深比较不变；总 378 根、117 OpenAPI schemas。
- 政策缺失/失效/失败时拒绝显示正文；关键政策不做英语 fallback。严格 server reader 拒绝错误状态、scope/locale/entity/recipient 失配和目录 cardinality 错误，无用户 Cookie 转发和通用 503 英语重试。

## 重跑入口

所有 pnpm 命令使用 `mise exec node@24.20.0 -- corepack pnpm`。

- `--filter @fan-support/storefront test`：页面/URL/渲染/读取器回归。
- `--filter @fan-support/api test:postgres:gift-storefront`：真实 PG、HTTP、TLS S3 和媒体 worker 协议。
- `--filter @fan-support/api test:browser:gift-storefront`：编译后的 Next 与七语言双端 Chrome 交互。
- `--filter @fan-support/api preview:gift-storefront`：独立 TEST 数据预览，进程/信号生命周期见浏览器证据 README。
- `python3 output/checks/p3-05-gift-storefront/verify-compatibility.py`：深比较旧合同和 HTTP 定义。
- `python3 output/checks/p3-05-gift-storefront/capture-source.py --verify`：验证最终源码输入快照。
- `mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs`，然后 `verify-ui-motion-browser.mjs`：顺序更新真实共享浏览器证据。
- `python3 output/checks/p3-05-gift-storefront/run-full-check.py`：实际完整 `pnpm check`；保存再恢复历史 P3-04 HTTP 证据，旧备份存在时拒绝覆盖。再次执行应先核对并归档已有记录，不删除历史结果冒充首次运行。

## 审查与诊断

- `backend-read-README.md`：后端 53 个受影响测试、严格读取与真实 PG DOMAIN 数组问题。
- `directory-evidence.md`、`purchase-context-independent-review.md`：分页筛选与独立 SSR 验证。
- `frontend-final-review.md`：后端作者对前台的交叉审查。
- `test-maintenance-review.md`、`delivery-review.md`：最终测试维护、交付文件和进度的非作者复核。
- `compatibility.json`、`implementation-source-final.json`：合同兼容与最终源码绑定。
- `output/playwright/p3-05-gift-storefront/`；每次失败与成功浏览器运行单独保存，短 smoke 不替代完整矩阵。

真实联调暴露了 node-pg 对 `currency_code[]` 的 DOMAIN 数组映射：原聚合返回字符串而严格合同要求数组。已通过真实 PG 最小探针复现，仅把聚合元素转换为 text，未放宽业务筛选或 schema。浏览器还发现政策导航同名与规格链接缺少 group 语义，均先增加失败测试再修复。独立复核还修正跨礼物卡片与首页推荐入口的旧 variant 串带。真实浏览器另证实非 BFCache 的 Back 导航可恢复旧 select 值而 URL/卡片已恢复，诊断没有混称 BFCache。其他早期构建/夹具错误及失败尝试保留在本地日志和单独结果文件中；不将测试预期调整混称业务修复。

## 证据限制

TEST 夹具通过实际管理会话、七语言作者/独立审核、发布、价格簿与库存流水创建；使用仓库内虚构素材，未冒充正式艺人或商品。真实夹具已有有效价格，无价分支另有 Domain/SSR 测试，不能宣称真实 HTTP 穷尽所有失败原因。UI 翻译 review manifest 仍为 DRAFT，正式人工批准没有被伪造。

所有浏览器尺寸均为本机 Chrome 模拟，不是新物理手机证据。性能是本机未限速观察，正式 SEO/缓存/运营计时与性能预算属于 P3-06；真实经营市场、正式素材/条款/译审、PSP、staging、生产发布和小额真实交易未在本轮完成。仅本地提交，按用户决定最后统一推送 GitHub。

## S.U.P.E.R 逐项依据

| # | 检查 | 本轮依据 |
|:--|:--|:--|
| 1 | 模块单责 | 新合同、纯 offer 规则、读事务、SQL 映射、公开路由、BFF、目录、详情、选择器与内容渲染分别负责一个概念 |
| 2 | 函数单责 | 解析/导航/排序/展示分离；请求内读取缓存集中于 gift-page-reads，未扩大旧页面工厂职责 |
| 3 | 单向数据流 | Browser/Route → Application → Domain → Port → Adapter，前台通过 HTTP 获取可序列化投影 |
| 4 | 无循环依赖 | 类型从 contracts 向外导出；服务器 cache 不反向依赖页面组合；domain/adapter gate 核验 |
| 5 | 合同接口 | 五个新 Zod 根带 schemaVersion；外部输入/输出严格 parse，原 373 roots 深比较不变 |
| 6 | 可序列化 | Route/Application/Port DTO 为 schema 定义的数据；Pg/React/URL 等实例不跨业务端口 |
| 7 | 外部配置 | 市场/币种/价格/政策/艺人与商品由数据库证明；源站、媒体 origin 和运行密钥复用既有配置 |
| 8 | 依赖明确 | 无新增第三方或 SaaS 依赖；复用仓库已声明的 IntlMessageFormat、UI、PG 与媒体链路 |
| 9 | 模块可替换 | 通过 Port/严格 HTTP DTO/受控 React props 组合；域规则不依赖 Next 或 node-pg |
| 10 | 验证通过 | PASS：完整冷测试、真实协议、七语双端浏览器、全仓 check、secrets/diff 和源码冻结一致；详见 validation.json |

Focus-oracle follow-up: the mobile Tab diagnostic identified Base UI's `data-base-ui-focus-guard` with `data-type="inside"`, followed by focus inside the still-open dialog after two animation frames. The new browser harness now follows the repository's existing P2 rule: reject ordinary outside focus immediately; allow only that identified internal guard at most 500 ms to return inside; fail on timeout. This changes the test oracle only, not the shared dialog or product behavior. `filter-focus-diagnostic.json` preserves the observation.

## 全仓门禁维护与反证

第一次完整 `pnpm check` 的真实 PG/HTTP/TLS S3/媒体 worker 前缀全部通过，之后停在新 browser harness 的一处 Prettier 换行（`check-full-result.json` exit 1）。`browser-format-diff.txt` 保留精确格式差异。没有把这个失败标成整条通过。

继续执行尾部发现合同测试两项失败（`core-tail.log`）：严格 HTTP path 清单漏了本任务两个新增接口；首个完整文档确定性测试超过原 5 秒。清单只加入这两个真实接口，保留严格 `toEqual`；首次动态 import 移到文件级，完整测试正文、两次独立 render 和字节 freshness 检查不变。单文件六测试 1.48 秒通过，但第二次全仓并行仍有 7,340 ms 超时（`core-tail-final.log`），证明只移出 import 不足以处理该波动。

本机 10 个逻辑 CPU；安装的 Vitest 4.1.11 默认单包最多 9 个 worker，外层 Turbo 又并行运行多个包。随后仅在 `packages/contracts/package.json` 将该包测试 worker 上限设为 2；其余包、所有断言、测试集合与默认 5 秒时限不变。受控复跑 `turbo run test --force --output-logs=errors-only` 为 58/58 tasks、0 cache、36.735 秒 PASS；合同包 52 files /319 tests PASS（`contracts-full-cold-green.log`）。这支持当前环境下的并发资源问题与该范围修正，不声称所有机器从此不会有波动。

最后 format、lint、typecheck、35 包 build、adapter boundary 和 31 exports 导入均通过（`core-final-build.log`）。完整浏览器和共享 P2 指纹按最终源码重新验证后，实际执行 `python3 output/checks/p3-05-gift-storefront/run-final-check.py`，独立 `check-final-result.json` 记录最终整条 check exit 0（08:34:37Z 至 08:48:57Z）。`check-final-summary.txt` 保留可提交的门禁摘要；原始日志按仓库规则只留本地，其 SHA256 写入 validation。原失败记录和 P3-04 初次/再次回归结果均保留，旧检查点原字节已恢复并核验。

本地验收结束后，项目为 22 DONE /1 READY /26 PENDING，共 49；Phase 3 仍 ACTIVE（5/6），Lane B 释放，P3-06 READY 且未领取。Phase 4 仍 LOCKED。本轮只保存本地检查点，不推送或合并 GitHub。
