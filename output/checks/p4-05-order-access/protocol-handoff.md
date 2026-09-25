# P4-05 order-access protocol handoff

Owner: `/root/access_protocol`。生产 base `ab0b137`；首轮新增 `apps/api/scripts/order-access*.mjs`，未修改旧 checkout/payment/media fixture、生产 API/PG、支付业务状态或发布 guard。本文件首次落盘后已 freeze，随后仅按 root 明确分配修正五个旧 rollback-proof helper 的 0028 头兼容；详情与 RED/GREEN 范围见 `protocol-notes.md` 最后一节。该兼容补充完成后再次 freeze，交 root 原质量门。

## 最终开发验收

- `mise exec node@24.20.0 -- node --test apps/api/scripts/order-access-*.test.mjs`：7 PASS，4.132 秒；`ingress-final.log`。
- `mise exec node@24.20.0 -- pnpm exec eslint apps/api/scripts/order-access*.mjs`：exit 0；新文件均已 Prettier。
- `mise exec node@24.20.0 -- node apps/api/scripts/order-access-http.mjs`：exit 0，6,860 断言，包含 setup 5,763 / 本协议 1,097；`http-sixth.log`。
- 最终完整证据：`run-2026-09-15T13-11-19.689Z/protocol-checkpoint.json`、`protocol-results.json`、`fixture-manifest.json`、`run-result.json`。最终 PASS，owned cleanup 已执行；没有启动浏览器。
- 原根级 format/lint/typecheck/build、全仓 PostgreSQL 与旧浏览器门由 root 在冻结候选上执行；不能把本次 scoped PASS 冒充全仓验收。

## 实际覆盖

正常购物车、checkout、独立持久 TEST PSP 托管页结算、已认证 reconcile、原 Application 应用付款后，建立七语言订单及一个中文 DAILY 原文订单。8 个已付订单、36 次 checkout client 请求、26 次 payment client 请求；没有直接 UPDATE 订单、付款、库存或译审状态。

内部 issue，公开 exchange，原 cart Cookie/CSRF + 实际 PAID 的 bootstrap，独立 order Cookie 的 read/revoke；未付款、跨单、缺失/错误凭据、Origin、独立 CSRF、重复 Cookie/Origin/CSRF、未知字段、非法 token、请求体上限及全部 GET query 拒绝。Cookie 检查 Secure/HttpOnly/Strict/host-only、private no-store/noindex/no-referrer，JSON 和实际 API 日志检查凭据及私密 canary。

一次性 link 消费、并发只一次成功、代次与会话撤销、真实 token/session 到期、仍有效 checkout 恢复、KMS 暂时不可用/版本不可用失败关闭。真实事务 callback 在 writes 后 COMMIT 前注入异常，观察 link/session/audit 一并回滚；后续同 link 正常 exchange 成功。

真实 HTTP socket 丢失全部响应，以及仅丢 JSON body、已收到 Cookie 两种情况。收到 Cookie 的 GET 恢复始终持有已知 publicOrderId；没有证明 Cookie 可以发现订单。Cookie 和 JSON 全丢且无有效 checkout 时，需要未来新 link。

七语言原图与 DAILY 历史图都实际读取 TLS S3 DERIVATIVE。通过原管理 authoring/review/publication API 正常改名、替换艺人 PORTRAIT、礼物 PRIMARY 和详情图、改价 1500→1637、归档艺人与礼物；8 份历史 DTO 严格相等。独立第二媒体 origin 使用同 TEST CA，实际 S3 可读且历史路径、alt、locale、价格、原文均保留。

19 张业务表全行规范化指纹与 PSP 计数在查单/授权操作前后相等；普通读取未增加 KMS Decrypt。访问自身的 session/audit/rate 状态允许正常变化。最终 EXCHANGE 限流跨两个 API 实例持久化，忽略伪造 X-Forwarded-For，返回 429 + Retry-After；不把它扩大为四个 scope 的完整 PG 生命周期证据。

## 失败与修复证据

详细时间线在 `protocol-notes.md`，保留全部五次失败，不覆盖为成功。

1. 首次媒体失败发现生产历史 DTO 输出私有 SOURCE key。PG 作者通过有效 RED→GREEN 改为冻结 asset/master lineage 对应的 READY DERIVATIVE；未开放 SOURCE，后续实际 S3 通过。
2. 第二次重复 header 探针缺 Host，Node 在业务层前 400。新 raw helper 的独立真实 HTTP RED→GREEN 保持重复原始 headers，同时补合法 Host/Content-Length；生产 guard 不改。
3. 第三、四次礼物 preflight 拒绝：第四次实际否定“替换 PRIMARY 引用过旧”假设。第五次真实读取确定原详情 metadata 已 SUPERSEDED。独立 `review-rose-master-probe.log` 证明 legacy Rose 与 DAILY Rose 同真实 master，所以正常 asset 去重和 DAILY 新 metadata 发布推进旧head。同步更新 PRIMARY/详情图及每种语言 metadata 引用，再正常审核发布；保留图注文案。
4. 第五次在历史比对通过后，第二 TLS gateway 同目录证书 `wx` 报 EEXIST。新增独占目录 helper，真实双 TLS 短探针 RED→GREEN、清理通过；旧 certificate helper 不改。
5. 第六次完整 6,860 PASS。API agent 已非作者只读复核最终 history/media/helper/rate 配置，无阻断。

## S.U.P.E.R 10 项（本子任务范围）

1–2：client、protocol、history、runtime、media gateway、response-loss gateway、observers、pre-COMMIT injector、entrypoint 各有独立职责，测试组织真实行为。3–4：测试只消费公开合同/Application/adapter composition，无反向依赖或循环。5–6：order-access/public authoring 输出经既有 schema 校验，持久报告只保留安全可序列化字段，raw credential 只在 callback 内存。7–8：TEST origin/密钥/目录/端口由隔离 runtime 提供，无生产常量或新依赖。9：两个新 gateway/helper 可独立替换，不改原 fixture。10：7 短测试 + 6,860 长链 PASS；全仓验收交 root，未宣称当前任务 DONE。

## 明确未完成范围

没有产品订单页面、真实浏览器 Cookie 行为、邮件发送/fragment 清除、生产商户或 PSP sandbox、真实 AWS KMS、staging/灰度、真实手机或正式素材/译审验收。旧 v1 历史兼容和 pepper 轮换来自其他单测，不将本协议冒充真实长链证明。没有推送或创建提交。
