# P3-01 首个检查点：目录发现、构图与多语详情

日期：2026-09-05；Owner：Codex `/root`。用户已接受 V2 开发视觉基线并授权进入 Phase 3；方案和任务归属见 `docs/decisions/009-catalog-discovery-localized-authoring.md`。

## 当前成果

- 16 个新增 versioned 根合同及同源 JSON Schema/OpenAPI components；旧 155 个定义逐对象深比较完全不变，旧 gift.description/发布门/数据库未修改。
- 艺人查询的分页窗口、cursor/anchor 输入、名字搜索规范化和唯一排序计划；保留 Unicode 附标并处理规范化扩展，不获取全部艺人数组冒充数据源。
- 礼物页码/分类/金额/可售状态与升降价排序计划，筛选改变回第一页，语言改变保持 market/currency；越界页面及分页上限有一致元信息。
- 包含 locale、market、currency、筛选、页码和服务端目录版本的哈希缓存标识；实际缓存/CDN consumer 尚未接入。
- 固定角色 master 的 COVER/CONTAIN 几何规划，焦点/完整保留/中性衬底，不拉伸或放大；异常输入只返回校验失败。此为构图计划，不是已编码的图片或发布资格。
- 五类受控详情块及稳定 block/item ID；语义结构/媒体/文字 hash、当前英文源与审核字段校验；有效草稿不等于可发布。

## 验证

| 检查 | 实际结果 | 证据 |
|:--|:--|:--|
| RED → GREEN | 新查询、几何、详情、缓存与注册测试先失败后通过 | 当前任务工具记录；后续独立反例有回归测试 |
| 受影响测试 | contracts 176、catalog 8、content 84，共 268 通过 | `targeted-tests.log` |
| 完整 pnpm check | exit 0；format/lint/typecheck/test/build/边界/生成物通过 | `check.log` |
| Turbo | typecheck 51/51（30 cached）；test 51/51（23 cached）；build 34/34（23 cached） | `check.log` |
| PostgreSQL | 本地真实 9 migrations/108 tables、并发事务、持久事件/有限重试回归通过 | `check.log`；不是新增内容 API 的集成证据 |
| 对象存储 | 真实本地 TLS S3-compatible 授权上传/读取/CORS/篡改边界回归通过 | `check.log`；没有新增媒体处理 worker |
| 浏览器 | P2-04 16 场景/18 PNG/10 axe，P2-05 8 场景/22 PNG/3 axe，全通过；critical/serious 0 | `output/playwright/p2-04/`、`output/playwright/p2-05/` |
| 静态安全 | secret scan、git diff --check 通过 | `secrets.log`；当前任务命令结果 |
| 独立评审 | 三个真实反例修复并复验；最终 268 tests 与 155 旧合同深比较通过 | `p301_foundation_review` 当前任务记录 |

完整检查的前两次失败保留：`check-initial.log` 为共享合同/锁文件变化使旧浏览器指纹过期；`check-typecheck-failure.log` 为目录包 Node 类型配置和测试索引访问不符合 strict TS。分别刷新真实浏览器证据、显式 Node types 并改用真实类型静态导入后，最终整仓命令通过，未放宽质量门禁。

独立复核发现并已修复：Unicode NFC/lowercasing 使合法查询扩展到 240 码点；页码上限仍给无效下一页；Zod 外层几何 refinement 对 0×0 CONTAIN 除零。媒体补充 84 种畸形 plan、168 次 plan/result safeParse 回归。Code-simplifier 复核只将新排序选择改为清晰 switch，并简化新测试的动态类型包装，行为未变。

## 可重复命令

```sh
mise exec node@24.20.0 -- corepack pnpm contracts:generate
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/contracts --filter @fan-support/catalog --filter @fan-support/content test
mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs
mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs
mise exec node@24.20.0 -- corepack pnpm check
mise exec node@24.20.0 -- corepack pnpm security:secrets
git diff --check
```

Browser runners 顺序执行；P2-05 执行期间不要同时写其他源文件或新增证据路径，它会核对 before/after Git 状态。原 iPhone 证据仍属于之前标记的版本，本次浏览器刷新不是新的手机实测。

`implementation-source.json` 固化本轮 25 个新增/修改的实现输入（含生成合同和锁文件），基于当前未提交工作区；`compatibility-and-progress.json` 记录 155 个旧定义不变、新增 16 个定义和 49 个任务的状态计数。没有 Git commit/远端 CI、云部署或生产完成结论。

## 接续边界

P3-01 保持 **IN_PROGRESS**；本检查点不能替代完整运行时任务。下一步依照 `docs/plan/p3-01-content-runtime.md` 检查点 2 接真实 PostgreSQL 内容 repository、公开目录响应、cursor 编解码/版本校验与 additive migrations；随后接身份/权限、实际图片处理、preview、七语言原子发布/回退及 purge/retry。既有严格发布门保持，直到新旧数据/产物迁移与真实集成证明通过。

P3-02 做艺人/媒体/翻译后台，P3-03 做商品详情编辑，P3-04 做艺人横滑/搜索定位，P3-05 做礼物分页/筛选/详情，P3-06 做大样本与七语言综合验收。当前公开/内部页面未新增这些可见控件。
