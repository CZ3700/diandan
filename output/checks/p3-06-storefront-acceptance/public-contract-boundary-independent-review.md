# 公共合同模块拆分独立复审

结论：**ACCEPT（源码兼容与静态模块边界）**。复审者 `/root/storefront_read`，非作者，只读源码；未改合同、构建产物、package、index 或启动浏览器/Next。

审查范围为 `catalog-directory.ts` / `catalog-directory-public.ts`、`locale.ts` / `locale-values.ts`、两份 boundary tests 和 `test-support/module-boundary.ts`。

- 独立从 `git show HEAD` 读取拆分前源文件，两个旧文件 SHA 与作者落盘 baseline 完全一致。TypeScript AST 提取的目录 26 项、locale 13 项变量/函数/type 定义在新旧两个模块的并集中逐字相同，声明总数也一致：`public-contract-boundary-independent-values.log`。
- 旧目录入口通过同绑定 re-export 暴露原 schema；cursor、snapshot 与内部 projection 的依赖仍保留在旧核心入口。公开 DTO 的严格对象、分页限制、offer refinements、错误枚举未改变。
- 七语常量、native names、默认语言、严格 `Intl.getCanonicalLocales` 解析只保留一个实际定义，原 locale schema 从该单一来源导入。没有第二份 locale 数组或 schema 的弱化。
- `index.ts`、package 和两份已生成文档 SHA 与拆分前 baseline 一致。此项是当前磁盘值比较；本复审没有重新生成 382 roots / 120 schemas。作者已有生成一致性测试结果独立记录，不混同为我重新执行。
- 轻量独立运行 `pnpm --filter @fan-support/contracts test src/catalog-directory-boundary.test.ts src/locale-boundary.test.ts`：2 files / 9 tests PASS，日志 `public-contract-boundary-independent-tests-green.log`。第一次直接使用错误 config 相对路径的启动失败保留在 `public-contract-boundary-independent-tests.log`；没有执行业务断言，修正为仓库已有包命令后通过。
- testsupport 只被两个测试导入，未进入公共 index/artifact root。边界检测从导出实际声明模块出发并排除 erased type edges，符合本次目的。

限制：这些检查证明新的 leaf 不必依赖内部投影模块、纯 locale 值不依赖 Zod。旧 barrel 的实际运行时加载仍取决于编译器 tree shaking；测试不是浏览器网络包体报告，不能据此声称脚本字节或 LCP 已下降。真实 bundle/Lighthouse 由 root 后续同输入重新验证。
