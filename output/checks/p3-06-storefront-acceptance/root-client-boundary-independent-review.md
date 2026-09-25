# Locale / GiftFilters 客户端边界独立复审

复审者 `/root/storefront_read`，非作者；2026-09-08。最终结论：**ACCEPT（本次源码与定向测试范围）**。本次未修改产品源码，未构建、启动服务或运行浏览器。

范围：`canonical-locale.ts`、`presentation-locale.ts`、`storefront/navigation.ts`、`gift-filters.tsx`、`gift-filters-client.tsx`、`gift-filter-types.ts`、`gift-filter-validation.ts`，以及对应 canonical / presentation / validation / cancellation / directory SSR tests。

## 发现与修复复核

1. **已修复：history 恢复尚未到下一帧时，旧提交仍可导航。** 原 `pageshow` 处理只在 rAF 内递增 operation；被暂停的校验模块若先完成，会执行旧 `location.assign`。作者的受控 deferred import 用例在不释放 rAF 时复现旧导航。现在 `restore()` 同步作废 operation / pending，只有浏览器原生表单恢复后的 draft、错误和 Drawer 归位留在 rAF；监听与帧清理仍保留。
2. **已修复：点击重置后，旧提交可覆盖重置导航。** 原 reset 锚点没有取消回调。现在 `onClick={cancelApply}` 同步作废旧操作，原 `href` 与浏览器默认导航保持。测试暂停导航完成过程，证明旧 validation 完成也不能再 assign。

真实组件 closure、受控 React hooks/window 与 deferred module import 的作者证据为 `gift-filter-cancellation-red.log`（2 FAIL / 1 PASS）→ `gift-filter-cancellation-green.log`（3 PASS）。这不是实际浏览器网络或 BFCache 命中证据。

## 保持的约束

- locale 仍来自单一 canonical 合同值；`parsed === value` 拒绝大小写变体、空白、内部伪语言及未知值，不将输入正规化后悄悄改变路径。语言切换仅改 URL 的首段，重复 query、市场、币种、交易上下文和 fragment 保持；cookie 名称、时长与属性保持。
- **兼容边界明确：** `presentation-locale` 原本就抛出 `TypeError`，消息保持；`storefrontHref` 对非法运行时 locale 由 ZodError 改为明确 TypeError。已查当前调用点，未发现依赖该 ZodError 类型或 `.issues` 的处理；合法输入及目标 URL 不变。不能将此描述为所有异常行为逐字不变。
- GiftFilters server wrapper 只准备原有价格输入格式、ICU hint、初始 draft 和链接；传入 client 的值可序列化，不包含函数、schema 或私密身份。价格示例 `1234` 是原界面示例迁移到 server，不是新增报价或业务默认值。
- client 初始模块只作 type import；完整金额与最终 query schema 在提交时动态加载。金额仍使用原 `parseGiftPriceInput` 的精确整数路径；负数、指数、非有限值、过多小数、unsafe integer、上下界逆序拒绝，空值移除旧价格边界。最终 `giftFilterHref` 再验证完整查询，保留原 page=1、market/currency/idol 及无关重复 query 处理。
- 编辑、IME 开始、Drawer 开关、卸载、history 恢复和 reset 均作废旧 operation；import 后检查编号，旧 catch/finally 也不能覆盖当前状态。当前同步 validation 中没有新的异步缝隙。失败有显式 alert，并提供原页面及当前 query 的整页恢复链接，不构造默认市场、不导航到伪成功结果。
- `gift-directory.test.tsx` 仅新增既有 SSR 测试惯例的 `server-only` mock，使普通 Vitest runner 能渲染 Server wrapper；原六项 markup 断言没有删除或放宽。产品文件仍保留 `server-only`，构建边界应由 root 的正式 Next build 验证。
- 从代码收敛角度，金额规则集中在原 gift-query，新增 validation 只作调用与结果分类；locale 精确成员判断共用一个 helper。没有引入第二套 schema、查询默认值、业务事实或新架构。

## 独立验证与边界

独立运行：

```sh
pnpm --filter @fan-support/storefront test src/canonical-locale-boundary.test.ts src/presentation-locale.test.ts src/storefront/gift-filter-presentation.test.tsx src/storefront/gift-filter-validation.test.ts src/storefront/gift-filter-cancellation.test.tsx src/storefront/gift-directory.test.tsx
```

**6 files / 76 tests PASS**，日志 `root-client-boundary-independent-tests.log`。该命令未运行 build、Next 或整仓检查。

无剩余必要源码修复项。新 chunk 实际初始加载量、失败后的浏览器恢复、IME / native Back / 焦点交互与性能预算，仍须 root / E2E 在最终编译产物上实测；不能把本复审当成全仓、真实性能、人工可访问性或生产发布通过。
