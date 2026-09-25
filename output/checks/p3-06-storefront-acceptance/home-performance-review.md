# P3-06 首页性能组合拆分

作者：`/root/storefront_directory`。该子任务完成于 root SEO 接线之前；精确 13 个文件的内容快照见 `home-performance-source-snapshot.json`。这不是整个 P3-06 的验收结论。

## 实现范围

- `page-factory.tsx` 仅组合首页、艺人目录和 unavailable。首页文案、已发布 homepage 和初始艺人窗口一起启动，metadata 的独立读取也并行。HomeContent 的 DTO、布局和接口未改。
- 新 `artist-page-factory.tsx` 承接艺人详情及其原 metadata；七语言详情入口改为调用该工厂。invalid handle / NOT_FOUND 仍在返回任何 shell 或 Suspense 边界之前调用 `notFound()`。
- 新 `storefront-page-reads.ts` 保持原有 React request memoization，商务上下文直接复用 `gift-page-reads.ts` 的同一缓存函数。未引入跨请求业务缓存。
- 新 `storefront-page-shell.tsx` 保持 header/main/footer 的 DOM 和查询上下文，只有异步 footer 政策链接置于独立 Suspense 下，正文无需等待商务上下文。页脚静态内容仍直接输出。
- 首页静态相对依赖图中消除了 GiftDirectorySection / gift-filters 的入口；没有使用动态导入来假定 Next 会自动拆分服务器条件分支。

## 文档依据

已读取当前安装的 Next 16.3.4：

- `apps/storefront/node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`：服务器组件自动代码拆分；服务器组件动态导入客户端组件的自动拆分仍有限制。
- `apps/storefront/node_modules/next/dist/docs/01-app/02-guides/streaming.md`：Suspense 子树可以独立等待，慢查询无需阻塞整个页面。
- 保留项目已有真实 404 约束：不存在的详情不能先输出 loading / shell，避免提前提交 HTTP 200。

## 失败先行与验证

所有命令使用 `mise exec node@24.20.0 -- corepack pnpm`。

- `home-performance-red.log` 是初始测试夹具缺少 public-commerce mock exports 的设置错误，**不计有效行为 RED**；原始记录保留。
- `home-performance-red-confirmed.log`：修正测试 mock 后，17 tests 中 9 失败 / 8 通过。七语言首页带入 gift-filters；homepage 未完成时 directory 未启动；footer context 未完成时正文未返回。
- `home-performance-red-404-baseline.log`：加入原详情行为保护后，9 失败 / 10 通过；两种 404 前置判断在旧实现已通过。
- `home-performance-green-first.log`：初步拆分后 19 tests 通过。
- `home-performance-tests.log`：补 React pipeable stream 后 32 tests 通过。初次选择器列出的两个非现存测试文件没有被执行，输出明确是实际 5 个文件；随后改用确切存在的文件做最终检查。
- `home-performance-tests-final.log`：实际 8 个文件、39 tests 全通过，其中新增 20 tests。覆盖七语言依赖图、并发启动、页脚不阻塞、React 实际 shell-first stream 再输出合法政策链接、locale / 多值查询上下文、非法 anchor 不静默降级、两种 404 前置判断，以及现有页面/目录/内容安全/商务上下文/礼物内容回归。
- `home-performance-format-check.log`：独占 13 个文件格式检查通过；`home-performance-format-write.log` 保留格式化记录。
- `home-performance-lint.log`：独占 13 个文件 eslint `--max-warnings=0` 退出 0。
- `home-performance-typecheck.log`：`pnpm --filter @fan-support/storefront typecheck` 退出 0。
- `git diff --check` 对本轮已跟踪修改退出 0。

## 范围限制与后续验收

没有运行 Next build、浏览器或 Lighthouse；没有声称首屏 JS 已达到 150 KB，也没有将静态依赖集合或 React 单测当作实际网络性能。真实 compiled artifact 的七语言双端、404 HTTP 状态、图片与视觉，以及 Slow 4G / Lighthouse 和压缩 JS 预算由 root / E2E 统一验证。请求缓存仍仅 React.cache，底层 reader / HTTP 缓存策略由对应任务负责。SEO metadata 后续由 root 接手，届时本记录源快照只证明接线前的独占改动。
