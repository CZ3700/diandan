# 交接：R1 中段检查点（生产组合根、两家 PSP 适配器、三项减摩擦）

> 日期：2026-09-26
> 项目：`C:\Users\admin\Desktop\下单\下单`
> 分支：`v2/r1-production`（已推送 origin，工作区干净，HEAD `973bbfa`）
> 新会话冷启动：先读本文件，再读 `docs/progress/v2-progress.md` 的 R1 与"R2 并行减摩擦项"两节

## 背景

R0 完成后（见 `2026-09-26-r0-to-r1.md`），本会话按交接清单推进 R1：生产组合根、PSP 适配器（Stripe、Airwallex），以及方案 §4 可并行的前台减摩擦项。R1 尚未完成。剩下的大部分条目依赖外部输入（沙盒凭据、CI 运行授权、邮件/身份服务选型、云资源），所以在这里停下，留一个检查点。

## 已完成（全部已推送；每次提交前 `pnpm check:dev` 通过）

| 提交 | 条目 | 要点 | 状态 |
|:--|:--|:--|:--|
| `4611513` | R1-1 生产组合根 | 生产 API 注册全部路由；配置组"全缺=不可用、部分缺=启动失败"；共享连接池引用计数；worker 管理中心循环 | LOCAL_ACCEPTED |
| `2c61c2b` | R1-1c 测试组合出库 | Test/Local 组合迁入 `src/testing/`，部署产物不含 `dist/testing`；导入图守卫 | LOCAL_ACCEPTED |
| `e45190f` | R1-3 Stripe | Checkout 托管页；持久幂等（先查后建、metadata 检索）；设计见 `docs/plan/r1-03-stripe-adapter.md` | IN_PROGRESS（等沙盒） |
| `7862f4b` | R1-3b Airwallex | 托管页 SDK 组件动作 `airwallex-hpp`；前台补 `PROVIDER_COMPONENT` 分派；设计见 `docs/plan/r1-03b-airwallex-adapter.md` | IN_PROGRESS（等沙盒） |
| `068fa47` | §4-1 同意框合一、§4-5 状态四态化 | 一个勾选框，同意语带全部政策链接；`@fan-support/orders` 粉丝状态映射（全部 500 种组合穷举测试） | LOCAL_ACCEPTED |
| `973bbfa` | §4-2 价格直显（第一阶段） | 唯一市场时详情页价格流式出现，艺人页目录直接显示价格；ADR-017 增补 | LOCAL_ACCEPTED |

实现记录：`docs/plan/v2-friction-items.md`（§4 各项）；运维配置：`docs/runbooks/production-configuration.md`（含两家 PSP 的凭据、webhook、CSP 要求）。

## 关键决策及理由

1. **Airwallex 用 `PROVIDER_COMPONENT` 而不是 REDIRECT。** 官方文档与 SDK 源码都显示，托管页只能由浏览器 SDK 的 `redirectToCheckout` 打开。SDK 内部拼出的 `#/standalone/checkout?…` URL 没有公开文档，服务端自己拼的话，Airwallex 一旦调整就会无预警断付。两种能在服务端拿到 URL 的方式都不合适：Payment Links 只有中英文且强制填姓名邮箱；Billing Checkout 要预建价格、会生成发票。前台的组件分派 PayPal 也要用。
2. **Airwallex 重复的 `request_id` 返回 `duplicate_request`，不重放原响应**（与调研记录相反）。恢复方式：创建按 `merchant_order_id` 反查，退款按 `request_id`/metadata 反查，取消读取当前状态。
3. **client_secret 只有 60 分钟有效。** 所以部署 Airwallex 账户时，`actionTtlMs` 超过 55 分钟会导致启动失败（现有配置 1–5 分钟）。
4. **SDK 不加 SRI**：它是 Airwallex 原地更新的常青脚本，主包由加载器动态注入，固定哈希只会断付。风险靠三点控制：只在点"去支付"时加载、加载失败时留在结账页、R1-6 用 CSP 白名单收口。token 解码与启动器懒加载，首屏不引入 zod。
5. **价格直显保持流式。** 最初在页面入口和公共页壳上等待商业上下文，但这破坏了已有测试保障的"页壳与内容先于上下文流式输出"（上下文接口慢或宕机时站点照常渲染），已回退。改为只在已有的 Suspense 位置接入：详情页的市场选择位、艺人页目录。第二阶段（`/gifts` 与首页目录带价、规范 URL、页眉/页脚地区入口）需要先调整流式结构，并入 §4 第 3 项首页改版。
6. **同意框合一不改动法律留痕**：服务端仍按政策逐条记录 key/版本。欧盟 extraConsents 与德国付款按钮文案延后到对应市场上线。
7. **状态四态化**：核查暂停显示为"准备中"，争议不进入粉丝文案；四个规范状态轴保留为 data 属性，供脚本和客服读取。"退款中"需要读模型提供进行中退款的标记（合同 + PostgreSQL），列为缺口。

