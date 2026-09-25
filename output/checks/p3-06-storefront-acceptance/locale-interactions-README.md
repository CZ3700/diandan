# Locale interaction guard：迁移与验证

作者 `/root/storefront_read`；仅修改 `scripts/check-ui-interactions.mjs` 与对应 `.test.mjs`，源码已冻结，独立复审由 root 调度。本记录不是作者对自身实现的独立验收。

此前 guard 把 `locale.ts` 当作 `SUPPORTED_LOCALES` 的本地声明源，并要求公开 presentation adapter 两次直接调用 `supportedLocaleSchema.safeParse`。纯值/公开 helper 的已验收拆分保留了业务行为，但使这两个源码位置假设失效。

现 guard 直接读取真实 `locale-values.ts`：顶层导出的唯一 const 必须是冻结静态数组，七语内容及顺序保持。旧 `locale.ts` 必须 value-import 同名 binding、不能被本地声明覆盖，四个原公开值必须从该 leaf 作非 type 的同名 re-export；`supportedLocaleSchema` 仍须由实际 `zod` 的 `z.enum(SUPPORTED_LOCALES)` 生成。注释、类型导出、错 alias、其他来源和错误 enum 均不能替代这些 AST 关系。

公开 presentation guard 校验实际 `canonical-locale` import，helper 必须调用合同解析器并对 undefined 或 `parsed !== value` 抛 TypeError，再返回 parsed；源 pathname、目标 locale 和 cookie 均须沿实际函数调用经过该 helper。没有实现通用 AST 执行器。原内部 `en-XA` / safeParse 分支、cookie 属性、query/hash clone、LanguageControl、Base UI、焦点、reduced motion 等门保留。

## 测试与检查

- `locale-interactions-red.log`：57 tests，**14 FAIL / 43 PASS**。真实 split fixture 被旧位置假设拒绝；新绑定/缺 leaf/helper 反例未获得相应拒绝。部分原规则已经能拒绝错误七语/enum，用例通过不冒充 RED。
- `locale-interactions-green-first.log`：57/57 PASS。
- `locale-interactions-empty-red.log`：59 tests，**1 FAIL / 58 PASS**。空 presentation 函数使 AST 访问抛 TypeError；修复为正常错误结果，注释不能代替实际声明。
- `locale-interactions-green.log`：**59/59 PASS**。原 39 个测试保留；原 presentation 校验测试按当前 helper 调整同一绕过点与诊断，Cookie 断言不变。没有降低断言或跳过用例。
- `locale-interactions-gate.log`：实际仓库 `node scripts/check-ui-interactions.mjs` PASS。
- `locale-interactions-lint.log`、`locale-interactions-format.log`：仅上述两个文件，exit 0；`git diff --check` exit 0。

以上命令通过 `mise exec node@24.20.0 --` 执行；测试为 `node --test scripts/check-ui-interactions.test.mjs`，格式与 lint 使用现有 pnpm prettier/eslint。没有执行 build、Next、浏览器、完整仓库检查或修改共享 fingerprint 脚本。

作者另作只读 AST 对比：除 `validateCanonicalLocaleSource`、`validatePresentationLocale`、`validateUiInteractions` 三个有意修改函数外，原有 **43 个函数源码文本相同**；`validatePresentationLocale` 的原 internalSource 分支文本也完全相同。没有因此重新宣称 P2 实际浏览器或性能通过。

冻结 SHA-256：

- `scripts/check-ui-interactions.mjs`: `be0d6af27a1df0f6f075fb821023d8108efab9a8795d09c5ca018c0273a9ad5e`
- `scripts/check-ui-interactions.test.mjs`: `e469f48c68cedefc13ee3118268c76b41a437b3ee78b4a89a3f5a43a139541e2`

以上是首次 59 tests 版本的历史 SHA；随后独立复审提出必须修复的 binding 遮蔽问题，最终版本以以下追加为准。

## 独立复审后的参数遮蔽修复

目录代理实际复现三种绕过：`leadingLocale` 的同名 helper 参数、`createPresentationLocaleUrl` 的同名 source-check 参数，以及该函数体内后置的 hoisted `leadingLocale` 函数。初始 `REQUEST_CHANGES` 和实际诊断保留在 `locale-guards-independent-review.md`、`locale-guards-shadow-diagnostic.log`，不以初次 59 tests PASS 掩盖遗漏。

最小修复只在既有 `hasCanonicalPresentationBindings` 中限定三个已审核适配函数的准确参数数目/名称，禁止 default/rest/optional 参数，并检查 createBody 不能另行声明 `leadingLocale`。没有新通用解释器或产品行为修改。

- `locale-interactions-shadow-red.log`：**7 FAIL / 59 PASS**，包括上述三例、cookie 同类遮蔽及 default/optional/rest 反例；全部是基线成功后实际变异通过旧门的有效 RED。
- `locale-interactions-shadow-green.log`：**66/66 PASS**，原 59 项继续保留。
- `locale-interactions-shadow-gate.log`、`locale-interactions-shadow-lint.log`、`locale-interactions-shadow-format.log`：实际仓库交互 gate 与两个文件的 lint/format 均 exit 0，scoped diff check 通过。

源码再次冻结并交目录代理独立复审。根正在执行的完整检查按其实际读入版本记录，不能把它当作最终一致源码的完整通过。

最终 SHA-256：guard `7db946fb0986da8c58934045da0361b4f81ee75871e2c0bebe8123761b128a05`；test `44b54c9425e7a7c497a3603ab38d8230b3a519526e653040fe6c1b3aecf4e213`。

## 其余脚本只读扫描

同因需同步的另一门是 root 独占的 `check-design-foundations.mjs`（原 1606/1623 读取路径、295–342 静态声明解析）与 fixture；本代理未修改。`check-contracts.mjs` 从运行时 contracts 导出读 canonical 值，并保持 contracts 外重复归属扫描，不要求旧文件本地声明，无需修改。`verify-ui-composites-browser` / `verify-ui-motion-browser` 中的 presentation 路径是输入指纹，不是声明解析门，未修改。已扫描 root `scripts` 与 apps/packages 的脚本，未发现 `catalog-directory.ts` 本地声明的其他硬假设；合同边界测试已实际沿 named re-export 定位声明并检查同 binding，保留原实现。
