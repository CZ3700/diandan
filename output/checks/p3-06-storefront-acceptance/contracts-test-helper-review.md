# Contracts 测试辅助模块生产边界修复

作者 `/root/storefront_directory`。根任务限定移动测试工具，不修改 adapter guard、产品合同、package exports 或依赖。

## 真实 RED

完整 `pnpm check` attempt 5 于 2026-09-07 19:00:45.644733Z 开始，19:20:13.418864Z 结束，exit 1；类型检查 58/58、测试任务 58/58、构建 35/35 已成功，随后实际 adapter guard 拒绝 `packages/contracts/src/test-support/module-boundary.ts` 对 `typescript` 的生产依赖。完整证据仍为 `check-attempt-5-result.json` 与原日志，不能称这次完整检查通过。

实施前独立再次运行原样 `node scripts/check-adapter-boundaries.mjs`，得到相同实际失败，保留在 `contracts-test-helper-adapter-red.log`。这个真实生产边界反例是本次修复的 RED。

## 最小改动

- 将本轮新建的 `src/test-support/module-boundary.ts` 移到 `packages/contracts/test-support/module-boundary.ts`；唯一逻辑位置变更为解析源目录 `../src/`，AST 查找和依赖判断逻辑不变。
- `locale-boundary.test.ts` 与 `catalog-directory-boundary.test.ts` 改为从 `../test-support/module-boundary.js` 导入；原九个断言用例保留。
- noEmit `tsconfig.json` 的 `rootDir` 改为 `.`，允许类型检查包含测试所导入的辅助模块；`tsconfig.build.json` 显式固定 `rootDir: "src"`，继续排除测试文件并保持发布目录结构。
- 事前核对 `dist/test-support/module-boundary` 的 `.js`、`.js.map`、`.d.ts`、`.d.ts.map`：两个 map 均指向该本轮 helper，四文件哈希均记录且删除前重新核对。仅删除这四个陈旧生成文件，没有清空 dist 或删除其他编译产物。

## 验证结果

全部命令使用 `mise exec node@24.20.0 --`；执行范围没有全仓重测、浏览器、Next 或 PostgreSQL。

- `pnpm --filter @fan-support/contracts exec vitest run --config ../../vitest.config.ts --root . --maxWorkers=2 src/locale-boundary.test.ts src/catalog-directory-boundary.test.ts`：2 files / 9 tests PASS，`contracts-test-helper-tests-green.log`。
- 完整合同包 `typecheck` 与 `build`：均 exit 0，`contracts-test-helper-types-green.log`、`contracts-test-helper-build-green.log`。
- 原样 `node scripts/check-adapter-boundaries.mjs`：PASS，`contracts-test-helper-adapter-green.log`。
- `node scripts/check-build-artifacts.mjs`：31 package exports 由 Node 实际导入成功，`contracts-test-helper-artifact-green.log`。
- 五文件 scoped Prettier 与三 TypeScript 文件 ESLint：均 exit 0，`contracts-test-helper-format.log`、`contracts-test-helper-lint.log`；scoped `git diff --check` 也通过。

`contracts-test-helper-artifacts-before.json` 记录移动前全部 300 个 dist 文件的字节数与 SHA-256；`contracts-test-helper-artifacts-comparison.json` 记录重建后完整集合比较。**仅四个已确认测试工具产物移除，其余 296 个文件逐字节相同，无新增或变化，也没有生成嵌套 dist/src。** 因而生产运行代码、声明和对应 source maps 均保持原字节。测试工具没有继续进入合同包的生产输出。

## 冻结文件

- `packages/contracts/test-support/module-boundary.ts`：`06f149653a16bb982238657f090a1f8432df28e5da237c90463ff81d51679f13`
- `packages/contracts/src/locale-boundary.test.ts`：`b79f8060a7a8ccebddf6c1f69435cec292a8a3a517b2704ce6abe94a84142559`
- `packages/contracts/src/catalog-directory-boundary.test.ts`：`dc5415ab8bb233d26b6f98f935030252079525ef6c0d00066abd30e3e896395b`
- `packages/contracts/tsconfig.json`：`5bfe75e3ae37f8050a43966aa7966256843f1f26ad0553804e9095bc4b9be1e2`
- `packages/contracts/tsconfig.build.json`：`08b66faf85d5c2040423c362f27c144c14ba71cae1b6189386182a143e6612bc`

原 `packages/contracts/src/test-support/module-boundary.ts` 已不存在。所有当前产品、合同根及生成 schema 文档未因本次移动而编辑。后续 P2 刷新和完整 check 6 由 root 统一执行，此定向 GREEN 不替代其结果；未暂存或提交。

## 非作者只读终审

`/root/storefront_read` 独立结论 ACCEPT：逐 SHA 核对五个冻结文件；将 helper 的 `../src/` 规范回原 `../` 后与浏览器来源 662dcb3e 的 helper 完全一致，两项测试也仅导入位置变化。独立对当前 dist 和移动前 300 项清单重算，只有四个已确认测试工具产物删除，其余 296 项逐字节一致，无新增或变化、无 dist/src。已核读作者九项测试、类型、构建、实际 adapter 与 31 exports 的日志；复审者没有另跑测试、构建或浏览器。

最终 1,540 项实现 SHA256 为 `59ebd051a135110a3cf01b6b22bc5c373f83e41ad2b79a0b07e2dd166fe2a04d`，见 `implementation-source-before-check-6.json`。root 随后刷新 P2-04（26.511s）和 P2-05（37.662s），均 exit 0；完整 check6 独立等待最终结果。
