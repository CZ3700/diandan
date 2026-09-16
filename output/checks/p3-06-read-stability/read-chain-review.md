# P3-06 公开读取链独立复核

结论：找到并用无外部服务的四例探针证实了**事务错误二次分类丢失**，它会降低当前诊断精度；没有证据把它或正常 fixture 年龄认定为旧中文首页／日文艺人页 CONTENT_UNAVAILABLE 的根因。应优先完成已可确定复现的 TEST 网关逐跳响应头缺陷验证，同时保留旧两次失败未归因的事实。

## 范围与实际执行

基线 HEAD `995d1c5b8ca2285f2064820c772a0fb6345cab80`。只读公开 SSR、Application、PG 发布仓库／预检／时间／投影、事务分类、现有 TEST 诊断及生产 BFF。复用上轮 `fixture-age-hypotheses.md`、`read-failure-hypotheses.md`。只运行已构建模块的纯函数探针和轻量搜索；未启动数据库、Chrome、build 或重型测试，未更改生产源码。文中行号对应本次读取；网关修复由 order_view 并行负责。

## 确定发现：canonical 事务错误再次当 SQLSTATE 分类

艺人仓库的调用链：

1. `packages/persistence-postgres/src/publication-preflight-repository.ts:53` 调用 `baseContentRun`。
2. `base-content-data.ts:25–35` catch 把原 PG 错误转为 `PersistenceTransactionFailureError`。
3. `published-content-repository.ts:219–231` 外层 catch 再调用 `persistenceTransactionFailureFromPostgres`。
4. `transaction-runner.ts:40–45` 无条件重新执行 classifier；`errors.ts:29–41` 只识别 own data 的五位 SQLSTATE 或 cause，无法从 canonical 安全结构恢复原分类。最终落 `errors.ts:86–90` 的 `UNEXPECTED_ADAPTER_FAILURE`。

实际无 DB 探针：对各输入执行一次、两次 `persistenceTransactionFailureFromPostgres`，再用 `parsePersistenceTransactionFailure` 读取安全错误结构。

| 输入 SQLSTATE | 第一次 | 第二次 |
| --- | --- | --- |
| 40001 | TRANSACTION_ABORTED | UNEXPECTED_ADAPTER_FAILURE |
| 40P01 | TRANSACTION_ABORTED | UNEXPECTED_ADAPTER_FAILURE |
| 08006 | TEMPORARY_UNAVAILABLE | UNEXPECTED_ADAPTER_FAILURE |
| 55P03 | TEMPORARY_UNAVAILABLE | UNEXPECTED_ADAPTER_FAILURE |

复现命令使用 `mise exec node@24.20.0 -- node --input-type=module`，import 当前 `packages/persistence-postgres/dist/transaction-runner.js` 与 `packages/persistence-port/dist/index.js`，仅构造上述四个公开代码对象。未读取连接配置或私密业务值。

**影响范围：** `storefront-acceptance-diagnostics.mjs:187–195` 能识别最终 canonical 错误，但不能找回此前丢失的类别。艺人报 UNEXPECTED 时仍不能排除锁冲突／断连。首页的 `createResourceRun` 已采用 `resource-management-data.ts:32–36` 的 canonical-preserving 模式，因此两个页面的最终错误类别不能直接横向比较。修改分类本身不会使 Application 失败变成功，也不是重试修复。

**最小后续 RED：**

- 在实际 published repository load 的预检查询位置令 mock client 抛 40001、08006；断言穿过两层后仍保留 code、recovery、retryAfterMs，且不含原 message／SQL。现有 `publication-preflight-repository.test.ts:10–27` 只覆盖第一层，无法发现这个问题。
- 如果修公共 helper，增加“已 canonical 输入保持语义”的幂等用例，以及原始 PG／未知异常的既有分类用例；如果只修仓库，则复用现有 `parsePersistenceTransactionFailure` 模式。不要为获得分类把原 PG 对象放进公开错误。
- 如需捕捉下一次自然错误，使用 publication composition 实际 pool 的 TEST factory，在 query catch **首次包装之前**记录允许的 SQLSTATE 类别／阶段，原样再抛出。不记录 SQL、参数、message、detail、原 body。仅观测另一个 catalog/gift pool 会漏掉首页／艺人链。

## 时间与状态：已排除的一般说法和仍可证伪的条件

### proof_v2 正常时间推进不构成 TTL

`publication-preflight-repository.ts:98–118` 的 evaluatedAt 取 clock、transaction timestamp、主与媒体 snapshot 创建／生命周期／翻译审核、head.updated_at、扩展审核时间的最大值。`publication-preflight-shared.ts:46–62` 保留微秒比较；`publication-preflight-data.ts:52–96` 修复旧 draft DTO 的精度后再计算 hash。未发现稳定 v2 数据在 44 或 57 分钟时自动失效的期限。

copy source 没有逐个直接加入该时间下界，但 `publication-preflight-reviews.ts:64–111` 的 copy 检查对照 source／approval identity 与 hash，没有额外的 source time <= evaluatedAt 拒绝。因此目前不能把“遗漏 copy timestamp”当成立原因。媒体 lineage 验证同样主要比较身份／hash／rights／processing 状态；未找到未覆盖的时间门。

