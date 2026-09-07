# 公共目录与 locale 依赖边界拆分

2026-09-08，作者 `/root/storefront_directory`，root 授权的两阶段最小试验。**定向源码与兼容性验证 PASS；尚未重新构建或测量 bundle，不宣称首屏 JS 已减少或性能门已通过。** 非作者复核单独由 `/root/storefront_read` 提供。

原始问题证据见 `initial-js-readonly-diagnostic.md`：实际生产 chunk `3k-20c3y8y-2r.js` 为 85,933B gzip，包含 Zod 及 62 个错误语言导出；目录客户端依赖的混合 chunk 保留了内部 publication/projection 校验初始化。该原始 bundle 是拆分前的实测依据，不是新源码的测量结果。

## 修改范围

- `packages/contracts/src/catalog-directory-public.ts`：承载既有 catalog version、公开 offer/failure、艺人/礼物目录 response 及其类型；原 schema 声明原样移动。
- `catalog-directory.ts`：保留内部 record/snapshot、cursor、read command；从上述文件导入共享对象并重导出原公开名称。同一对象供内部 snapshot 与外部 response 引用，不创建第二份合同。
- `locale-values.ts`：唯一 canonical 七语言数组、默认语言、母语名称、SupportedLocale 类型、原 `parseSupportedLocale` 和私有查找集合；该叶子模块没有 import。
- `locale.ts`：继续定义 Zod locale/schema context，从纯值文件读取同一绑定并重导出旧名称。
- `catalog-directory-boundary.test.ts`、`locale-boundary.test.ts` 与私有 `test-support/module-boundary.ts`：沿旧导出追踪实际声明位置和运行时 import/re-export 边，忽略 type-only import；验证输出模块不再初始化 publication/projection、纯值不再加载 Zod，并验证旧出口名称及对象身份。helper 没有进入产品 import、package exports 或 artifact registry。按现有 tsconfig，它可能产生不可由 package exports 访问的私有 dist 文件；没有新增产品入口。

未改 package/index、应用入口、编译配置、旧合同 schema 规则或生成物。未做 Zod Mini 迁移、namespace 全仓改写、PURE 标记、动态可信对象或 schema 校验删除。canonical ownership 检查以整个 contracts 包为唯一所有者，未改 checker 或添加例外。

## RED → GREEN 和兼容性

1. `public-contract-boundary-red.log`：2 files，**6 failed / 1 passed**。两个公开 response 的真实声明依赖可达 `public-projection.ts`；四个纯 locale 导出的真实声明依赖可达 `zod`。失败发生在明确断言，不是新文件不存在或 import 启动错误。
2. 第一阶段 `public-contract-directory-green.log`：目录拆分后 **3 files / 8 tests PASS**；既有目录金额、未知字段、游标及查询负例保留。
3. 第二阶段 `public-contract-boundary-green.log`：**7 files / 27 tests PASS**，含现有 artifact renderer 对当前两份生成物的逐字节校验。
4. 最终 `public-contract-boundary-final-tests.log`：**10 files / 50 tests PASS，1.87s**，补齐 locale、presentation、envelopes、目录/discovery、artifact registry/documents、SEO 及新边界/对象身份测试。命令如下。

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/contracts exec vitest run --config ../../vitest.config.ts --root . src/catalog-directory-boundary.test.ts src/locale-boundary.test.ts src/catalog-directory.test.ts src/catalog-discovery.test.ts src/locale.test.ts src/presentation.test.ts src/envelopes.test.ts src/artifact-documents.test.ts src/artifact-registry.test.ts src/storefront-seo.test.ts --maxWorkers=2
```

`public-contract-boundary-types.log`、`public-contract-boundary-lint.log`、`public-contract-boundary-format.log` 分别记录 contracts typecheck、7 个独占文件 ESLint 与 Prettier，均 exit 0。没有运行 build、Next、浏览器、全仓检查或重写任何旧失败结果。

`public-contract-boundary-baseline.json` 是修改前当前工作区 SHA/长度。`public-contract-boundary-compatibility.json` 进一步核实：

- HEAD 中这两个原源码文件的 SHA 确实等于修改前基线，才将其作为原声明来源；没有把 root 现有 P3-06 生成物替换回 HEAD。
- 原 `catalog-directory.ts` **26 个声明**、原 `locale.ts` **13 个声明**，含私有 helper/type/函数，在旧文件与新叶子中逐项保持源码字节相同。
- 当前 `contracts.schema.json` 的 **382 roots**、`openapi.json` 的 **120 schemas** 及完整文件 SHA 与拆分前相同；index/package 也未变。现有测试使用新源码重新 render 后仍与两个完整生成文件字节相等，覆盖原 378 roots 和本轮已经新增的合同，不靠更新 snapshot 过关。
- 原目录 14 个运行时导出、locale 6 个运行时导出名称不变，新叶子与旧出口逐项 `toBe` 相同绑定；纯值冻结和 locale parse 原行为保留。

## 交付边界与下一步

静态测试证明了**新叶子的依赖隔离**，不是对 Turbopack 最终 shaking 的保证。客户端仍可能通过其他 eager schema 或 UI 引入 Zod；实际 import 接线及新编译资源对照由 root 后续统一执行。公共目录叶子仍按原合同引用 catalog/discovery/media/content 的必要解析，未扩大本次范围去拆所有 authoring/scalar 定义。

`parseSupportedLocale` 原实现会 canonicalize 大小写，而 `supportedLocaleSchema.parse` 只接受精确 canonical 值；这次两者行为均未改。后续若客户端用纯 parser 替换 schema 校验，必须显式保留调用点原有的严格程度，不能把 `EN` 等输入意外放宽。

本次 S.U.P.E.R：1–2 职责拆清、原函数/规则不变；3–4 public leaf 不反向依赖内部记录，locale 单向引用纯值，无新增环；5–6 schema/可序列化业务 I/O 不变；7 单一 locale 源、无部署硬编码；8 无新依赖，测试复用根已有 TypeScript；9 旧出口同绑定可替换；10 上述定向检查通过，最终全仓和新产物/性能验收仍待。源码与本证据冻结后交 root 调度。
