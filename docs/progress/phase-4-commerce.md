# Phase 4 — 加购、结账与订单闭环

> 状态：ACTIVE
> 任务：6  
> 解锁条件：通常须 Phase 3 退出；2026-09-08 按用户继续下一阶段与 ADR-013 启用本地开发例外，P3 未完验收保留

## 目标

形成选择偶像、礼物、私密留言、测试付款、canonical 订单及查询读模型、安全查单与通知的真实纵切片。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P4-01 | DONE | Codex `/root` | P1-03/04/05、P3-05 | 匿名 cart + presentation/fan-message locale + cart_item/support_intent 原子事务 |
| P4-02 | READY | — | P2-03/04、P4-01 | Cart UI |
| P4-03 | PENDING | — | P4-01、P4-02 | Preflight/quote+amount + order presentation locale + per-object TranslationSnapshotRef + policy revision |
| P4-04 | PENDING | — | P1-06、P4-03 | PaymentProvider/provider locale mapping/idempotent create Saga/hosted action/reconcile |
| P4-05 | PENDING | — | P4-04 | Provider evidence/order/reservation/locale-preserving token exchange |
| P4-06 | PENDING | — | P4-05、P1-06 | 七语言 Notification/fallback alert/expiry cleanup |

## P4-01 执行登记（2026-09-08）

- Owner：Codex `/root`，Lane A 唯一 executor；开始 2026-09-08T08:08:44Z，基线 `7ae44bd`，跟踪工作区干净；按 ADR-013 从依赖完成的 READY 领取本轮唯一任务。P3-06 验收待续且无 executor。
- 范围：游客购物车初始化/安全读取/原子加购；当前艺人、礼物、资格、已发布价格、市场币种和独立库存策略重验；独立 cart item + 加密 intent + cart version + 幂等安全引用 + outbox 同事务。无留言匿名合法，公开视图保留真实内容语言来源。
- 顺序与所有权：先冻结合同与失败测试；storefront_read 独占新 cart-runtime 合同/纯领域/test；storefront_directory 独占新 PG cart 仓储、0023迁移及其测试；storefront_e2e 独占新 cart HTTP/transport/composition 与真实协议脚本；root 独占 Application、空字段封装密钥端口与KMS、共享exports/registry/OpenAPI/config/manifest/生成物/进度与Git。子步骤不另占任务，冻结前只读。
- 验证：定向 RED→GREEN、旧合同兼容、format/lint/typecheck/build、真实PG迁移up/down/up与回归、HTTP cookie/Origin/CSRF/幂等/并发/回滚/隐私。新加购在结账前不预占；测试覆盖按单零库存、限量不足、旧显式资格和日常全部艺人规则。冻结后统一完整check，非作者复核与S.U.P.E.R。本轮不修改产品UI，P4-02再实现抽屉和编辑体验。整仓门检出共享合同依赖使P2-04/05指纹过期，因此必须通过原浏览器采集器刷新这两项；P2-02/03原门仍有效。P3的63次Lighthouse留在未完性能验收，不重复作为本任务购物车证据。
- 风险：R-01/02/03/17；初始化丢响应可以留下过期前空车，但不携带第一行；用户先建立稳定cookie后加购，丢加购响应必须同车同key重放。没有PSP/真实收款/生产账号或新人工证据；保护既有文件，仅本地提交。

## P4-01 整合评审（2026-09-08T09:20Z）

合同、纯领域、Application、KMS、PG、HTTP 与生产配置装配已完成；非作者复核已接受当前分层、旧合同兼容与两函数迁移。实际主协议及三次独立空车中新发布即加购通过（6029 总断言含准备、1905 准备 API 请求），PENDING/DYNAMIC 两种拒绝危险回退均保留实际数据 SHA。原第四轮 daily CONTENT_UNAVAILABLE 未定位且未复现，不能声称根因已修复；第五轮有预读，第七入口三次无预读/重试均通过。第六入口只是诊断模块未声明依赖导致 import 失败，修正 TEST 相对模块路径后实际 import smoke 通过。

