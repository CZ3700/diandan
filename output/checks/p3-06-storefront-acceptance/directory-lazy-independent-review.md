# 艺人目录按交互加载校验模块：独立复审

复审者 `/root/storefront_read`，非作者。结论：**ACCEPT（源码与定向验证范围）**。没有修改目录源码、构建或启动服务/浏览器。

复核文件为 artist-directory/search、directory-request/validation、directory-model/query 与 lazy/loading/request tests。

- facade 仅持有类型与动态 import；实际 query schema 解析仍在 fetch 之前。import 前后检查 AbortSignal，响应回来后也检查取消；组件原 request sequence 和取消检查继续阻止晚响应覆盖当前输入。测试中 fetch 故意忽略取消也不能返回成功。
- 原完整搜索词、查询、公开 response schema、状态、locale、fallback=false、窗口长度检查留在 validation 中。默认目录窗口仍取既有 schema default；搜索 limit6 保持。chunk 加载失败和网络/解析异常转为原 `CATALOG_UNAVAILABLE`，没有当成空成功、默认第一页或无条件重试。
- ArtistSearch 在空白、IME composing、关闭时不加载模块，250ms debounce 后才调用 facade；重试沿原 UI 状态入口。facade 不自行缓存 rejected promise。deferred module mock 使用 `vi.importActual` 释放真实 validation，分别覆盖目录/搜索加载中取消与失败后的新调用。
- SSR 初始结果来自原严格服务器 reader，URL anchor 经 `prepareDirectoryQuery` 的真实 `idolIdSchema` 校验；IdolId 品牌沿 server DTO、state、callbacks 传递，不用 cast 接受任意原始字符串。当前版本变化、锚点缺失、重复 ID 与当前请求编号的 reducer guard 保留。
- 最终清理将 `ArtistDirectoryQuery` 的原两行类型定义移至 validation，facade 只作 type import / re-export；复核最终文件确认类型和运行时依赖均不再反向。该清理没有改变 query 定义或执行逻辑。客户端初始模块不再静态引入目录 schema，server 端仍可使用 schema。

独立运行 `pnpm --filter @fan-support/storefront test src/storefront/directory-loading.test.ts src/storefront/directory-lazy.test.ts src/storefront/directory-request.test.ts`，**3 files / 14 tests PASS**，日志 `directory-lazy-independent-tests.log`。另外本代理运行全 storefront typecheck 已通过，见 `gift-purchase-boundary-typecheck-green.log`。作者另有 6 files / 26 tests 的早期 GREEN，不混同为本次独立执行。

边界：这里没有真实浏览器网络证据，不能仅根据动态 import 宣称首屏 JS 已达到预算、所有浏览器 chunk 失败都会恢复或搜索交互无延迟。新构建中的 chunk 分配、按键/IME、取消、加载失败与重试体验以及性能预算仍由 root 的实际浏览器验证。

最终类型归属清理复核仍为 **ACCEPT**。作者另提供 `directory-lazy-source-freeze.json` 的 10 源文件快照，以及 8 files / 70 tests、typecheck、lint PASS；这些是作者证据，本次仅独立复读两份最终源码，没有再次运行测试或构建。
