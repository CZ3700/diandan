# P4-05 订单界面检查点

状态：本地检查点验收通过，P4-05 DONE；P4-06 READY。基线 `ae625e1`，仅本地开发与提交。

## 交付范围

- 四个固定订单 BFF 与独立浏览器 transport，隔离购物车/订单 Cookie 与 CSRF，严格正文预算、响应动作/订单范围、Set-Cookie 与 Retry-After、取消和总超时。
- 七语言订单查找、fragment 入口、受保护详情与付款完成页；只有服务器授权并读取 canonical 历史订单后显示结果。已过期报价不抹除合法付款后的查单资格。
- 首次 HTML 的同步脚本立即清除 fragment/query，凭证只在最多15秒的一次性内存闭包中停留，不进入历史状态、浏览器存储或 DTO。UNKNOWN交换只用已知订单号尝试Cookie保护的读取，不重复消费凭证。
- 购买时艺人/礼物/规格/原图衍生图/金额与原文语言保持；进度展示当前付款/订单/争议/准备状态，只显示真实createdAt，不推算过去或将来的履约日期，没有邮件发送声明。
- 隐藏/离开页面清除可见订单，恢复重新授权。撤销结果未知时保留关闭意图，重试读仅用于恢复CSRF，不重新展示订单。

## 实际验证

| 项目 | 结果与证据 |
| --- | --- |
| 真实订单浏览器 | 第四轮7373断言=6187准备+1186浏览器，25cases/55PNG/55axe，零violation/incomplete；真实PG、TLS S3、独立持久TEST PSP、Next生产构建与worker。详见`browser-verification.md`与`run-2026-09-15T19-58-10.496Z/`。 |
| 七语言与历史 | 7×390×844/1440×900；实际菜单在同一订单pt→ja→zh-CN→pt，DTO/Cookie/金额/历史locale保持；原商品改名/换图/改价/归档后历史不漂移；DAILY真实原文。 |
| 支付与授权 | PSP返回仍待确认→验签webhook→worker→canonical读取→授权完成页；刷新不再次bootstrap；fragment清除/一次性重放/跨单拒绝/UUID大小写/原生Back/真实到期/换浏览器轮换/关闭恢复通过；查单未改变财务/库存/履约/通知/PSP计数。 |
| 定向与审查 | storefront83文件593测试与类型通过；BFF/transport18测试；视图10测试、i18n28测试。两P2有效RED→GREEN后控制器12测试，独立8探针及6文件33测试通过。见`root-independent-review-fixed.md`、`combined-review.md`。 |
| 字体/工具 | 两个CJK字库按固定源重新生成并通过UI字库检查。P204依赖覆盖有效RED→GREEN；两采集器测试53/53通过，P205原本已覆盖完整storefront，未改实现。 |
| 共享浏览器 | 原P204第二次28.002秒、P20538.281秒exit0；原人工/真机、moderate/incomplete范围保留，证据`output/playwright/p2-04`与`p2-05`。 |
| 完整仓库门 | 原单条`pnpm check`在1737.580秒exit0，40项原门全部完成；types61/61（59缓存）、tests61/61（59缓存）、build36/36（34缓存）、32 Node出口。实际订单入账6827、安全查单6860、28迁移/172表、TLS S3与媒体423断言通过。见`check-full-1-result.json`、`gate-coverage.json`。 |
| Secret/依赖 | `secrets-final-result.json`27.138秒exit0，最终原门产物生成后`secrets-delivery-result.json`25.994秒exit0；官方registry `audit-final-result.json`exit0、No known vulnerabilities found；无依赖版本变更。 |
| 兼容与已有文件 | 573旧合同根、96API路径、180组件、56旧SQL和2412初始未跟踪文件均保持。见`compatibility-and-protection.json`。 |

## 源码与失败证据

- 第四轮浏览器2138输入SHA `a15c17cb5a910109b2aa92cd65de3425d9e21094507914db3203df0ec2be470c`，前后逐字一致。最终2131源输入SHA `6e746b77a95fefd3b771e8603bcaed361a6fa54e55bffa2a6c1d320753072176`；两清单范围不同，数字不可直接作增删比较。共同输入的差异仅为三个collector工具文件；产品实现没有再修改，详见`browser-to-final-source-delta.json`。
- 第一浏览器轮固定Tab次数断言失败，改为明确业务控件顺序后复验；原逐步焦点记录未保存，不据此确定产品焦点缺陷。第二轮是DAILY标题与默认规格同名的定位歧义；第三轮是大写UUID的GET未被小写故障匹配器拦截。均为测试脚本修正，原失败报告保留，第四轮重新完整验证。未用早期部分结果替代完整PASS。
- 两个真实代码问题来自独立审查：UUID比较大小写不一致、撤销未知后关闭意图丢失；有效失败测试后修复，原探针与修后复核全部保留。其他开发格式、类型与取消/生命周期失败的原日志亦保留。
- 最终原整仓门前后2131源集合与SHA逐字一致。原Admin浏览器检查临时生成两条`.next/dev/types`导入；精确核对这两条是唯一差异，归档后恢复原字节，最终质量门使用恢复后的声明。见`admin-next-env-restoration.json`。
- P204首轮守卫拒绝并发新建output文件后的工作区状态，源字节未变；原采集器未保留完整前后状态差异，因此不声称掌握完整逐行diff。冻结所有文件创建后相同命令通过，守卫未改。见`composites-first-failure.json`。

## S.U.P.E.R与独立复核

`combined-review.md`逐项审查1–9通过：模块单一职责、单向依赖、无环、既有schema、可序列化边界、配置隔离、声明依赖、可替换传输/视图。root另外逐一阅读非root作者的BFF/请求与Cookie验证/transport/响应验证，确认固定路由、同源、授权隔离、真实合同匹配与取消边界。第10项由原单条完整check exit0确认，S.U.P.E.R十项在本地任务范围全部通过。非作者最终证据复核见`final-independent-review.md`。

## 运行入口与限制

```sh
mise exec node@24.20.0 -- corepack pnpm verify:orders:browser
mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs
mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs
mise exec node@24.20.0 -- corepack pnpm check
python3 output/checks/p4-05-order-storefront/verify-candidate.py source-recheck.json
```

采集P204/P205时暂停所有文件创建和Git操作（包括新增output报告）；它们验证整个工作区状态。Next/PG/浏览器重型套件串行执行。全文操作/恢复规则见`docs/operations/order-access.md`。

实际浏览器的JSON丢失发生于Next响应正文边界，Cookie正常写入；不是端到端真实TCP断连。原生Back重新加载/授权通过，但pageshow.persisted=false，未命中真实bfcache；生命周期探针是补充，不能替代真实缓存命中证据。实际PSP商户、邮件、云/staging/生产、人工译审/读屏及物理手机未在本轮验收；P3性能/人工门与P4-04商户门保留。旧SQL/凭证算法/金融合同不改。Git按用户偏好仅本地提交，不push/PR/merge/部署。

规范§5.8中的预计准备时间仍需已批准SLA，邮件已发送提示需P4-06实际投递证据；后续P5-02产生PREPARING/DELIVERED事实时再接准确事件时刻。本轮当前状态进度不等于准备/送达运营演练，也不关闭整个Phase4。独立范围核对由`/root/order_view`完成，结论与这些保留项一致。
