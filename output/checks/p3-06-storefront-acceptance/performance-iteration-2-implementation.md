# P3-06 性能第二轮实现与验证

状态：源码冻结，实际生产编译与性能复测进行中。

第一轮 `run-2026-09-07T17-13-43-828Z/browser-attempt-1/performance/results.json` 完整收集 63 次 Lighthouse（21 组，每组 3 次）和 84 页面资源。零资源失败；21 组 LCP 中位数均超过 2,500ms，性能分数 5/21 组达到 90，CLS 全部通过。JS gzip 331,928–345,161 bytes，未达到 150,000 bytes 建议，图片全部满足预算。保留原始结果，不更改阈值。详细表见 `performance-checkpoint.md`。

## 最小实现

- 首页继续并行读取首页与目录，主视觉只等待其自身已批准数据，下方目录独立 Suspense；艺人页先证实存在、保持真实 404，再将礼物 context/目录放入下方 Suspense。所有最终 SSR 数据、搜索参数、市场币种与发布证明保持。
- 礼物详情的文案、context、礼物本体、指定市场报价与收礼艺人查询并行调度；没有新增缓存、放宽 schema 或默认生成交易范围。全部结果和两个 NOT_FOUND 分支仍在返回 shell 前检查。
- 临时加载提示采用现有设计 token 的 `system-ui, sans-serif`，完成后的七语言正文和品牌字体不变。该改动针对原始网络记录中加载提示提前触发中文大字体切片的问题，收益待真实网络采样。
- 公共目录与 locale 原值拆到独立模块，避免客户端公共协议导入连带内部证明初始化。39 个原声明及当前生成物保持完整字节一致，旧导出同名同绑定；没有删除边界校验。
- 前台根容器增加 `isolation: isolate`，将 sticky header 收入自身 stacking context，使 body portal 弹层盖住顶栏。未向共享 UI 增加 z-index。原 CSS 真实浏览器 hit test RED，单行修复后手机/桌面 18 个点、26 项断言 GREEN；还需生产编译矩阵复验。

## 测试与复审

- 礼物调度有效 RED：原实现 3 FAIL / 4 PASS，测试最初语法错误另存 setup-error，不计功能 RED。实现后原定向 2 files / 9 tests PASS。独立审查后新增真正缺省市场、保留无效空值，以及全部独立读取异常不返回 shell 的测试。
- 最终 `pnpm --filter @fan-support/storefront test`：46 files / 316 tests PASS（`performance-source-storefront-tests-final.log`）；全前台类型检查 PASS（`performance-source-typecheck-final.log`）。
- root 变化 scoped lint / format PASS（`root-performance-final-lint.log` / `root-performance-final-format.log`，最后测试格式另见 `gift-page-scheduling-review-format.log`）。
- 首页/艺人真实 SSR 有效 RED → GREEN，6 files / 55 tests 与 scoped lint/format PASS；合同拆分 10 files / 50 tests、types、lint、format PASS；依赖构建 6/6 PASS。
- 非作者复审：`root-performance-independent-review.md`、`streaming-composition-independent-review.md`、`public-contract-boundary-independent-review.md`。目录 fallback 未预留卡片高度，真实 CLS 必须复测，不能由源码判断通过。
- 冻结输入：`implementation-source-performance-iteration-2-final.json`，1,526 files，SHA256 `5cafc7406b4213ac07c35e2d8a5e304b5efea745dcba4d7e1f22dfa071df4b5b`。旧浏览器证据只适用于旧输入，新编译/矩阵/性能与 P2 指纹及整仓门待更新。

实验室结果不会替代 RUM、真实 p75、INP、手机实测、读屏或非开发运营计时。P3-06 仍 IN_PROGRESS。
