# P3-02 自研内容管理后台实施计划

> Task：P3-02 / Lane C；唯一executor Codex `/root`。从本地6983e90进入codex/p3-02-admin-workspace。使用writing-plans、subagent-driven-development、TDD与非作者两阶段复核；计划位置沿用项目docs/plan约定。

**Goal:** 让运营通过真实后台管理首页、艺人、媒体和七语言内容，完成编辑、审核、预览、发布及回退。

**Architecture:** Next页面 → 同源固定operation BFF → Nest Application → 专属Port → PostgreSQL/S3；所有后台授权来自当前真实session/MFA/RBAC/CSRF。正文与发布继续使用P3-01不可变revision、hash和数据库证明。新增目录/源差异/翻译包/预览媒体补足页面发现与操作所需能力。

**Tech Stack:** 当前锁定Next16.3.4/React19.2.8/TypeScript/Zod/PostgreSQL与已有媒体adapter、UI令牌；不升级供应商或引入CMS。已核对Next官方cookies与Route Handlers文档（2026-09-07）：https://nextjs.org/docs/app/api-reference/functions/cookies 与 https://nextjs.org/docs/app/api-reference/file-conventions/route。

## 1. 会话与BFF

所有权：admin_transport。新增 `packages/contracts/src/admin-session.ts`、同名Application/Port/PG repository；`apps/api/src/admin-session-route.ts`/composition及tests；`apps/admin/src/server/admin-api-client.ts`、`admin-bff.ts`与tests、`app/api/admin/[operation]/route.ts`。

- [x] 先运行失败测试：重复/缺失cookie、Origin不一致、CSRF不一致、非白名单operation、provider失败/畸形响应、过期/撤销/MFA拒绝。
- [x] 当前session最小响应只含actorId、已定义权限与localeScopes；BFF bootstrap额外返回CSRF，禁止HTML/RSC持久化。
- [x] `__Host-fan-admin-session`与独立CSRF cookie均HttpOnly/Secure/SameSite，body/URL不能传session。BFF只向固定配置API origin转发、拒绝redirect，旧API继续授权。
- [x] 本地harness使用显式TEST组合与独立editor/reviewer/manager DB sessions；工具设置cookie，无匿名角色切换或生产身份发行。

## 2. 管理目录与艺人身份

所有权：auth_persistence_audit。新增 `admin-catalog.ts`合同/port/Application，`admin-catalog-*.ts` PG实现与tests；独占0019迁移，沿用旧slug_redirects。

- [x] 失败测试覆盖管理列表分页、owner/revision/publication/identity历史、不同语言scope、handle当前/历史占用、状态冲突、活动恢复资格、自审旁路与故障回滚。
- [x] 冻结 `LIST_OWNERS / READ_OWNER / READ_HISTORY / CREATE_IDOL / RENAME_IDOL / SET_IDOL_STATUS`（最终枚举以合同为准），明确baseVersion、authoringVersion、publicationHeadVersion三个维度。
- [x] IDOL/HOMEPAGE/MEDIA_METADATA管理发现与只读GIFT选择；UUID服务端生成，handle变更有301同owner历史映射；暂停/归档不删除历史，恢复active重新验证当前published资格。
- [x] 对当前真实session的全七locale范围检查后原子写审计/幂等/版本；正常触发器与真实PG并发、旧18→19/up/down验证。

## 3. 翻译工作区、包传输与预览媒体

所有权：content_review_audit。新增 `translation-workspace.ts`、`translation-transfer.ts`、`admin-preview-media.ts`合同及对应pure/Application/Port/PG模块；DDL统一交0019 owner，transport由admin_transport接。

- [x] 先失败测试未授权格不泄露、MISSING可读状态、真实COPY链旧英语diff、authoring hash/head绑定与扩展COPY语言范围。
- [x] 七语矩阵由DB当前审稿证明构建，英文源固定；源diff无历史证明时明确不可用，不能按hash全库猜测。
- [x] 导出包携固定owner/revision/source hash/field constraints/批次审计；导入只允许译文fields变化，同事务重读receipt与当前英文/hash/head，旧包拒绝，所有显式导入行仅IMPORT/DRAFT。自审及七语言发布门继续生效。
- [x] preview token仅内存，通过POST读取；Admin双端链接仅owner/revision/locale/viewport，不含凭证。图片只解析grant所属revision真实引用，签名在事务外，返回前再次验证grant/身份，剩余不足60秒拒绝，不超过grant/session期限。

## 4. 运营界面

所有权：root。`packages/i18n/src/admin/`保存七语言语义消息与DRAFT review manifest；`apps/admin/src/workspace/`请求、编辑状态、列表/审核/媒体/预览；`apps/admin/src/app/(latin|hans|thai|japanese|vietnamese)/`静态七语言页面与受控preview，使用现有tokens/字体分包。

- [x] 先写消息七语key/参数一致、输入转换与保存边界、过期请求不覆盖、幂等重试键和source diff显示的失败测试。
- [x] 暗色中性列表+金色主动作；导航艺人/首页/媒体/翻译，主区列表/编辑与图片预览，不使用营销Hero或仪表盘卡片拼盘。
- [x] 艺人创建/handle/暂停归档、源稿/翻译字段/别名、首页固定槽位与排序；浏览器不编辑数据库字段或发送审批身份。
- [x] 媒体选择/上传校验/版权/加工状态与重试、COVER焦点或CONTAIN衬底、双端独立素材预览；失败有明确恢复动作。
- [x] 审核matrix/source diff/提交与独立批准、导入导出、发布检查/冲突/缓存状态/重试/历史回退。保存形成新revision，不污染published。
- [x] 七语界面/内容locale分别明确；焦点、dirty导航确认、错误live region和reduced motion保持，不声称机器译文已人工批准。

## 5. 集成和退出

root统筹共享exports/registry/generated/manifest/expected-catalog、package/lock、进度和Git；各模块先报告RED→GREEN，先规范复核再质量复核。固定复跑前缀：`mise exec node@24.20.0 -- corepack pnpm`。

- [x] 受影响test、format/lint/typecheck/build与真实PG/HTTP/S3联合harness，原311合同深比较不变。
- [x] 真正Next+API+PG+S3浏览器操作：独立编辑者/审核者、创建/保存草稿、七语审核、源改变STALE、过期包拒绝、缺媒体/自审发布阻断、预览/发布/回退、权限撤销与冲突保留输入。
- [x] 390×844/1440×900全部七语言，键盘/错误/空/加载/reduced-motion/320px及实际截图检查；Admin使用720×450等效200%重排，既有P2-04另验原生Chrome200%缩放，不混写两种证据；新开发server与历史真机证据准确区分。
- [x] 冻结源码/文件清单，刷新共享输入对应P2浏览器门，再完整 `pnpm check`、`pnpm security:secrets`、`git diff --check`与S.U.P.E.R十项。
- [x] 全部符合才P3-02 REVIEW→DONE、MASTER49计数同步；实际身份/云CDN/正式资产/PSP/部署保留对应生产门。本地精确暂存提交，不push/merge、不收进历史未跟踪产物。

实际文件布局与最终证据见 `output/checks/p3-02-admin/README.md` 和 `docs/progress/phase-3-storefront.md` 的P3-02验收记录。Next route handlers与server-only边界另核对了当前安装版本 `apps/admin/node_modules/next/dist/docs/01-app/01-getting-started/` 的指南。
