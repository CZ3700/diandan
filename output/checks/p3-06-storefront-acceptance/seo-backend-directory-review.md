# SEO 后端非作者复审

复审者 `/root/storefront_directory`；作者 `/root/storefront_read`。只读复审，无产品源码改动。

结论：本次限定范围 ACCEPT，无必须修复的具体阻断项。

范围：`contracts/content/application/persistence-port` 中 storefront-seo.ts，`persistence-postgres` 的 storefront-seo-data/repository 及 postgres-persistence 中专用 manager，API storefront-seo-route。另检查对应测试。未审 root 正在接线的前端 SEO 页面或新增 public-revalidation helper。

- 候选由真实 current publication heads、proof_version 2、类型/owner/revision、发布或历史回退生命周期绑定；IDOL/GIFT 包含 active/paused，归档不列入；policy effective_at 使用同一事务时钟。全量候选仅紧凑身份/版本，内容只 hydrate INDEX 的最多20项。
- entity 根据真实 canonical candidate 校对稳定 owner key / locator；复用原 published-content 的 manifest / metadata / rights gate，为所有 locale 验证真实 translationRevision 与同一 publication。HOME 额外沿用完整 homepage hero 可用性门。候选坏证明使整个 INDEX CONTENT_UNAVAILABLE，未伪装为空列表。
- INDEX 与 CATALOG 使用固定 C 排序和 keyset / boundary cursor；操作类型、canonical base64url、catalogVersion、anchor 存在性和响应顺序/基数被校验。未知/跨操作游标、版本改变有明确失败响应；没有以 cursor 作为授权凭据。
- enumeration 与后续 entity load 共用专用 SERIALIZABLE 事务和同一个 PG client；新 manager 没有改变既有 manager 配置。实体响应只包含 locator、public publication proof、locale 与来源/lastModified，不含私密业务数据或商业默认选择。
- API 对未知/重复 query 参数拒绝，响应 kind/locator 要匹配请求；失败使用明确4xx/503和no-store。成功经 root 的独立 revalidation helper 输出，其实现不在此复审结论内。

独立轻量执行全部 exit0，共19 tests：

| 日志 | 结果 |
|---|---|
| seo-backend-contract-independent.log | 2 tests |
| seo-backend-projection-independent.log | 3 tests |
| seo-backend-application-independent.log | 6 tests |
| seo-backend-persistence-independent.log | 4 tests |
| seo-backend-route-independent.log | 4 tests |
| seo-backend-persistence-lint-independent.log | 4个PG源码/测试文件 ESLint 0 warning/error |

范围限制：这是静态与单元的非作者复审，不等同于实际 SEO PG/HTTP/Next/Lighthouse 验证；真实联调由 root/E2E 完成。global catalogVersion 对候选、媒体状态及历史 manifest 做聚合，保证保守失效但全量扫描/聚合成本会随历史增长；“最多20项”仅描述本次内容 hydration，不应宣称整个 SQL 的扫描工作量恒定。当前尚无数据证明该成本成为任务阻断，性能结论必须以实际样本测量为准。