## 在途与待外部

- **沙盒凭据（用户操作，不要在对话里贴）**：写进仓库根目录 `.env`（已被 git 忽略）。
  - Stripe：`STRIPE_TEST_SECRET_KEY`；webhook 实收需要 Stripe CLI 提供 `STRIPE_TEST_WEBHOOK_SECRET`。
  - Airwallex：在 https://www.sandbox.airwallex.com/global/signup 注册，从 Developer → API keys 取得 `AIRWALLEX_TEST_CLIENT_ID`、`AIRWALLEX_TEST_API_KEY`。
  - 运行：`pnpm --filter @fan-support/payment-stripe sandbox`、`pnpm --filter @fan-support/payment-airwallex sandbox`。Airwallex 脚本会在 `http://127.0.0.1:4243/` 提供启动页，用测试卡 `4035 5010 0000 0008` 付款。
  - Airwallex 联调必须核对：
    - 托管页回跳 `return_url` 是否追加查询参数（前台返回页目前拒绝 `session`/`attempt` 以外的参数）；
    - SDK `env: "sandbox"` 是否正确；
    - client_secret 长度；
    - 两种凭据的实际格式。

    脚本会把这些事实写进 `output/checks/r1-03b-airwallex-sandbox/`。
- **CI 验证需要用户决定**：`v2/r1-production` 没有 PR，所以 CI（PostgreSQL、S3、浏览器回归）没有跑过本分支。开 PR 会消耗 Actions 分钟，而且基线本来就红（R0 PR #13 的 quality/journey/commerce/catalog 四组既有失败）。
- **既有问题**（均未处理）：
  - `pnpm deploy` 安装阶段缺 `@opentelemetry/core` 对等依赖，Docker 镜像构建会失败，归 R1-9；
  - CI 四组回归失败，单独立项；
  - 本机高负载时，`persistence-postgres` 的 3 个慢测试和 admin `center.test.tsx` 偶发 5 秒超时，单跑都能通过。
- R0 交接遗留的决定（main 分支、`output/` 历史文件、归档目录、远端 `codex/*` 分支）仍待用户拍板。

## 下一步（按优先级）

1. 用户提供两家沙盒凭据 → 跑联调脚本 → 按联调结果修正（重点是 Airwallex 的四个核对项）→ 两家都转 LOCAL_ACCEPTED。
2. 用户决定是否为 `v2/r1-production` 开 PR 跑 CI。建议开草稿 PR，让 PostgreSQL/S3 真实测试覆盖 R1 的改动。
3. §4 第 4 项订单公开短号：`public_order_no` 迁移、生成（前缀 + 6 位 Crockford base32 随机码，冲突重试）、查单/邮件/成功页/客服全用短号。数据库部分依赖第 2 步的 CI。
4. §4 第 3 项首页改版，同时完成 §4-2 第二阶段。
5. R1 其余条目：
   - R1-6 缓存 + CSP（结账页须放行 Airwallex 源站，见 runbook）；
   - R1-7 可观测：可在本机先做日志事件枚举补全（review_required 被吞）和真实健康检查；
   - R1-2 i18n 门前移：en 源需要人工审校 APPROVED；
   - R1-8 DB 加固：依赖 CI；
   - R1-4 邮件、R1-5 后台身份、R1-9 部署流水线：需要外部账户或云资源。
6. PayPal 适配器，放到前两家沙盒跑通之后：组件动作已具备，还需服务端 capture 回调和 RSA 证书验签。

## 环境注意（在 R0 交接基础上新增）

- `python3` 是 Windows 商店占位程序（exit 49），要用 `/d/python/python`。
- **离线安装会把 lockfile 里的 `third-party-web` 从 0.29.2 升到 0.30.0**，每次 `pnpm install --offline` 后都要检查 `git diff pnpm-lock.yaml | grep third-party-web`。本会话用下面的脚本回退，然后以 `pnpm install --offline --frozen-lockfile` 确认：
  ```python
  import io,re
  p='pnpm-lock.yaml'; s=io.open(p,encoding='utf-8').read()
  s=s.replace("      third-party-web: 0.30.0\n","      third-party-web: 0.29.2\n")
  s=re.sub(r"\n  third-party-web@0\.30\.0:\n    resolution: \{integrity: [^}]+\}\n","\n",s)
  s=s.replace("  third-party-web@0.30.0: {}\n\n","").replace("  third-party-web@0.30.0: {}\n","")
  io.open(p,'w',encoding='utf-8',newline='\n').write(s)
  ```
- 已 `git add` 的文件，`git checkout -- <file>` 恢复的是暂存区版本；要回到提交版本，用 `git checkout HEAD -- <file>`。
- 前台所有 API 读取都是 `cache: "no-store"`；`readCommerceContext` 按请求去重（React `cache`）。
- 前台测试大量 `vi.mock` 页面读取模块。给这些模块加导出时，要同步所有 mock，否则会连锁失败，报"No export defined on mock"。
