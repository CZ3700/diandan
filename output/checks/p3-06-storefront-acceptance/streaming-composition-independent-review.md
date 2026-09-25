# 首页与艺人下屏读取 — 独立源码复审

2026-09-08，非作者 `/root/storefront_directory`；实现作者 `/root/storefront_read`。**ACCEPT，未发现本次组合调整必须修复的正确性或权限边界问题。** 只读复审，没有修改源码或重复运行测试、构建、服务、浏览器。

范围为 storefront 的 `page-factory.tsx`、`home-content.tsx`、`homepage-directory.tsx`、`artist-page-factory.tsx`、`artist-gift-directory.tsx`，以及 `page-factory.test.tsx`、`browse-seo.test.ts` 的相关保证。

- 首页的 homepage 与 directory 读取仍在 await 之前启动，保留并行；父组件只等待当前发布 homepage 与审核后的 copy。初始目录 Promise 在独立 server child 中 await，不改为客户端首轮请求。最终目录仍使用真实 SSR cards、原 anchor 和商业 query context。目录失败保留明确错误及重试，没有变成空成功。
- 艺人页先验证 slug，再等待当前内容存在证明；`NOT_FOUND` 在任何 shell/Suspense 返回之前处理。后续 commerce context 和礼物目录放入独立成功子树，失败艺人不触发该读取。真实 artist.id 仍覆盖查询中的另一个 idol，原 market/currency/sort 和相应艺人 basePath 继续传递。
- Hero、正文及真实 image preload 可以先于慢目录、慢 commerce 或正文 JSON-LD 子组件输出；SEO 的既有有效性检查未因 Suspense 被删去。这里不推断 Next metadata 调度在所有 crawler/user-agent 下的具体响应时间。
- 原读取 adapter 对失败的分类、七语言内容审核、DTO 和当前 proof 门没有改变。两个新 helper 均为 server-only，不增加客户端 Promise 或业务秘密传输。最终 DOM 内容职责仍在原组件，新增文件只承担等待各自 server read 的职责。
- 新测试使用真实 React server stream，观察未完成 Promise 时是否出现 Hero/preload，以及解锁后 SSR 目录、链接和错误状态；七语覆盖、假 idol 查询替换、无效 anchor 和 HTTP 404 抛出前没有 shell/context 读取的断言有保留。它们证明源码调度与结果，不代替 Next HTTP 状态或真实 CLS/LCP。

作者执行证据（未由本复核者重复运行）：

| 文件                                                                             | 记录                                                                                                                                      |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `homepage-directory-streaming-red.log`                                           | 有效根因 RED：9 个断言失败。更早 fixture 缺 aliases 的启动错误保存在 `homepage-directory-streaming-fixture-error.log`，不能当作根因 RED。 |
| `homepage-directory-streaming-green.log`                                         | 22 tests PASS。                                                                                                                           |
| `artist-directory-streaming-red.log`                                             | 7 failed / 23 passed。                                                                                                                    |
| `artist-directory-streaming-green.log`                                           | 30 tests PASS。                                                                                                                           |
| `streaming-composition-final-tests.log`                                          | 6 files / 55 tests PASS，包含后补 context 不可用时礼物区域 fail-closed。                                                                  |
| `streaming-composition-final-lint.log`、`streaming-composition-final-format.log` | 作者定向检查通过。                                                                                                                        |

作者告知当时 storefront typecheck 仍被 root 同期 `gift-detail-page-reads` 品牌类型问题阻断；这是 root 的独立接线范围，不能以此文宣称全仓类型门已通过。

待真实浏览器观察的一点：目录 fallback 是单行 status，未预留最终卡片区高度；尤其桌面首屏覆盖目录时，慢响应替换可能产生可见布局移动。当前没有新 CLS 证据，不将其写成已复现缺陷，也不要求凭推测添加布局。新编译后应保留完整 CLS/LCP、真实七语 404 和交互结果，由 root/E2E 验证后再决定是否需要最小样式修正。

本复审与源码冻结，不据此宣称性能门或整个 P3-06 完成。
