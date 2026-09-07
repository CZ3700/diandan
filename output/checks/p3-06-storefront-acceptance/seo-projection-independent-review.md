# SEO 多语言发布证明复用 — 独立复审

2026-09-07，非作者 `/root/storefront_read`。结论：**ACCEPT**，未发现本次优化必须修复的正确性或权限边界问题。只读审查两个 Domain 源文件和新增测试；未修改产品源码，未启动服务、Next、PG 或性能采样。

## 范围与判断

- `packages/content/src/published-content.ts:385`：私有 `verifiedContext` 仍对 unknown 输入执行完整 strict schema 解析、当前 publication/lifecycle/head/身份检查、manifest hash 与真实 manifest 验证。没有 `trusted` 标志、跳过开关或外部可调用的已验证对象入口，也没有跨请求 memoization。有效上下文只在同步调用内复用。
- `published-content.ts:406`：每个 locale 分别创建 `publishedMediaResolver`，执行完整内容投影、独立 `used`/`complete()` 检查和 `publishedContentResponseSchema.parse`。媒体 revision、READY、当前版权、真实 object key、尺寸和该 locale 的 metadata 翻译仍在 resolver 中验证。未共用 resolver 的已使用集合，未把首语言的成功当成其他语言的证明。
- `published-content.ts:430`：既有单语言入口采用同样顺序，异常仍返回原 `CONTENT_UNAVAILABLE`。`currentPublication`、`details` 和 `project` 整段与当前 HEAD 的 12,219 bytes 完全一致，SHA-256 `19cd563a95c32fa08cb396fab77be3dfcdbd3b520efd5ac955f163ac8e374f05`；resolver 到最终响应 schema 的 578 bytes 原样，SHA-256 `e6b0b6fa263eb51e6fa08f3ab436240f306e70198f29445aaab6edf7ef2e5c32`。这是针对既有单语言实现的独立字节比较，并非只凭两个共享新 helper 的测试互相比较。
- `published-content.ts:441`：新增公开函数自身完整验证 unknown 输入，只接受源语言入口，固定按 `SUPPORTED_LOCALES` 顺序执行七次渲染。原输入 schema 的 locale 只是支持语言枚举，没有与其他字段绑定的 refinement；用固定有效 locale 替换这一字段不会跳过额外跨字段门。共享 proof 不依赖外层请求 locale，而是校验完整冻结包及各语言审核记录。
- `packages/content/src/storefront-seo.ts:67`：只消费新的完整视图数组，仍要求每项成功、同内容 kind、同 publication、requested/resolved 与目标 locale 一致、fallback 为 false、真实 translationRevision 存在，并最终验证 SEO entity schema。任何一项失败仍为整个 entity `CONTENT_UNAVAILABLE`，不丢失 locale 后伪装成功，不制造 fallback 或审核证明。
- 新测试以真实函数 spy 核对 hash/manifest verifier 各一次、resolver 七次及语言顺序；五类对象的七语视图与单语言入口逐项等价，IDOL/GIFT 包含 aliases/detail extensions；输入不被修改。缺任一内容/媒体翻译、版权撤销、错误 head/hash、非源语言入口与发布后更改的媒体 URL 绑定仍拒绝。既有 rollback、DRAFT、历史媒体 metadata 与精确时间测试亦纳入本次独立运行。

这次抽取集中重复的 proof gate，保留一个私有渲染器，边界清晰；不建议为进一步少几行合并错误边界或引入外部缓存/可信 token。`index.ts` 的既有 `export *` 会使新**验证入口**可用，但两个私有 helper 均没有 export，因此不存在可绕过 proof 的公开入口。

## 独立验证

```sh
mise exec node@24.20.0 -- corepack pnpm exec vitest run --config /Users/mario/Desktop/下单/vitest.config.ts --root packages/content src/storefront-seo-proof-reuse.test.ts src/storefront-seo.test.ts src/published-content.test.ts src/storefront-homepage.test.ts src/publication-manifest.test.ts src/publication-manifest-canonical.test.ts
```

6 files / **40 tests PASS**，exit 0，1.15s。日志：`seo-projection-independent-tests-green.log`。首次命令把 config 当成相对 content root 的路径，启动前报找不到配置；保留 `seo-projection-independent-tests.log`，修正为绝对配置路径后运行，不涉及源码或测试断言调整。

审核时源文件 SHA-256：

| 文件                               | SHA-256                                                          |
| ---------------------------------- | ---------------------------------------------------------------- |
| published-content.ts               | b56329a141807bc994820f22290c86aea41e3413983d7651a6b0251a580f3c36 |
| storefront-seo.ts                  | 403f1905e5370f953790bbfbf1bbe5fbdee2aacb71babe7cc9663c5896ccfe4b |
| storefront-seo-proof-reuse.test.ts | 03c8bb871d2ddbe6379c6457240b10888a95320710e4d7cfa2c243f394c3b843 |

本结论仅覆盖 Domain 证明复用的正确性与轻量回归，不据此宣称真实 API 延迟达标、根除所有性能波动、全仓检查或生产通过。真实 PG/HTTP/Next 验证与最终资源独占的性能采样仍由 root/E2E 独立执行。
