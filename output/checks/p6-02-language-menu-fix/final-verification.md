# 滚动后语言菜单与查单入口修复

基线 `1ec464c2`，分支 `codex/fix-scrolled-language-menu`。用户明确选择“查询订单放进菜单，不占顶部导航”。

## 原因与最小修复

原双锁CSS把html/body同时设为hidden，新增body滚动祖先，滚动到1100px后header与menu分别移到-1100/-1010px，背景仍锁定。`browser-red-3.txt`及`output/playwright/p6-02-language-menu-fix/reproduction.json`保留真实失败；Playwright locator自动滚动曾可掩盖问题，所以新回归先完整视口断言再坐标点击。

仅移除body锁的中间方案仍与Base UI已有body锁冲突。`reopen-timeline.json`逐帧证明body先锁、root随后加入、header离屏，再因聚焦导致1300→95；不归因于未证实的动画延迟。最终移除的是原root选择器，body锁与Base UI当前viewport选择一致，引用计数、touchmove、焦点JS均不改。body-only控制实验20轮保持y1300/header0。门禁现在要求单一body锁并拒绝root双锁。

查单保留在同一个Drawer，双端均显示菜单按钮；顶部主导航只有首页、艺人、礼物。语言、购物车与显式上下文维持。没有海报内容或后端/支付/数据库/依赖更改。

## 验证

| 命令 / 范围 | 当前结果 | 证据 |
| --- | --- | --- |
| 七语导航作者回归 | 7先RED后GREEN，91相关测试、类型/格式/lint通过 | `banner-author.md` |
| `pnpm check:ui-interactions` | 92/92及真实源码静态门PASS；独立重跑92 | `interactions-final.txt`、`independent-tools-final.txt` |
| `node scripts/verify-storefront-header-browser.mjs --instance acceptance-e143d720dd1a4357a3c3 --output <新目录>` | 七语×2尺寸14/14；菜单几何、开关/焦点/滚动、查单菜单、语言切换通过；pageerrors0 | `output/playwright/p6-02-language-menu-fix/matrix-final/report.json` |
| 原 `pnpm verify:ui-interactions:browser` | 隔离冻结副本13场景/15PNG/8axe/原生200%与preview/staging/production路由门通过 | `shared-ui-run.txt`、`shared-ui/` |
| `pnpm check:dev` | format/lint、64type/64test/36build PASS；缓存59/60/33 | `check-dev.txt` |
| 32构建出口、adapter、secrets | PASS | `build-artifacts.txt`、`boundaries.txt`、`secrets-final.txt` |
| 独立实现/矩阵审查 | ACCEPT | `independent-review.md`、`independent-final-evidence.json` |
| 用户实例恢复与额外smoke | 四服务ready，中文桌面首次/再次语言切换PASS | `user-status-final.json`、`output/playwright/p6-02-language-menu-fix/restarted-smoke/report.json` |

新14组为本地Next开发页面交互，手机Chrome触控模拟+reduced-motion、桌面正常动效；共享13组为单独冻结的正式Next编译。它们不是物理手机、人工读屏、真实用户RUM或云发布。新页头浏览器只用page查询；市场/币种保留由七语导航单测和既有helper测试承担，未重跑支付或真实PG（本轮未改业务层）。共享axe按原门保留1个moderate region和5个incomplete，不称全部axe为0。

首轮工具import错误、目标新页面未加载完全时过早测滚动、root-only中间失败均原样保留；最终完整14组来自matrix-final，不拼接失败轮次。新页面稳定后才测滚动，没有放宽视口比例或断言。所有共享旧门预算不改。

## 源码、数据与交接

`final-source-check.json`：2784执行输入、路径/字节/mode/新增删除与冻结副本完全一致，SHA `34e9e6c36b8a286501a1ae4de55b54e39ce07786b307c52ef957c03ef5a5df1c`。Next启停产生的两份next-env声明恢复为原生成版本，未覆盖用户改动。`protection-final.json`确认原8457未跟踪文件和私有用户配置不变。没有reset用户实例；浏览器仅读公开内容/操作语言导航，不创建订单或改业务数据。共享验收在独立副本，旧P2-03证据没有覆盖。

S.U.P.E.R 1–10：单目的菜单几何修复与独立验证；复用原Drawer；依赖方向无变化/无循环；原跨模块合同与序列化边界保持；配置来源保持；无新增依赖；组件/校验器可独立替换；受影响及全仓质量/真实浏览器范围通过。人工/真机/上线门继续保留。

P6-02反馈修复本地接受后释放Lane D，原人工门仍开放而保持IN_PROGRESS；P6-03仍READY、尚未领取。只本地提交，不push。复验入口见 `docs/operations/accessibility.md`。以后排查sticky/弹窗问题先核对实际viewport滚动源、锁的归属与关闭/打开交接，不能用自动滚动的测试点击代替真实可见性。
