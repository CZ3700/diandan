# Phase 0 — 基线与可运行骨架

> 状态：ACTIVE  
> 任务：5  
> Phase 负责人：未分配

## 目标与退出门禁

建立可安装、可构建、可测试、可预览的完全自研单仓库骨架，并为七语言建立独立 `packages/contracts`/`packages/i18n` 边界。退出前必须证明：clean install、format/lint/typecheck/unit/build 全绿；storefront/admin/api/worker 与 PostgreSQL/对象存储兼容服务可启动；OCI 预览可访问；trace/log 不泄露 PII；Phase 0 未在 config/apps 复制 locale 常量。

## 任务状态

| ID | 状态 | Owner | 开始 | 完成 | 证据/说明 |
|:--|:--|:--|:--|:--|:--|
| P0-01 | REVIEW | Codex `/root` | 2026-09-02T18:22:00+08:00 | — | 2026-09-02T18:51:45+08:00 请求评审；实现与干净目录门禁全绿，但源目录尚非 Git 仓库，不得将 surrogate 证据声称为 clean clone |
| P0-02 | PENDING | — | — | — | 依赖 P0-01 |
| P0-03 | PENDING | — | — | — | 依赖 P0-01 |
| P0-04 | PENDING | — | — | — | 依赖 P0-02、P0-03 |
| P0-05 | PENDING | — | — | — | 依赖 P0-04 |

## P0-01 执行卡

**范围**：只建立 workspace、目录、共享配置、根命令、独立 `packages/contracts`/`packages/i18n` 和最小占位包；不实现页面、业务规则、支付或数据库。

**本次执行登记**：

- Owner：Codex `/root`
- 开始：`2026-09-02T18:22:00+08:00`（`2026-09-02T10:22:00Z`）
- 精确范围：根 pnpm/Turbo/TypeScript/ESLint/Prettier/Vitest 配置；四个应用边界；规范列出的共享包 manifest、最小 source/test；workspace 结构与循环依赖检查；lockfile。
- 明确不做：Next.js/NestJS 实装、页面/UI、业务合同与 locale 常量、环境 schema、CI、数据库、支付、容器和部署。
- 验证计划：先运行会因缺少骨架而失败的结构检查；实现后运行 `pnpm install --frozen-lockfile`、`pnpm check`、workspace 循环依赖检查，并在不包含安装/构建产物的干净临时目录重复安装与检查。
- 已知风险：目录尚非 Git 仓库，无法声称已有 clean clone/PR 证据；以干净目录复验作为本任务实现证据，并在评审记录中保留该差异。关联 `R-15`，避免提前引入 P0-02～P0-04 内容。

**开始前检查**：

- 确认当前目录没有需要保留的未跟踪应用代码。
- 读取 `docs/FAN_SUPPORT_PLATFORM_SPEC.md` 第 10、18、20、22 节。
- 记录 Node、pnpm 和目标稳定依赖版本的选择依据。

**工具链冻结与升级策略**：

| 组件 | P0-01 精确版本 | 选择依据 |
|:--|:--|:--|
| Node.js | `24.20.0` | 当前正式 LTS；生产基线不使用仍处 Current 的 Node 26 |
| pnpm | `11.25.0` | 当前 npm `latest` 发布线；避免在基线阶段采用仍走独立 dist-tag 的 pnpm 12 |
| Turborepo | `2.10.12` | 当前稳定版；根本地依赖精确锁定 |
| TypeScript | `6.0.3` | `typescript-eslint@8.69.0` 声明支持 `<6.1.0`；不采用暂缺 compiler API 的 TypeScript 7 |
| ESLint / `@eslint/js` | `10.9.1` / `10.0.1` | 当前受支持稳定线；安装 ESLint 9.39.5 会收到已停止支持警告 |
| Prettier | `3.9.6` | 当前稳定版；按官方建议精确锁定 |
| Vitest | `4.1.11` | 当前稳定版，支持 Node 24；测试发现范围覆盖 `test/spec` 与 `ts/tsx` |
| `@types/node` | `24.13.3` | 与 Node 24 LTS 主版本对齐 |

- 所有根工具依赖使用精确版本并提交 lockfile；Node 版本同时由 `.node-version`、`engines` 与 pnpm `engineStrict` 固定。
- 每个 Phase 结束时检查安全补丁与稳定 patch/minor；升级必须单独更新 lockfile，并重复 frozen install、完整 `pnpm check` 和干净目录复验。主版本只在其进入受支持稳定/LTS 后评估，不跨任务静默升级。
- P0-04 引入 Next.js/NestJS 当天重新查询稳定版与 peer/support 矩阵。特别是 Next.js ESLint 插件需重新确认 ESLint 10 兼容性；若不兼容，必须记录显式版本例外，不能静默使用已停止支持的 ESLint 9。

**最低产物**：

