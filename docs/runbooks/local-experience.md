# 持久本地体验

本地 TEST 环境让前台、管理中心、API 与独立 Worker 使用同一 PostgreSQL 和媒体存储。默认使用本地模拟支付，不扣真实款、不发送外部邮件；本地身份选择页只模拟身份提供商，不能作为生产身份服务。

## 本次已验收示例

2026-09-28 首页装修和全站主题已在隔离实例验收，保留了示例艺人、礼物、海报和测试订单。当前示例：`pnpm local:open --instance test-regression-theme-0928`，登录后选择“店铺装修”。停止后可用 `pnpm local:start --instance test-regression-theme-0928 --open` 重新体验；重验正式构建时在启动命令前加 `FAN_SUPPORT_REGRESSION_WEB_MODE=production`。该实例使用本地模拟支付，与旧体验数据分开。

2026-09-23 完整购买及重启验收通过，保留了一个可直接体验的示例。打开它：

```sh
mise exec node@24.20.0 -- corepack pnpm local:start --instance acceptance-e143d720dd1a4357a3c3 --open
```

后续查看/停止/重开这个示例时，也要带相同的 `--instance acceptance-e143d720dd1a4357a3c3`。不带参数的命令管理独立 `default` 实例；同一仓库一次只能启动一个。下面的默认命令适合创建你自己的新测试数据。

## 启动和打开

在仓库目录运行：

```sh
mise exec node@24.20.0 -- corepack pnpm local:start --open
```

已激活 Node 24.20.0 时可简写 `pnpm local:start --open`。首次先安装依赖 `pnpm install --frozen-lockfile`。需要可运行的 Docker/Colima、PostgreSQL 18 和 Chrome；macOS 可使用已安装的 `postgresql@18`，其他安装路径通过 `FAN_SUPPORT_LOCAL_POSTGRES_BIN=/absolute/path/to/bin` 指定。启动会先编译依赖，初次初始化 TEST 市场、权限、支付路由和四类政策；重开不替换已发布内容或配置。首次上传艺人后，本地助手以独立 TEST 桌面/手机素材通过正常媒体与七语审核流程建立首张首页，再可在管理中心上传自己的海报替换；已有首页始终保留。

`pnpm local:open` 打开专用 Chrome 内的前台、管理中心和测试收件箱。专用浏览器将保留域名映射到本机，并只信任本实例证书公钥；不改系统 hosts、不安装系统 CA、不关闭全局 TLS 校验。直接将 example.invalid 链接粘贴到普通浏览器不能访问。

## 操作

管理中心点击登录，在明确标记 Local TEST 的身份页选择管理人员。艺人上传图片并填写名字、描述；礼物上传图片并填写名字、描述、价格和分类；首页海报上传替换。礼物类型与库存策略分开，默认按需采购，所有收礼方均为工作室转交艺人。

“店铺装修”管理首页区块：上下移动调整顺序，勾选控制显示；海报、艺人和礼物三个核心区块保留。右侧可以切换手机/电脑预览，预览不会购买或改动公开页面。“保存草稿”后才可“发布”；“恢复默认布局”只改变待保存草稿。“发布历史”可恢复以前的布局，并保留最新海报、商品与订单。退出或切换工作区前会提示尚未保存的修改；如果提示版本冲突，先重新载入当前版本再调整。

“店铺装修 → 全站主题”可选择经典黑金、石墨珍珠或午夜蓝，展开设置可调整文字大小、内容留白和圆角；右侧直接预览。保存草稿后发布，或从主题发布历史恢复。主题历史与首页布局、海报分别保存，恢复任何一项都不会覆盖其他内容或交易数据。新打开或刷新页面会使用已发布主题；已打开的页面在站内跳转时保留当前主题，刷新后更新。

预览与真实首页使用同一个渲染器，只展示已发布的图片和内容。部署时商城必须配置准确的 `FAN_SUPPORT_ADMIN_ORIGIN` 才能启用嵌入预览；本地启动器自动设置。布局读取失败会显示可重试错误，不将默认版式冒充已发布结果。主题是独立的外观读取，最多等待一秒；异常时页面暂用默认外观并标记 `data-theme-source="FALLBACK"` / `data-theme-status="UNAVAILABLE"`，不阻塞支付回跳或查单，不冒充已发布主题。

前台选择艺人、礼物、署名/留言后结账，支付页面明确为 TEST，无须输入卡号。付款结果由服务端签名回调确认。测试邮件进入本地收件箱，使用其中的安全链接查看订单；管理中心可审核留言、准备、送达和按权限退款。独立复核身份用于需要第二人审核的配置和内容流程。

## 停止、重启与状态

```sh
pnpm local:status
pnpm local:stop
pnpm local:start --open
```

停止只关闭本实例进程与容器，保留数据库、媒体和密钥。启动地址与密钥固定，不会因为重启让旧订单的加密内容失效。状态检查四个实际应用，监督进程存活不代表全部健康。单仓库只允许一个本地实例占用 Next 生成目录。更新源码后先停止再启动，以加载新的 API/Worker；全仓 production build 也应先停止本地体验，避免同时修改 Next 生成目录。

私有状态位于 `node_modules/.cache/fan-support-local-experience/default/`，权限目录0700、配置0600。不要删除整个 node_modules、复制配置到公开目录或提交到 Git。完整备份需停止后一起保存该实例目录；仅备份数据库而丢失密钥不能恢复私密留言。此目录是本机开发数据，不替代生产备份和灾难恢复演练。

`--instance <名称>` 可建立独立验收环境。`local:reset --confirm <instanceId>` 是显式清空操作，只接受状态中的完整实例ID，运行中不允许清空；日常无需使用。

## 开发模式提示

本地前台使用 Next 开发服务器。私密订单页可能出现红色「1 Issue」调试徽标：已核实为 React 开发版尝试使用 eval 重建调试堆栈，被页面的严格 CSP 拒绝。实际订单查询与操作验收通过，未出现 pageerror；这不等于控制台完全无提示。保留 CSP 防护，未添加 unsafe-eval。生产版 React 没有这段开发探测，但生产部署的浏览器验收仍需单独完成。诊断见本轮 `root/development-csp-note.md`。

## 验收与范围

本轮已通过 FULL799 + RESTART109 断言和55次axe，权威结果见 `output/checks/p5-08-local-deployment/final-verification.md`。专项入口：`pnpm verify:local-experience`；浏览器与重启验收在独立实例执行，不能清空用户实例。

默认本地模拟支付并非 PSP sandbox 或真实资金验收。AWS staging plan/apply、DNS/TLS、IAM/KMS、实际云对象存储、CloudFront/WAF/预算/配额、真实身份与邮件、正式内容与支付批准仍是原有外部验收项；生产 runtime 的配置装配须逐项验证。离线基础设施操作见 [infrastructure-offline.md](infrastructure-offline.md)。

2026-09-28 新增独立 Stripe TEST 接线选项：仅新建 `test-` / `acceptance-` 实例可使用 `--payment-provider stripe-test`，已存在实例不能更换提供商。默认实例仍使用本地模拟支付。Stripe 模式需独立启动官方 CLI 转发，并仅在 API 进程环境提供 `PAYMENT_SECRET_STRIPE_API` 和当前转发器对应的 `PAYMENT_SECRET_STRIPE_WEBHOOK`；不要把密钥放进命令参数或实例配置。2026-09-28 已在独立实例完成本站 Stripe 测试付款、验签入账、TEST邮件查单、后台部分退款与重复回调验收；这仍不代表正式商户、真实邮件或生产收款通过。详细范围以 [上线进度](../progress/launch-progress.md) 为准。