开始整合 REVIEW，待原 P2-04/05 浏览器刷新和单条完整 check 后决定 DONE。实现输入 1734 项已冻结，清单 `output/checks/p4-01-cart-runtime/final-source-snapshot.json`；证据入口 `final-verification.md`、`contract-domain-review.md`、PG `README.md` 与 `output/checks/p4-01-cart/`。Quality 超时预算由20改30分钟，定向配置门红绿通过、Security仍20，原检查未删除。

### 整合门异常与证据范围

完整check第二入口476.27秒失败于旧发布HTTP的PUBLICATION_PERMISSION，原源定向又在CLAIM_WINDOW拒绝；仅增强TEST安全统计后的定向11243断言/1276请求通过，不能称旧失败根因已修。独立临时PG的8秒/183采样实际测得544403微秒自然墙钟倒退，同期宿主Node无倒退；实例已清理，未改系统时钟或任何业务时间/权限门。原始失败与聚合观测见本轮证据目录。正在对最终1734输入重新执行单条完整check，P4-01仍REVIEW。

## P4-01 验收完成（2026-09-08T10:07:46.800105+00:00）

- 交付：匿名安全会话、当前内容/价格/资格/独立库存重验、加密意图、原子item/intent/version/outbox/幂等回执和恢复；前端抽屉/编辑与结账/支付分别留给P4-02及以后。
- 实际验证：23迁移/159表up/down/up，全部原PG/HTTP/TLS S3链路通过；完整门中的购物车6029断言含准备、1905准备请求，主29请求、3次无预读首次新礼物加购，以及两种禁止危险回退通过。发布HTTP12337断言/1406请求，媒体恢复423断言；P2-04/05原collector和checker均通过，P205既存moderate/人工/真机边界保持。
- 完整门准确退出：full3在1247.50秒因output-only时钟诊断脚本两处URL未显式导入而exit1；PG/HTTP/S3均已通过。只补Node URL导入后，原check自Prettier至最后出口验证的完整后缀33.578秒exit0，类型60/60、测试60/60、构建35/35、31实际Node出口通过，使用部分缓存。1734实现输入SHA `57cf44e3d4e2667340912c102e217161de23906de19fae4e7aae478a5d076d65` 逐字节未变，非作者独立核对两段完整覆盖原门；未改称单次整条exit0。
- 收敛/评审：合同、PG、API、Application/KMS分责，code-simplifier只做小范围表达收敛；S.U.P.E.R 10项PASS，非作者ACCEPT；secret scan与high dependency audit通过。精确命令、缓存、原失败、源SHA、截图和风险在 `output/checks/p4-01-cart-runtime/final-verification.md`。
- 保留风险：第四次daily CONTENT_UNAVAILABLE、旧发布/租约的间歇拒绝未定位；独立PG实测自然墙钟回退约544ms，仅是环境观测，不冒称原失败根因已修。无AWS/IAM、PSP/实际收款、生产部署或新真机验收。P3-06保持IN_PROGRESS、无executor，P3不关闭。
- 本任务DONE并释放Lane A，只解锁直接后继P4-02为READY、无executor；总计23DONE/1READY/1IN_PROGRESS/24PENDING=49。按用户偏好仅创建本地Git检查点，不push/merge。

## Phase 必须证明

- 浏览器篡改偶像、variant、价格、币种或库存不能生效。
- 公共 cart/order DTO、日志、分析、对象元数据和录像不含留言/完整显示名。
- 成功、失败、取消、回跳早于 webhook、UNKNOWN 和 10 次重复 webhook 均正确。
- 同一变体送不同偶像保持独立，历史订单不随实时商品变化。
- cart/订单固化 presentation locale；偶像/礼物/媒体各自固化 TranslationSnapshotRef，政策固化 translation revision，payment 固化平台 requested/provider actual locale，notification 固化 requested/resolved locale + templateVersion。切换 UI 不改变 market/currency/金额/attempt，七语言邮件完整且历史翻译不漂移。

## Phase 退出证据

已按 ADR-013 激活本地开发；尚无 Phase 4 退出证据，P3 也未退出。