- `pnpm-workspace.yaml`、`turbo.json`、根 `package.json` 与 lockfile。
- apps/packages 目录的可解析 package manifest 和最小 source/test。
- 共享 TypeScript、lint、format、Vitest 配置。
- 根命令：`format:check`、`lint`、`typecheck`、`test`、`build`、`check`。

**完成证据**：

```text
状态：REVIEW（不是 DONE）

主门禁：
- `mise exec node@24.20.0 -- corepack pnpm install --frozen-lockfile`
  -> exit 0，lockfile 无需更新，pnpm 11.25.0。
- `mise exec node@24.20.0 -- corepack pnpm check`
  -> exit 0；workspace/format/lint/typecheck/test/build/artifact smoke 全部通过；
     typecheck/test/build 均为 34/34，Node 实际 import 30 个 package export。
- 最终干净目录 `/tmp/fan-support-p001-final.seHyur`：排除 `.git`/`node_modules`/
  `dist`/`.turbo`/coverage/tsbuildinfo 后 rsync，重复 frozen install + `pnpm check`
  -> exit 0；验证后已移入系统废纸篓。
- 独立评审最终副本 `/tmp/fan-p001-final-stable.FlJm3z`：安装/构建产物预检为 0，
  frozen install + `pnpm check` -> exit 0，34/34/34，0 cached，30 个 export 由 Node 导入；
  评审结束后已移入系统废纸篓。

失败路径/回归证据：
- 骨架前首次结构检查按预期失败：34 个目标 workspace manifest 实际为 0。
- Node 26.3.0 执行 frozen install -> exit 1 `ERR_PNPM_UNSUPPORTED_ENGINE`，证明 Node 24 LTS 门禁生效。
- 临时 `rogue <-> domain` 副本 -> exit 1，同时拒绝 unexpected workspace 和循环依赖。
- 临时内部依赖 `0.0.0` -> exit 1，明确要求 `workspace:` protocol。
- 临时含 TS2322 的 `.spec.tsx`：Vitest 2/2 执行，typecheck exit 2 命中错误；
  build exit 0 且 dist 无 test/spec artifact；fixture 已移除。
- 无 `.js` 扩展名的 Node ESM 相对导入被 NodeNext 以 TS2835 拒绝，
  正确 `.js` 导入的双文件产物可被 Node 24 直接加载；`noEmitOnError` 阻止失败构建污染产物。
- P0-01 范围 `rg`：无 Next/React/Nest/Drizzle 依赖，无提前实现 locale 常量。

可持久证据路径：
- `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `turbo.json`
- `scripts/check-workspace.mjs` / `scripts/check-build-artifacts.mjs`
- `apps/*` / `packages/*`
- 本执行卡的版本决策、命令结果、S.U.P.E.R 和风险记录

依赖图检查：4 apps + 30 packages = 34 units；实际 manifest 发现集合
与规范白名单精确一致；无循环；内部依赖必须使用 `workspace:`。

未解决风险：
- 源目录没有 `.git`，所以尚无字面意义的 clean clone/PR/历史差异证据；
  这是从 REVIEW 转 DONE 的治理/证据门禁，不是已知实现缺陷。
- ESLint 10 是当前受支持基线，但 Next 16 当前间接插件 peer 仍可能只覆盖 ESLint 9；
  P0-04 必须当天复验并记录显式决策。
- 本证据仅覆盖 P0-01 工具链与边界骨架；无 UI 变更，因此没有浏览器证据；
  四应用、PostgreSQL/对象存储、OCI preview 属于 P0-04 和 Phase 0 退出门禁。

评审者：Codex `/root/p001_review`，两轮独立副本复验后无代码级高优先级 blocker。
```

### P0-01 S.U.P.E.R 检查

| # | 结果 | 证据 |
|:--|:--|:--|
| 1 | PASS | 配置、workspace 检查、artifact smoke 各自单一职责 |
| 2 | PASS | 检查函数按发现、解析、依赖图和输出拆分 |
| 3 | PASS | 当前只建立内向边界，未引入反向框架/适配器依赖 |
| 4 | PASS | 实际发现全图无循环；故意环被拒绝 |
| 5 | PASS | 本任务尚无功能性跨模块 I/O；`contracts`/`i18n` 已独立为后续合同边界 |
| 6 | PASS | 唯一占位 export 为可序列化字符串，无供应商对象越界 |
| 7 | PASS | 无生产 URL、密钥、品牌、locale 或业务常量；结构白名单明确源自规范 |
| 8 | PASS | 全部工具依赖在根 manifest 精确声明并锁定 |
| 9 | PASS | 34 个边界包独立 manifest/source/test/build，尚无级联实现 |
| 10 | PASS | `pnpm check` 与两份干净副本均通过，34/34 tests |

## Phase 退出证据

尚未开始。
