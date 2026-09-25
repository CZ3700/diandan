# P3-01 基础审核与受控预览

Task P3-01 / checkpoint 4A；Owner Codex `/root`。测试命令前缀为 `mise exec node@24.20.0 --`。

## 使用顺序

1. 使用 3B 的作者接口为艺人、礼物、首页、政策或媒体元数据创建/复制不可变 revision。稳定 owner 沿用已有记录；政策首次注册与媒体管理入口仍为检查点 4 后续工作。
2. 调用 `POST /api/v1/admin/content-review/read`，传 `schemaVersion:1` 和 `target:{owner,revisionId,locale}`。取得该语言的内容、审核上下文及真实英语源稿。单语言审稿权限不会返回其他语言的内容或审核身份。
3. 原译文作者向 `/submit` 传当前 `expectedVersion`（该译文审核序列）、`expectedContentHash`、`expectedSourceHash` 与 `reasonCode`。语言来源过期或变量不匹配时先复制修稿，不能通过送审重绑来源。
4. 独立审稿人使用 `/approve` 批准。译文作者和当前结构作者不能批准新稿；未变原文的已批准复制保留原有三步审核链及 FK 证据。
5. 使用 `/preview/issue` 签发 60–900 秒预览凭证；实际期限不超过签发会话截止时间。凭证仅本次返回，丢失后重新签发，不能通过幂等记录找回明文。
6. 使用 `POST /api/v1/content-review-preview/read` 在 JSON body 中提供 `schemaVersion,target,token`。预览只读精确对象/版本/语言，缺译不回退英语；不返回审计身份、存储对象 key 或其他语言内容。关联媒体/首页对象引用不授予关联草稿访问权。
7. 签发者使用 `/api/v1/admin/content-review/preview/revoke` 撤销自己的 grant；要求当前会话、MFA 和基础预览权限，已撤去某种语言授权时仍可撤销自己的凭证。签发会话、MFA、权限或语言授权变化也会使后续预览失效。

管理端使用同源 Origin、opaque HttpOnly 管理会话和 CSRF header；提交、批准和撤销须提供 `Idempotency-Key` header。服务端填写 action、actor 与 request ID，浏览器不能注入。所有响应（含错误）为 private/no-store、noindex/nofollow、no-referrer，接口拒绝 query string，JSON 请求上限 64 KiB。

## 持久化与并发

- 授权、当前内容、审核、审计和幂等结果引用在同一 SERIALIZABLE 事务中处理。重放前仍验证当前权限；新操作再检查版本、来源、状态与独立作者。
- 0016 增加两张有明确对象 FK 的表：`base_content_review_receipts` 与 `base_content_preview_grants`。保留旧 233 合同，新增 13 roots。新审核只能写入 3B 作者收据所属 revision；历史稿可读，重新审核前先 COPY。
- 父 revision 先加锁；审核时间基于数据库当前时间和已锁定历史的因果下限，保持 UTC 微秒精度。直接绕过收据、伪造来源/审计/作者或改写历史将被正常数据库约束拒绝。
- 合法复制审批由 0015 的明确 source translation/review FK 证明；不能仅凭传入的 `inheritedFrom` 字段获得豁免。
- 有审核或预览历史时 0016 down 拒绝丢弃数据。后续问题使用保留历史的向前迁移。

## 可重复验证

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/contracts --filter @fan-support/content --filter @fan-support/application --filter @fan-support/persistence-port --filter @fan-support/persistence-postgres --filter @fan-support/api test
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test:postgres:base-content
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:base-content
mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs
mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs
mise exec node@24.20.0 -- corepack pnpm check
```

执行结果见 `output/checks/p3-01-base-content/README.md`。本检查点只交付受控内容数据与显式 TEST 组合；正式登录、管理页面与双端预览排版由后续任务接通。完整 revision 验证、发布/回退、公开扩展 DTO、outbox/purge 和 ≤60 秒可见性仍为 P3-01 必须完成的退出条件。
