# P5-05 本地依赖只读核对

Reviewer: `/root/refund_admin_audit`，2026-09-22。未领取或实施 P5-05。

## 结论

P5-05 的原直接依赖 P5-01、P5-04 在本地范围已有完整验收及非作者复核，输入没有因新增 finance 合同失效。仍须由 root 完成 P5-03 当前候选统一验收、协调共享入口归属，然后登记 Lane C READY；本报告不将 P5-05 直接改为 READY/DONE，也不解除真实商户和发布门。

本次实际按 `output/checks/p5-04-payment-health/candidate-source-final.json` 逐 SHA 比较选定源码：identity/OIDC/admin-access/0030 共 19/19 文件相同；payment capability/routing/health/runtime/gateway/port/0033-0034 共 85/85 文件相同，详单为 `ui-next-stage-source-compare.json`。这不是全仓所有文件的兼容结论；root 另核对 659 旧合同根保持。

P5-01 已验收的平台角色、每次服务端授权、可撤销会话、CSRF、MFA 和 append-only 审计可直接复用，不能从浏览器角色名称推断支付配置发布权限。本轮 finance 仅增加固定 BFF operation 映射、管理中心订单页资金面板，未改变身份合同、角色来源或通用 CSRF/session 路由。当前七语 finance 浏览器首次登录超时正在和 runtime owner 定因，此报告不将尚未完成的新增 UI 流程计为通过。

P5-04 最终 `final-verification.md` 和 `final-independent-review.md` 已闭合早期 `next-stage-readiness.md` 的条件：能力/确定性选路、版本、稳定灰度、健康 PG/HTTP/有界恢复、原支付七语双端和最终全仓门通过。19/85 文件比对与当前 `payment-runtime-health.ts`、`payment-health-repository.ts`、gateway `registry.ts` 复读支持继续消费该本地输入。

## 必须在 P5-05 保留的边界

1. 配置 author/draft/validate/publish/rollback 使用独立 Zod/schemaVersion 合同和固定 BFF operations；不扩写本次 finance command，也不把 PSP TEST 的直接 SQL publication 夹具当管理功能。
2. 管理中心继续一个共享入口。先协调 `center.tsx`、`hub.tsx`、`shell.tsx`、`server/admin-operations.ts` 及 API bootstrap 的文件归属，再接入配置分区；避免与 finance 验收并行改同文件。
3. gateway `applyPublishedSnapshot` 接受已发布可信投影，保留历史账户绑定，拒绝旧 revision/同 revision 内容漂移；旧付款与退款恢复始终使用原账户、原 attempt/receipt，配置停售不换路。
4. 当前健康政策仍在 runtime 构造期 bootstrap；已存在状态遇不一致 policy 返回 POLICY_CONFLICT，新账户没有 policy 封闭准入。P5-05 必须实现发布与 policy 激活、已部署 adapter directory、多实例传播协调，不能仅替换配置 JSON。仅允许静态部署 adapter 的版本化配置，不上传执行代码。
5. 七语渠道关键名称/提示、差异预览、二次确认、Manager 授权、原因/版本/幂等和不可变审计；非法/空路由或关键译文缺失拒绝；发布 ≤60 秒、回退 ≤1 分钟及传播失败重试均需新真实本地证明。本次 finance DRAFT 译文不成为关键支付配置的人工批准。

新增 finance 独立表与命令不占用配置发布状态机，也无新的 config publish 阻断。须保留真实商户/PSP sandbox、小额资金、正式 Secret、获批译文、多进程/staging 与上线审批范围；本地已授权排期不需要重复请求开发许可。

## 当前验收保留（2026-09-22 21:01 UTC 浏览器轮之后）

P5-05 接续目前继续 pending：20:56 曾完整功能PASS，但最后样式/语义候选的21:01轮在第5个Order Operator语言登录发生 begin200→callback303→session401，47PNG/0违规/0incomplete/0页面错误后等待超时。callback303同时用于成功和失败，且UI会移除login=failed query；需要runtime按安全诊断辨明真实分支、原凭据与PG challenge/session。不得据19/85文件无漂移就忽视实际登录不稳定，也不把此前功能PASS替代该候选完整验收。身份问题定因/必要修复+完整acceptance结束后由root统一决定READY，不提前推进配置发布。

21:01后续定因：协调者已确认上述身份失败为本机PG墙钟回拨的两种表现（session created_live=false约61.9ms；callback complete早于claimed触发0030 check3），生产规则保持。当前输入源码并无新的授权缺陷改动；TEST夹具的精确因果恢复仍需42次认证stress及完整HTTP/UI确认。P5-05依然等whole-run闭合及owner冻结，不提前READY。


## 最后输入 SHA 与 TEST hook 复核

本次在TEST时钟候选冻结后重新实际比较，`ui-next-stage-source-compare-final.json`：identity 19个选定输入现在18/19相同，唯一变化是 `packages/identity-oidc/src/test-support/https-idp.mjs`；payment输入仍85/85相同。此前19/19是修改TEST IdP前的历史快照，不能再表述为当前19/19。

独立实读该diff：只在已校验的本地授权code内存记录state，并在 NORMAL token响应前调用可选 `beforeValidTokenResponse({ state })` 测试hook；未传hook的原模式不走任何新增业务检查，未变更生产OIDC adapter、身份/session、CSRF/MFA、Cookie或provider验证。state只在TEST内存和指定hook间传递；不作为日志/截图输出。本人已重新执行原 `@fan-support/identity-oidc test`，2文件/75测试PASS（`ui-oidc-input-tests.log`），而非只引用早期验收。TEST两类时钟因果门的8测试、42次stress与最终全UI仍由root/runtime最终证据承接。
