# P3-03 验证记录

状态：PASS / P3-03 DONE。全部本地门禁通过；Phase 3 仍 ACTIVE（3/6），下一 P3-04。正式环境范围见下文。

- 基线：`cdf2ab24a46eb914c4e82b456d6e630886cfed7b`；分支 `codex/p3-03-gift-commerce`。
- 商业规则：礼物类型、内容品类和规格库存策略相互独立。按单准备无库存身份；限量库存真实余额；所有类型工作室转交艺人。
- 合同兼容：344 个既有 schema root 保持逐项深度一致，新合同单独追加。
- 数据库证据：真实 ephemeral PostgreSQL，普通 triggers，完整事务/并发/回滚验证；不关闭触发器获得通过。
- 浏览器证据：`output/playwright/p3-03-gift-commerce/`，最终 18 张有效 PNG 与 PASS JSON；17 张稳定页面，`en-created.png` 明确为保存成功后的刷新状态，不用作稳定规格面板证明。
- 运营入口：`docs/operations/gift-commerce.md`。
- 日志目录：本目录 `*.log` 为本地执行日志，包含失败复现与最终验证，不能把任意单一 GREEN 当作整个阶段完成。

## 已交付能力

后台提供礼物身份、虚拟/实体/心愿/周边/其他类型、内容品类、规格、适用艺人搜索与分页、工作室履约说明、受控图文块、七语言编辑与独立详情审核。类型不推导库存策略；按单准备不建立库存身份，限量销售保留实际余额与预占。已有交易或库存历史后，策略不能原位修改。

价格工作区复制服务端完整价格簿并建立不可变新版本，支持发布和历史回退；回退不倒退作者版本号。库存工作区只允许带原因的增减调整，不允许改写预占量。当前权限、幂等、版本检查、业务写入、审计和收据在同一事务。市场、币种与界面语言分别处理。

七语言图文详情以英语为源。英语内容变更后其他语言标为 STALE，重新翻译并由独立审核者批准；语言范围仅影响内容编辑/审核，不把全局礼物类型管理误设为七语言编辑权限。公开礼物分类绑定原不可变 manifest 与精确 publication/revision；新 profile 缺失不能降级为 legacy。

## 验证结果

| 范围 | 结果与本地日志 |
|:--|:--|
| 新商业数据库链 | 117 断言（含保存桥接及真实 App 授权时间回归），另有 4 个约束边界与 6 个价格回退断言；`db-gift-content-authorization-clock-green.log`、`db-constraints-green.log`、`db-price-rollback-green.log` |
| 合同兼容 | 344 个旧 root 深度相同，追加 26 个，共 370；`compatibility-final.json` |
| 管理 HTTP | 实际 PG/TLS S3/worker/Next，1658 断言/512 setup 请求；`transport-http-publication-diagnostic.log` |
| 最终管理浏览器 | 1703 断言/512 setup 请求，七语言双端 18 PNG、4 axe 均零 violations/incomplete、5 项重排测量及真实键盘预览；`transport-browser-final-green.log`、`accessibility.json` 与 `screenshots.json` |
| 旧目录兼容 | 120 艺人/120 礼物/七语言，307 断言；`db-catalog-directory-green.log` |
| 旧内容作者兼容 | 正常触发器在迁移 17 建立旧父版本，再升级 20 验证 64 断言；`db-legacy-draft-parent-green.log` |
| 历史降级保护 | 实际 20→19→18 后，18 拒绝删除发布历史，447 断言；实际 20 拒绝删除新礼物历史，258 断言；`pg-runtime-history-final.log`、`pg-admin-history-final.log` |
| 后台受影响单测 | Admin 19 文件/68 tests；最近全仓 typecheck/test 预检 93/93 tasks（57 cached），`final-unit-preflight.log` |
| 共享浏览器回归 | P2-04 与 P2-05 两脚本成功；`shared-composites-browser-final.log`、`shared-motion-browser-final.log` |

