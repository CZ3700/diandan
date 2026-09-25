# Locale interaction guard 独立复审

审查者：`/root/storefront_directory`。范围仅为相对 HEAD 的 `scripts/check-ui-interactions.mjs`、`scripts/check-ui-interactions.test.mjs`；未修改产品或 checker 源码，未运行构建、浏览器或全仓测试。

## 首次结论：需要修复调用绑定检查

原提交的 59 项测试及实际仓库扫描独立通过，但公开 presentation adapter 的调用绑定检查存在可复现的遮蔽缺口。`hasCanonicalPresentationBindings` 检查函数体中的 `requireCanonicalLocale` binding，却不检查参数，也不检查 `createPresentationLocaleUrl` 函数体中的 `leadingLocale` binding。以下三种仅施加于临时 fixture 的变换均错误返回零错误：

1. 给 `leadingLocale` 增加默认参数 `requireCanonicalLocale = (value: unknown, _message?: string) => value`，使源语言 helper 调用解析到参数。
2. 给 `createPresentationLocaleUrl` 增加默认参数 `leadingLocale = (_pathname: string) => undefined`。
3. 在该函数的源语言检查后声明 `function leadingLocale(_pathname: string) {}`，通过函数提升遮蔽真实顶层函数。

三例的未修改 fixture 和修改后 fixture 均返回 `[]`。这是静态门缺口；当前产品 adapter 不包含这些变换，不能把该诊断称为当前产品已经接受无效语言。最小建议是检查三个既定函数的参数 binding，并拒绝 `createPresentationLocaleUrl` 内部对 `leadingLocale` 的遮蔽；不需要引入通用 AST 执行器。

## 已独立验证的保留范围

- canonical leaf 必须为唯一顶层导出的冻结静态七语言数组，顺序固定；旧入口通过实际同名 value import/re-export 连接该 leaf，type-only、错来源与错 alias 不满足要求。
- `supportedLocaleSchema` 必须通过实际 `zod` 导入的 `z.enum(SUPPORTED_LOCALES)` 构造；注释不能替代 AST。
- `requireCanonicalLocale` 的实际解析、undefined 或非精确值的 TypeError 拒绝及最终返回均为受检语句；catch、null、仅规范化与注释诱饵不能满足固定 helper 结构。
- 独立 AST 文本对比确认原有 43 个函数完全相同，只有三个有意入口函数变化；原 `internalSource` 分支文本完全相同。既有 internal en-XA、Cookie 属性、query/hash URL clone、overlay、Base UI、焦点及 motion 门没有因此获得例外。

## 独立证据

- `locale-guards-independent-tests.log`：`node --test scripts/check-ui-interactions.test.mjs`，59/59 PASS。
- `locale-guards-independent-scan.log`：`node scripts/check-ui-interactions.mjs`，实际仓库扫描 PASS。
- `locale-guards-shadow-diagnostic.log`：上述三个临时 fixture 反例；原文件未修改，临时目录均清理。失败事实保留，等待作者最小修复后的复核。

以上使用已固定 Node 24.20.0，经 `mise exec` 执行；仅这些有界检查，不代表最终全仓检查、性能预算或真人验收通过。原始日志留在本地，检查点候选保留本摘要。

## 最终结论：ACCEPT（遮蔽修复后）

作者随后只修改同一 guard 和对应测试。三个既定函数现在必须匹配准确参数数量和名称，不能增加默认值、optional 或 rest 参数；`createPresentationLocaleUrl` 函数体也不能声明另一个 `leadingLocale` binding，故后置提升声明不能再替代受检的顶层函数。原 first-statement/源 pathname/目标 locale/Cookie helper 调用约束继续存在，没有跳过先前失败反例。

作者证据 `locale-interactions-shadow-red.log` 保留 7 FAIL / 59 PASS，修复后 `locale-interactions-shadow-green.log` 为 66/66 PASS；新增七项覆盖本次三个原始反例、Cookie 参数遮蔽及 default/optional/rest 参数。作者 scoped lint、format 和实际门均通过，日志使用 `locale-interactions-shadow-` 前缀。

修复后本审查者独立执行：

- `locale-guards-independent-tests-after-shadow.log`：66/66 PASS，0 skipped，exit 0。
- `locale-guards-independent-scan-after-shadow.log`：实际仓库扫描 PASS，exit 0。

复读补丁未发现本次限定范围内的剩余必要修复。原始 REQUEST_CHANGES 及三个反例诊断仍完整保留；最终接受仅适用于以下精确两文件，不把并行运行的全仓检查冒称为已经使用此次补丁，也不推导浏览器或性能结论。

- `scripts/check-ui-interactions.mjs`：`7db946fb0986da8c58934045da0361b4f81ee75871e2c0bebe8123761b128a05`
- `scripts/check-ui-interactions.test.mjs`：`44b54c9425e7a7c497a3603ab38d8230b3a519526e653040fe6c1b3aecf4e213`

审查源码冻结；本审查只写本文件、独立日志及候选清单，没有暂存或提交。

## 追加：0020 commerce 回退目标只读复核

Root 随后报告全仓 check attempt 4 在旧 `postgres-gift-commerce.mjs` 的回退拒绝测试失败：新增 0021 后，`manifest.at(-1).down.sql` 已经不再选到该测试意图检查的 0020 commerce 回退脚本。独立读取当前 diff 确认唯一改动为按 `version === "0020"` 精确查找，与现有 admin-catalog harness 的目标选择方式一致；BEGIN、错误码 55000 判定、finally ROLLBACK 和原历史拒绝断言均原样保留。

`0020_gift-commerce.down.sql` 开头在 identity/classification 的破坏操作前拒绝已有 receipts 或 v2 revision；后续在 commerce DDL 前拒绝 price/inventory receipts 或 v2 price history，均使用 55000。原测试必须执行这个版本，0021 的 purge guard 回退不能替代此保护。SQL 和业务代码未改。只读扫描 `scripts`、apps/packages scripts 中其余 `.at(-1)` 和 migration down 选择，没有发现另一处把当前末项误当固定历史版本的用例。

这一处源码复核 ACCEPT；实际 PostgreSQL 重跑由 root 串行执行，本审查未运行，不能以静态复核推导真实 PG PASS。冻结文件 `packages/persistence-postgres/scripts/postgres-gift-commerce.mjs` SHA-256：`503e6a2fa6e29fb2216500fdcccbcb9fb07e47914d0fc8dd68439ed5573738e7`。