rights 读取检查 APPROVED、processing 检查 READY（`publication-preflight-assets.ts:37–39`），并非按 now 自动变 EXPIRED。manifest canonical 集合排序由 `publication-manifest-canonical.ts` 统一处理，某查询无 ORDER BY 也不能直接推断 hash 偶发变化。

### 真实并发写与 SERIALIZABLE 仍有可验证失败窗口

首页和艺人 manager 均 SERIALIZABLE（`postgres-persistence.ts:1064–1079,1227–1240`）。published repo 先读取 head／publication（`published-content-repository.ts:82–89`），之后 preflight 才共享锁 owner/head（`content-authoring-data.ts:23–42`、`publication-preflight-repository.ts:59–74`）。如果合法写事务在 reader 建立 snapshot 后、共享锁前更新并提交相关行，reader 可因 post-snapshot row lock 冲突失败；事务 runner 不自动重试，Application 归并为不可用。

最小真实 PG 反证实验应使用两个受控事务和一个 barrier：A 完成初始 head read 后暂停；B 走正常发布／回退入口完成；A 恢复预检；记录首次 SQLSTATE 与统一失败、下一次独立读取恢复。反向序列先取得共享锁再提交 writer 应正常等待。只读／只读的 SHARE 不能凭空解释死锁。**本轮没有执行该实验，也没有证据证明旧失败当时确有并发写。**

### proof_v3 只保留为条件分支

`daily-publication-read.ts:43` 使用裸 clock_timestamp；`daily-publication.ts:138` 检查 publishedAt <= evaluatedAt。若未来失败确为 v3，且捕获时间倒序，可单独验证时钟回拨。但当前 acceptance author／approve／publish seed 走 v2；不能将 DAILY 的理论边界迁移成旧故障事实。

## 读取阶段与诊断判定

- `public-catalog.ts:99–148` 把 fetch、JSON、schema、status／locale 或配置错误归并为 CONTENT_UNAVAILABLE；8 秒 timeout 不是所有失败都会等满。Document 200 是错误页自身响应，不证明内部 API 成功。
- 首页 repository LOAD 已包含主 homepage 投影，且 HERO_IDOL 不可用会使整页失败（`storefront-homepage-repository.ts:41–57,117–131`）。艺人 LOAD 返回 context 后，Application WORK 再投影；同名诊断阶段对两者并非完全同一校验范围。
- root 原诊断 27 个有效 LHR 的 fixture 年龄仅 6–9 分钟且没有重演全部 UI 历史；它不能替代年龄更大且有 UI visibility mutation 的旧两轮 formal 失败。新本轮重演由 root 负责。
- 下一次自然失败应先判 API 是否真实 503；API 已成功而 Next／gateway 失败时优先查 HTTP。API 明确 503 后再看 query 类别或 repository／projection 的固定拒绝阶段。不应先放宽 rights、proof、隔离级别或添加掩盖失败的无条件重试。

## 网关缺陷的限定范围与生产旁查

基线 `apps/api/scripts/gift-storefront-next.mjs:40` 将 upstream.headers 整体送给独立 Node HTTP response。root 提供的 `gateway-keepalive-actual-close.json` 显示原网关声明 timeout=72，却在首字节后约 6003 ms 正常结束 idle socket；这是确定的连接生命期声明不一致。`gateway-keepalive-boundary-probe.json` 的 41 次正常 native fetch 边界试验全部成功，所以**声明缺陷已经证明，旧两次自然 CONTENT_UNAVAILABLE 的因果尚未证明**，也不能称已复现旧错误。

只读生产旁查未发现同一响应盲转模式：

| 边界 | 已核对行为 |
| --- | --- |
| `apps/storefront/src/server/public-catalog.ts:114–133` | 仅解析校验后的 JSON，不返回上游 Response／headers |
| `cart-proxy.ts:339–366` | 固定隐私头 + 验证后 Cookie／CSRF，重建 JSON Response |
| `checkout-proxy.ts:410–429` | 固定隐私头 + 验证后 Cookie／CSRF，重建 JSON Response |
| `order-proxy.ts:135–143` | 固定隐私头 + 验证后 Cookie／CSRF／Retry-After |
| `apps/admin/src/server/admin-api-client.ts:99–102` | 固定 ADMIN_PRIVACY_HEADERS 重建 JSON Response |
| Storefront／Admin `src/proxy.ts` | 复制的是传给 Next 的请求头，不是上游响应头 |

同型搜索还在 `apps/api/scripts/storefront-http.mjs:150`、`order-access-gateway.mjs:60`、`checkout-preflight-gateway.mjs:65`、`cart-storefront-gateway.mjs:94` 找到其他 TEST gateway 的整头转发；需按实际 HTTP／inject 用法分别评估，不能把这次窄修扩成已覆盖所有测试网关。此次只作范围提醒，不建议为本故障重写它们。

## 最终状态

只读审查完成；可行动发现是保留 canonical 分类的最小测试／后续修复候选。当前产品源保持，旧故障根因仍待同请求证据，本报告不宣布 P3-06、formal performance 或人工体验门完成。网关新 diff 的独立质量复核另存 `gateway-independent-review.md`。