最终管理浏览器证明了实际调价发布、库存调整、创建礼物及按单准备规格、英语详情保存/独立审核后六语言 STALE，以及只有日语内容审核、没有商业权限的账号独立批准。18 张 PNG 共 4,261,070 字节，尺寸/摘要登记在 `output/playwright/p3-03-gift-commerce/screenshots.json`。root 复看中日葡页面、预览与创建刷新态；手机语言矩阵与桌面双栏字段顺序已确认。FullPage 截图包含位于当时 viewport 底部的粘性操作条；720px 测量是等效 200% 重排，本轮未声称原生缩放或新真机结果。

## 修复与证据边界

密封价格版本的删除漏洞、图库删除后顺序重复、新库存地点创建丢失未保存调整、单语言详情审核错误要求商业读取、双栏可选源字段错位均先有失败证据，再修复并回归。源码按业务职责拆分，独立复核见 `independent-review.md` 与 `transport-review.md`。

旧发布链出现过自然 503/`PUBLICATION_SESSION_TIME`；安全诊断未捕获原自然失败的精确触发时刻，不能声称自然失败已确定归因。独立受控测试已证明早先读取的 wall clock 可以污染持久化事件时间，分别覆盖发布事件、预检观察与 purge retry；另用正常迁移前的实际未来 head 历史复现 VALIDATE 不应继承发布头递增时间。四类正式专项 30 断言通过（`db-publication-time-final-green.log`），完整旧发布 PG 回归 447 断言通过。实际会话到期、MFA、权限、租约和 SQL 约束均未放宽。

新礼物保存桥接同样先精确复现 `23514/gift_commerce_session`（`db-gift-authoring-clock-red.log`），再仅为该内部桥接传入同事务的稳定商业授权时间；普通内容作者流程保留原行为，原有全部内容历史下限继续保留。114 断言通过，未改 0015/0018 的原迁移或 0020 的时间上限。早期因夹具 SQL 类型或事务隔离错误失败的日志不列入通过证据。

随后在真实 App → PG 链确认旧内容授权的瞬时时间会覆盖稳定商业授权时间。正常 trigger 精确 RED（`db-gift-content-authorization-clock-typed-red.log`）后，Application 保留初始商业 principal，仍完整执行内容、语言及同 actor/session/expiry 检查并先于幂等处理。最终 117 PG 断言、40 Application/scope tests 通过；权限 SQL 不变。当前 0020 商业收据的时间下限绑定实际 `gift.manage` 授予历史，内容/语言的当前授权继续由原锁定查询负责。

## 复跑命令

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test:postgres:gift-commerce
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:gift-commerce
mise exec node@24.20.0 -- corepack pnpm verify:gift-commerce:browser
mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs
mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs
mise exec node@24.20.0 -- corepack pnpm check
```

本地测试不代表真实 PSP 多次付款、正式身份服务、人工语言批准、实际履约、staging 或生产发布完成。既有 254 个非本轮未跟踪文件按 `baseline.log` 保护；最终仅本地提交，不推送或合并。

## 最终统一门禁

`pnpm check` exit 0：全部真实 PG/HTTP/TLS S3/worker、架构、合同、format、lint、typecheck、test、build 与构建产物检查通过。typecheck/test 各 58/58（54 cached），build 35/35（30 cached），31 个 package 出口由 Node 实际 import；不声称零缓存。secrets 与 diff 检查通过。

1,219 个实现、测试、配置、迁移和生成合同输入在最后门禁前后逐项一致，SHA256 `d2cd9b2044a0965628e684df24df3a824a3866986dd668a089c73dda0940e320`；排除 docs/output 和自动生成 Next 环境声明，后者已由 Next typegen 恢复并通过最终构建。完整清单为 `implementation-source-final.json`，机器可读结果为 `validation.json`。独立复核与 S.U.P.E.R 十项 PASS，逐项依据在 phase 执行卡。

早期 `implementation-source-before.json` 及失败日志属于诊断过程，不作为最终冻结清单；最终证据与初次失败明确分开。只提交本轮源码、文档与有效证据，保护原 254 个未跟踪文件；本轮不推送 GitHub。
