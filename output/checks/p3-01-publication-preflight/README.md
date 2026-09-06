# P3-01 4C-1 发布前检查

状态：本地验收通过。P3-01继续IN_PROGRESS；总任务49，17 DONE、1 IN_PROGRESS、31 PENDING。

## 实现范围

新增 `POST /api/v1/admin/content/publication/preflight`，对艺人、礼物、首页、政策、媒体元数据返回发布或历史回退的准备度与字段级阻塞原因。外部请求只接受schemaVersion、owner/revision、action；会话/CSRF从现有私有管理边界读取，64 KiB body limit。报告不包含内部文稿、媒体对象key或审稿身份。

当前会话、MFA、CSRF、content.read与全部七语言权限在同一个SERIALIZABLE事务中先验证，再读取实际数据库候选。基础七语言审核、原始英语源、精确复制继承、独立别名/详情审批、当前媒体版权与全部加工来源、双端Hero原图和关联目录/价格/库存均参与检查。时间保留数据库微秒精度。

草稿可以检查但不伪造VALIDATED状态。当前paused按paused，其余未归档草稿/active按active所需可售条件检查；归档内容被阻塞。ROLLBACK必须绑定确实发布过的历史revision与publication记录。后续回退应创建新publication指向不可变历史版本，不能重写历史。

## 可重复命令

所有命令从仓库根目录执行，使用 `mise exec node@24.20.0 -- corepack pnpm`。

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/contracts --filter @fan-support/content --filter @fan-support/application --filter @fan-support/persistence-port --filter @fan-support/persistence-postgres --filter @fan-support/api test
mise exec node@24.20.0 -- corepack pnpm format:check
mise exec node@24.20.0 -- corepack pnpm lint
mise exec node@24.20.0 -- corepack pnpm exec turbo run typecheck test build --output-logs=errors-only
mise exec node@24.20.0 -- corepack pnpm check
mise exec node@24.20.0 -- corepack pnpm security:secrets
mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs
mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs
```

专属实际集成：`pnpm --filter @fan-support/persistence-postgres test:postgres:publication-preflight` 与 `pnpm --filter @fan-support/api test:postgres:publication-preflight`。二者已接入全仓check链。HTTP细节见 `HTTP-README.md`。

## 已验证结果

- 受影响六包1,237 tests：contracts246、content299、application278、persistence-port4、persistence-postgres321、API89。
- 独立纯门禁150 tests（主门禁136、媒体来源14）；应用14、API路由8与TEST组合3均有先RED后GREEN。
- 实际PostgreSQL166断言；实际Nest/Fastify/PG HTTP2,595断言、277请求。每次preflight比较28表的完整行摘要，确认无业务状态写入；媒体storage/inspector意外调用会令测试失败，最终零调用。
- 全仓format/lint通过；105项typecheck/test/build预检通过（35缓存，未宣称0-cache），secret扫描通过。
- P2-04实际Chrome16场景/18PNG/10axe，所有axe violations为0；P2-05实际Chrome8场景/22PNG/3axe，critical/serious为0，保留既有3个heading-order moderate。覆盖七语言、键盘、错误状态、reduced-motion及390×844/1440×900，root已查看双端实际截图。该桌面记录仍physicalDeviceEvidence=false，不新增真机结论。
- 最终完整 `pnpm check` exit0：17迁移/136表，typecheck56、test56、build35任务全部成功（分别缓存56/56/35）；31个package exports经实际Node导入。目录PG307、媒体PG152、资源PG129、本轮PG166/HTTP2595、既有HTTP/S3/Chrome1798和worker PG+TLS S3联合423断言均通过。三路非作者复核ACCEPT，S.U.P.E.R十项PASS。
- 源输入948个，SHA-256指纹 `ec6a81497ecf77965b38ab194d82491d0e8048854c55d007adb7aff198179a06`；浏览器最终输入指纹与当前工作区一致。

## 诊断与复跑注意

- policy复制后的新稿effectiveAt必须匹配新稿createdAt；旧时间被实际检查阻塞属正确行为，harness修正fixture，未放宽政策规则。
- 缺语言的旧验证路径不一定自带locale；新preflight仅按精确canonical路径补充locale，有输入重排回归，不修改旧合同。
- 恢复媒体版权后须检查当前新草稿；旧草稿触发DRAFT_POINTER_MISMATCH属正确行为。
- 原time gate采用毫秒，preflight对价格/政策有效期、审核与媒体因果关系保持数据库微秒精度；实际PG覆盖跨时区与未来因果时间。
- P2-05首次运行因运行中新增源码文件被whole-git-status门禁拒收，未把失败记录算通过。冻结全部源码和文件名后重跑成功。以后先完成源码/文件清单，再跑浏览器，不并行新增文件或暂存/提交。
- 首次生成合同曾误将不含schemaVersion的嵌套schema当独立root；版本门禁正确拒绝，现只有5个版本化root，嵌套对象仍被严格schema校验。

## 证据与限制

最终全仓结果见 `validation.json`；源输入由 `implementation-source.json` 逐文件sha256绑定，规范/质量非作者复核记录在 `independent-review.md`。旧274个生成合同深比较不变，新增5个版本化root，共279，见 `compatibility.json`。

本轮没有publication/lifecycle/head/审核/audit/幂等/outbox业务写入。SQL会取得一致性所需锁，不声称数据库使用READ ONLY事务模式。检查通过后仍必须在真正发布事务重新校验全部当前证据，0013发布封锁保持。

这不是管理业务页面、真实发布/回退、公开扩展DTO、manifest/别名投影/purge、正式登录、新增真机或新S3字节验证的完成证据。完整检查链仍回归既有真实本地PG/TLS S3/worker；云CDN、PSP、staging、远端CI和生产发布须在各自后续门禁验收。按用户选择本地提交、最终统一推送。
