# P3-01 4C-1 发布前检查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 为五类内容提供真实、受权、只读的完整发布前检查，定位阻塞发布的具体字段。

**Architecture:** Route → Application → Content → Persistence Port → PostgreSQL；一次 SERIALIZABLE 事务包含当前 session/MFA/CSRF/七语言权限与完整候选读取。服务端校验实际内容及独立证据，返回摘要而不暴露原始媒体 key、审稿身份或内部文稿。后续真正发布须在其自身事务重跑同一规则，本报告不授予发布权限。

**Tech Stack:** 现有 TypeScript、Zod、Nest/Fastify、PostgreSQL；无新运行依赖、无迁移。

---

## 冻结边界

- 原274个生成合同保持不变，新增版本化 `publication-preflight` 合同。
- 外部命令仅 `schemaVersion/target {owner,revisionId}/action PUBLISH|ROLLBACK`；信封继承现有管理员凭证与requestId，不接收客户端时间、候选、审核、manifest或资格。
- `PublicationPreflightRepository.load(command)` 返回版本化 canonical context；`runInPublicationPreflightTransaction` 提供授权和专属loader。
- `evaluatePublicationPreflight(context)` 返回 `PUBLICATION_PREFLIGHT` 报告，包括target/action/headVersion/contentHash/evaluatedAt/ready/issues。报告无副作用；`ready` 只描述读取时刻。
- 运营状态预检原则：当前paused按paused，其余未归档草稿/active按active所需可售条件检查；最终发布仍须重新检查实际目标状态。
- PUBLISH可以预检查DRAFT/VALIDATED；不写虚构validatedAt。ROLLBACK必须是实际发布过的历史revision；依据规范12.4/既有0006创建新publication事件的语义，不复制旧revision。
- 0013封锁、public head、公开旧DTO、outbox与worker本轮保持原有行为。完整4C后续项目仍见 `p3-01-content-runtime.md`。

## 实施步骤

### 1. 合同与纯规则（content_review_audit）

Files: `packages/contracts/src/publication-preflight.ts`、同名测试；`packages/content/src/publication-preflight*.ts` 与测试。

- [x] 先证明严格边界和缺实现的RED，冻结context后通知其他实现者。
- [x] 复用基础文本hash/ICU、旧publication/media规则，加入五类七语言、source lineage、review identity与原始内容copy证明、独立aliases/details、媒体来源和关联资格；保留明确阻塞路径。
- [x] 测试正常/缺译/STALE/审核借用与自审、copy篡改、Hero共用原图、失权媒体、价格与库存关联、目标/head/lifecycle错误及零状态改变。

行为例：
```ts
expect(evaluatePublicationPreflight(missingThai)).toMatchObject({ ready: false });
expect(evaluatePublicationPreflight(approvedSevenLocales)).toMatchObject({ ready: true });
```

### 2. 实际数据库加载（auth_persistence_audit）

Files: `packages/persistence-postgres/src/publication-preflight*.ts`、`scripts/postgres-publication-preflight*.mjs`。

- [x] 以真实已审核fixture写RED，覆盖当前review、copy FK、当前head及时间。
- [x] 同快照加载五类正文/审核/关联媒体与目录资格，明确证明每个processed master的所有原始来源；不能用SQL常量true替代资格。
- [x] 原生约束下验证缺失与失效、跨对象、同事务授权、查询前后生命周期/head/outbox不变；与HTTP harness共享有界fixtures。

### 3. Port、Application与组合（root）

Files: `packages/persistence-port/src/publication-preflight.ts`、`packages/application/src/publication-preflight.ts/.test.ts`、`packages/persistence-postgres/src/postgres-persistence.ts`、`apps/api/src/publication-preflight-composition.ts/.test.ts`、共享exports/registry/生成物。

- [x] 先写失败的授权顺序/目标绑定/失败封闭/只读结果/TEST组合测试。
- [x] 在同事务先以content.read授权全部七语言，再加载canonical上下文并调用纯规则；无幂等写入、无发布变更。
- [x] 配置必须在开数据库前检查；composition关闭一次，生产登录不自动启用。

### 4. HTTP与集成（admin_transport）

Files: `apps/api/src/publication-preflight-route.ts/.test.ts`、`apps/api/scripts/publication-preflight-http*.mjs`。

- [x] 写strict-body/Origin/cookie/CSRF错误与private no-store的RED。
- [x] 接 `POST /api/v1/admin/content/publication/preflight`；校验全部输入和输出，不要求只读请求携带Idempotency-Key。
- [x] 真正Nest/Fastify+PostgreSQL测五类内容、七语言与权限、具体阻塞/修复后通过、所有公开状态不变。

### 5. 验收与本地归档（root协调非作者复核）

- [x] 受影响tests后先执行 `mise exec node@24.20.0 -- corepack pnpm format:check`、`pnpm lint`、`pnpm exec turbo run typecheck test build`；全部通过再运行昂贵真实集成与完整 `pnpm check`。
- [x] 专属PG/HTTP命令加入现有检查链；生成合同深比较旧274，实际Node exports，浏览器共享输入回归。
- [x] 非作者先规范后质量复核；S.U.P.E.R十项、源码指纹与命令/范围归档到 `output/checks/p3-01-publication-preflight/`。
- [x] 更新phase/MASTER说明，计数仍17 DONE/1 IN_PROGRESS/31 PENDING。精确暂存本轮文件并本地commit；不推送。

验收完成：1,237受影响tests、166实际PG断言、2,595实际HTTP断言/277请求；全仓check、七语言双端浏览器回归、三路非作者复核与S.U.P.E.R十项通过。948个输入指纹匹配。见 `output/checks/p3-01-publication-preflight/README.md`；P3-01继续IN_PROGRESS，下一项为4C-2。
