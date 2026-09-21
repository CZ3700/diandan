# P5-03 — 管理中心取消、退款、拒付与对账

本轮基线 `17b7230195879bbb480fa343975574759b84d789`，分支 `codex/p5-03-refund-operations`。产品入口仍为原管理中心的订单详情与对账列表。实际商户 sandbox、真实资金、生产身份/密钥、关键文案人工译审、实体手机和 staging/发布不包含在本地证据内。

## 阅读顺序

1. `final-verification.md`：最终候选、实际命令、验收状态和剩余条件。
2. `failure-history.md`：原始失败与对应处理，不掩盖未复现的间歇失败。
3. `root-runtime-ui-review.md`、`runtime-independent-persistence-review.md`、`ui-independent-contract-review.md`：交叉非作者复核；`storage-review.md` / `ui-verification.md` 是作者自检。
4. `candidate-source-final.json` / `protection-final.json`：2462 个源输入指纹、5719 个原未跟踪文件、68 条旧迁移 SQL 和 34 个原 manifest 条目保护。
5. `ui-next-stage-readiness.md`：P5-05 的原直接依赖与当前输入核对，不等于领取或提前实现。

## 证据边界

- `storage/run-2026-09-21T20-36-06.340Z/`：6023 个真实 PostgreSQL 检查，其中5763前置、259新增场景和1源一致性。不是6023个独立金融用例。
- `regressions/`：5960原订单管理、6827原订单支付回归摘要，以及首次迟到付款断言失败。原始运行目录不改写。
- `../p5-03-finance/integration-*/`：每轮实际 HTTP / TLS OIDC / 独立持久 TEST PSP / 浏览器结果；必须读取最终验收指定的轮次，不能把部分通过当整轮通过。
- `contracts-compatibility.json`：659旧合同定义、108旧路径与旧OpenAPI组件保持，新总数679定义、113路径。
- `transcripts/`：验收收尾时归档的命令文本日志。`.log`原件仍在本地并保留，Git副本仅规范化行尾与尾随空白，归档清单记录原件和副本各自字节数/SHA。

复跑入口与日常操作说明见 `docs/runbooks/admin-finance-local.md`。运行 HTTP/browser 前先完成唯一一次 Next 构建，避免并行进程修改同一构建目录。

本机原生 PostgreSQL 18.6 的准备和隔离说明见 `native-postgres-tooling.md`；Docker墙钟失败、CPU对照、原生生命周期/时钟与TEST清理独立复核见 `storage-auth-clock-review.md`。当前完整浏览器结果须以最终验收指定的轮次为准。

版本化保存最终接受轮次的58张截图；中间失败轮次的JSON/命令日志也收录，其余截图与旧回归运行原件留在本地，未删除或改写。P5-03本地验收完成，P5-05 READY；真实商户等外部门保留。
