# P4-05 订单界面实际浏览器验收

最终入口：`mise exec node@24.20.0 -- corepack pnpm verify:orders:browser`。

最终运行 `run-2026-09-15T19-58-10.496Z` 与 `browser-run-4.log` 已 exit 0。7373 断言 = 6187 实际 fixture / 编译准备 + 1186 浏览器断言；25 cases、55 PNG、55 axe（0 violation，0 incomplete）。Chrome 152.0.7977.84。全部拥有的 Next、API、worker、TEST PSP、PostgreSQL 和 TLS S3 fixture 按 harness 生命周期清理。

## 本轮覆盖

- 实际 PostgreSQL、TLS S3 历史派生图片和独立持久 TEST PSP，不使用 SQL 伪造金融状态。
- 一条实际浏览器 hosted payment → return 仍 PENDING → 原始签名 webhook → durable worker 原子入账 → 已付款 checkout bootstrap → thank-you 链路；成功页刷新只读既有会话、不重复 bootstrap。
- 7 语言 × 390×844 / 1440×900 的 lookup、历史订单、thank-you，共 14 主矩阵。移动 reduced motion，桌面普通模式；英语双视口实际 Tab / Shift+Tab / 可见焦点。
- 全部主矩阵使用大写 UUID fragment hint；客户端立即清除 fragment，再交换一次凭证；最终显示后端 canonical ID。仅固定事件类别、布尔值、状态及来源信息进入报告，token/CSRF/Cookie 值不进入报告。
- 实际 Header language menu 将同一葡语订单连续切换为 ja、zh-CN、pt，保留全部历史 DTO、原订单 locale、金额、图片和同一 Cookie。
- 正常管理 API 重新发布艺人/礼物名字和照片、价格 1500 → 1637 后归档；历史订单继续读取旧名字、金额与原 S3 衍生图。
- 中文 DAILY 原文及图片 lang，在葡语外壳下保持真实来源；安全链接 JSON 丢失但真实 Set-Cookie 已送达时，使用已知非授权订单号恢复。
- 跨订单拒绝、已消耗 token 重放、网络请求中断与重试、native Back 重新授权、新浏览器会话撤销旧会话、真实数据库 link/session TTL 到期、大小写 lookup、撤销 JSON 丢失后重试保持关闭意图。
- Cookie 实际 Secure/HttpOnly/SameSite Strict/host-only；普通 storage 为空；URL/Referrer/公共响应及截图 canary 校验；订单 HTML no-store/noindex/no-referrer 和无第三方脚本。
- 所有只读/访问恢复流程前后，订单、付款、库存、履约、通知及关联业务表指纹和 PSP 计数完全一致。

## 精确证据边界

native Back 的 `PerformanceNavigationTiming.type` 为 `back_forward`，但 `pageshow.persisted=false`。已显式移除当前锁定 Playwright 源码中的 `--disable-back-forward-cache` 默认参数；本次没有实际 bfcache 命中，不以 Back 导航等同于 bfcache 恢复。产品 suspend/resume 的单元证据由 root 另行记录。

浏览器 JSON 丢失是 TEST 中间层保留真实响应头、丢弃正文的语义故障，`socketDisconnected=false`；不是浏览器 headers 后真实 socket 断开。新 HTTP gateway 单测另覆盖真实 headers 后 socket 断流，以及空正文语义故障。

本轮无真实商户 sandbox、真实资金、物理手机、人工七语言译审或生产发布证据。未伪造邮件已发送、履约准备/送达时间；当前成功态实际为 PAID / OPEN / PENDING。后续履约变化须由对应运营流程产生事实。

## 源一致性

`browser-run-4-source-before.json` / `browser-run-4-source-after.json`：2138 个相关源码、配置、迁移和脚本文件逐 SHA 一致，汇总 `a15c17cb5a910109b2aa92cd65de3425d9e21094507914db3203df0ec2be470c`。本轮期间没有产品或 harness 源码变化。后续 root 对原 P2-04/P2-05 collector 的来源指纹更新属于另一个验证工具变化，不改变此次产品渲染输入。

## 原失败保留

1. `browser-run-1.log` / `run-2026-09-15T19-41-23.454Z`：6588 断言处失败于固定 8 次 Tab 后仍要求页面 DOM 焦点。此前实际支付闭环和英语手机 5 图 / 5 axe 为 0。原报告未保存失败步次，不能据此认定产品焦点缺陷。harness 改为明确业务控件顺序 retry → revoke → back → Shift+Tab，并逐步保存 tag / outline / shadow，第二至四轮双视口均通过（3 px solid focus）。
2. `browser-run-2.log` / `run-2026-09-15T19-48-43.026Z`：7268 断言后，DAILY 商品标题与自动默认规格同名，宽泛 `getByText` 匹配两个元素。14 主矩阵、Header 切换和 48 图 / 48 axe 已通过。安全失败图显示已从丢失 JSON 恢复正确订单。改用语义 heading locator；没有修改真实 DTO 或产品实现。2137 源前后相同。
3. `browser-run-3.log` / `run-2026-09-15T19-53-18.504Z`：7290 断言后，新增大写 lookup 保留大写 UUID 路径，harness 用小写字符串匹配网络故障目标，未拦截真实读取，等待错误页超时。安全 callsite 明确定位 recovery:23。改为大小写无关且仍绑定同一 UUID 的精确 regex；新增对应 node regression，native Back 的路径比较同步按 UUID 大小写等价处理。2137 源前后相同。

最终不删除/覆盖以上失败；第四轮在最终候选上完整执行全部矩阵和附加用例。

## 新 runner 局部质量

`mise exec node@24.20.0 -- corepack pnpm exec eslint 'apps/api/scripts/order-storefront-*.mjs'` 已通过。
`mise exec node@24.20.0 -- node --test apps/api/scripts/order-storefront-*.test.mjs`：3 tests PASS（精确路由、真实响应故障、大小写 UUID 网络目标）。所有新脚本已格式化；无新增依赖。新文件独占 `apps/api/scripts/order-storefront-*`，未修改旧业务或旧未跟踪文件，未提交或推送。
