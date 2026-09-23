# 可访问性本地验收

P6-02 的本地自动验收入口为 `pnpm verify:accessibility --output <新的证据目录>`。它从当前源码创建独立副本，以 frozen lockfile 离线安装依赖，创建只属于该轮的 TEST 实例；不连接或清空当前用户体验实例。前台运行正式 Next 构建，管理中心运行本地开发模式。

## 运行

使用仓库固定的 Node/pnpm 版本，先运行工具测试：

```sh
corepack pnpm --filter @fan-support/contracts build
corepack pnpm test:accessibility-tools
corepack pnpm verify:accessibility --output output/checks/p6-02-accessibility/new-run
```

需要本机 Chrome 和已有的 TEST PostgreSQL 工具。原生 PostgreSQL 可通过 `POSTGRES_TEST_BIN` 指定其 `bin` 目录；工具验证可执行文件并隔离数据库。证据目录必须不存在，失败原件不覆盖。浏览器运行时应避免同时执行其他重负载浏览器验收。

## 检查范围

- 七种公开语言，每种覆盖 390×844、1440×900、320 CSS px 与真实 Chrome 200% 缩放，共 28 个单元。
- 每个单元检查首页、礼物详情、购物车、结账表单、已授权订单、管理中心和订单处理页面的 axe、语言、布局及键盘焦点。减少动态效果按矩阵设置验证。
- 每个单元持有并释放本次真实订单搜索请求，核对返回合同和唯一目标订单，验证加载期间、完成后的稳定标题焦点及后续键盘操作；不使用旧列表或伪造响应代替。
- 全新无 cookie 的首页直接在艺人后展示已上架礼物；进入详情之前无需指定地区。分类与分页越界恢复通过真实 GET 表单和键盘操作检查；浏览不会创建购物车。
- 首个单元完整执行一次 TEST 支付、独立邮件授权、私密留言审核与准备/送达。其他单元各自执行键盘加购和结账表单，再使用仅保存在内存中的真实短期查单授权检查订单布局；不声称每个单元均创建并支付订单。
- 原生缩放使用临时 Chrome profile 的站点缩放配置，并核对实际 CSS 视口、物理窗体及 DPR。禁止用 CSS zoom 或截图缩放替代。

成功后停止并清除本轮自有 TEST 数据；失败时停止服务并保留该轮数据供诊断。截图遮蔽敏感输入，私密留言展开时不生成截图或 axe 证据。报告不保存 cookie、授权 token、私有配置或邮件正文。

## 自动验收之外

自动结果不能替代 VoiceOver/NVDA 真人读屏、七语人工理解与译审、真实手机、真实商户支付、生产基础设施或 RUM。所有这些原门保持独立登记。axe 的 incomplete 也需人工判断，不能当作已通过。

检查基于 [WCAG 2.2](https://www.w3.org/TR/WCAG22/) 与 [Reflow 说明](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)，本地通过不表示已完成全部 WCAG 合规认证。


## 滚动后页头交互回归

`pnpm exec node scripts/verify-storefront-header-browser.mjs --instance <已有本地TEST实例> --output output/playwright/<新证据目录>` 只读取公开页面，不创建订单或修改内容。使用七语言、390×844/1440×900，检查下滑后首次懒加载/再次打开语言菜单、完整可见几何、Escape焦点和滚动恢复、菜单内查单、坐标点击/触控语言跳转及查询参数保持。手机使用reduced-motion；它不是物理手机或人工读屏验收。`--smoke`仅中文桌面，`--locale ja`仅指定语言双端；局部运行不得报告成完整七语。

先断言菜单在视口内，再点击；直接用locator.click可能自动把屏幕外的菜单滚回来，掩盖实际卡住。页面导航后等待目标内容加载完成，再测滚动。当前页面的viewport overflow由body传播；自定义菜单与Base UI共享body锁，不能同时给html和body加overflow:hidden。切换到独立html滚动容器的未来布局变更须同步重新评审锁目标，不能只通过静态门禁。
