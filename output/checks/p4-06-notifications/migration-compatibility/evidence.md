# 0029 compatibility for existing downgrade proofs

范围：10 个既有测试脚本及一个共用测试前缀。未修改产品源、迁移 SQL、迁移执行器或业务历史。源码已冻结，11 个文件的 SHA-256 在 `source-frozen.json`。

## RED / root cause

- 已读取 `../check-full-2-result.json`：原单条 `mise exec node@24.20.0 -- corepack pnpm check` exit 1，174.870 秒。
- 已读取 `../check-full-2.log`：完整 29 迁移往返及前序 PostgreSQL 检查通过后，`postgres-catalog-directory` 在旧历史回退入口失败，确切原因为 `down migration confirmation must match the applied head`。
- 该测试与 7 个同类入口从全迁移后的 0029 直接要求 down 0028；另有 2 处“当前头”断言仍固定 0028。原目录测试还把恢复后的迁移总数写为 28。这是测试链漏接新迁移，不是迁移需要放宽。

## Change and protection

新 `notification-rollback-prefix.mjs` 先真实查询并精确断言：当前头为 0029，`notification_runtime_state`、`notification_contact_access_receipts`、purpose 为 CHECKOUT_BOOTSTRAP 的 access token、SYSTEM/CHECKOUT_QUOTE_EXPIRED order event 均为 0。随后通过正式 `runMigrations` 执行 down 0029，断言只回退 0029 且头为 0028。没有删除行、改状态、清空历史、禁用触发器或直接跳到旧 SQL。

这些旧夹具的业务目的分别是目录、管理发布、购物车、checkout、支付与订单付款；源码未启动新通知处理、order-access bootstrap 或 commerce expiry。前三条带历史的实际 PG 运行也证明了上述新增历史为空。API 五入口的数据库实证保留给下一条完整检查；若它们产生了新历史，前缀会明确失败，不能悄悄删历史或绕过 0029 down 拒绝。

8 条旧 down 链都接上该前缀，再按原顺序执行 0028 及后续迁移。原来的数据损失拒绝、精确错误码/错误文案、历史行数/哈希保持检查不变；admin/publication 另外比较新前缀前后的历史内容。最终恢复断言为 0029；目录总数为 29。五个固定断言计数的 rollback proof 各加上前缀的两项断言。

额外修正：`postgres-content-draft-repositories.mjs` 与 `postgres-publication-validation-time-cases.mjs` 的当前头断言改为 0029。全量扫描 apps/packages/scripts 中 0028 和迁移数量 28，剩余匹配均是合法旧迁移路径、中间头、旧 migration 自身的专门约束测试或无关 UUID；未将应保留的历史版本机械替换。

## Actual GREEN

全部命令从仓库根运行，前缀为 `mise exec node@24.20.0 -- node`；以下每项均具有独立 `.log` 与 `-result.json`，使用各自真实 ephemeral PostgreSQL，未重新共享 build。

| 脚本 | exit | 耗时 | 实际结果 |
| --- | --- | --- | --- |
| `packages/persistence-postgres/scripts/postgres-catalog-directory.mjs` | 0 | 26.450 秒 | 315 assertions；120 artists/120 gifts；7 locales；normal triggers |
| `packages/persistence-postgres/scripts/postgres-admin-catalog.mjs` | 0 | 8.902 秒 | 285 assertions |
| `packages/persistence-postgres/scripts/postgres-publication-runtime.mjs` | 0 | 12.087 秒 | 477 assertions |
| `packages/persistence-postgres/scripts/postgres-content-draft-repositories.mjs` | 0 | 2.774 秒 | 64 assertions；7 locales；10 tables |

11 文件定向 Prettier check exit 0、ESLint `--max-warnings=0` exit 0，命令/耗时见 `format-result.json`、`lint-result.json`；`git diff --check` 同样 exit 0。

## Still pending in the next full check

按 root 指示，没有额外重复启动下列五个 API 全夹具；由新冻结源码的下一条完整 `pnpm check` 逐项实际执行：

| API npm script | 原入口 | 受影响 proof |
| --- | --- | --- |
| `test:postgres:cart` | `cart-http.mjs` / `cart-http-daily.mjs` | `cart-runtime-rollback-proof.mjs`，PENDING 与 DYNAMIC 两模式 |
| `test:postgres:cart-storefront` | `cart-storefront-http.mjs` | `cart-edit-rollback-proof.mjs` |
| `test:postgres:checkout-preflight` | `checkout-preflight-http.mjs` | `checkout-preflight-rollback-proof.mjs` |
| `test:postgres:payment-runtime` | `payment-runtime-http.mjs` | `payment-runtime-rollback-proof.mjs` |
| `test:postgres:order-payment` | `order-payment-http.mjs` | `order-payment-rollback-proof.mjs` |

不能把四条定向 PASS 表述为这些 API 或最终全仓已通过。新 helper 名为 notification-*，会由通知集成现有输入扫描纳入其后采集；最终整仓输入与结果仍由 root 重新冻结/验收。
