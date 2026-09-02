# Phase 0 — 基线与可运行骨架

> 状态：ACTIVE  
> 任务：5  
> Phase 负责人：未分配

## 目标与退出门禁

建立可安装、可构建、可测试、可预览的完全自研单仓库骨架，并为七语言建立独立 `packages/contracts`/`packages/i18n` 边界。退出前必须证明：clean install、format/lint/typecheck/unit/build 全绿；storefront/admin/api/worker 与 PostgreSQL/对象存储兼容服务可启动；OCI 预览可访问；trace/log 不泄露 PII；Phase 0 未在 config/apps 复制 locale 常量。

## 任务状态

| ID | 状态 | Owner | 开始 | 完成 | 证据/说明 |
|:--|:--|:--|:--|:--|:--|
| P0-01 | DONE | Codex `/root` | 2026-09-02T18:22:00+08:00 | 2026-09-02T19:25:41+08:00 | 根提交 `9234e368e193e967e9e2abd39858f4f3eaf01da9`；两次真实 clean clone、完整门禁和独立验收全绿 |
| P0-02 | DONE | Codex `/root` | 2026-09-02T19:25:41+08:00 | 2026-09-03T01:29:52+08:00 | [PR #1](https://github.com/CZ3700/diandan/pull/1) 真实 CI 全绿；`Quality`/`Security` 已绑定 GitHub Actions 并作为 `main` 必需检查 |
| P0-03 | DONE | Codex `/root` | 2026-09-03T00:02:33+08:00 | 2026-09-03T00:47:13+08:00 | 候选 `ba8b8864605e7181a85f2ffc13ca52087e0726e4`；三路独立复核 ACCEPT |
| P0-04 | IN_PROGRESS | Codex `/root` | 2026-09-03T01:54:21+08:00 | — | 建立四应用运行时、PostgreSQL/S3 兼容本地环境与 OCI preview |
| P0-05 | PENDING | — | — | — | 依赖 P0-04 |

## P0-01 执行卡

**范围**：只建立 workspace、目录、共享配置、根命令、独立 `packages/contracts`/`packages/i18n` 和最小占位包；不实现页面、业务规则、支付或数据库。

**本次执行登记**：

- Owner：Codex `/root`
- 开始：`2026-09-02T18:22:00+08:00`（`2026-09-02T10:22:00Z`）
- 精确范围：根 pnpm/Turbo/TypeScript/ESLint/Prettier/Vitest 配置；四个应用边界；规范列出的共享包 manifest、最小 source/test；workspace 结构与循环依赖检查；lockfile。
- 明确不做：Next.js/NestJS 实装、页面/UI、业务合同与 locale 常量、环境 schema、CI、数据库、支付、容器和部署。
- 验证计划：先运行会因缺少骨架而失败的结构检查；实现后运行 `pnpm install --frozen-lockfile`、`pnpm check`、workspace 循环依赖检查，并在不包含安装/构建产物的干净临时目录重复安装与检查。
- 已知风险：关联 `R-15`，避免提前引入 P0-02～P0-04 内容；初次基线前发现的研究抓取凭据已在建立 Git 对象库前完成脱敏，P0-02 继续把 secret scan 固化为门禁。

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
状态：DONE（2026-09-02T19:25:41+08:00 独立验收通过）

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
- Git 根提交 `9234e368e193e967e9e2abd39858f4f3eaf01da9`：299 个文件；
  `git fsck --full --no-reflogs --unreachable` 无输出，全部 319 个对象可达。
- 真实 clean clone `/tmp/fan-support-p001-clean-clone.pFPU8m/repo`：安装前生成目录为 0，
  frozen install + `pnpm check` -> exit 0，34/34/34、0 cached、30 个 export 实际导入；
  clone 验证后干净并已移入系统废纸篓。
- 独立验收 clean clone `/tmp/fan-p001-accept-clone.hCHK46/repo`：HEAD/tree 与源仓库一致，
  安装前生成目录为 0；frozen install + `pnpm check` -> exit 0，clone 最终干净并已移除。
- 提交前研究证据共 4 个文件 17 处值替换为 `[REDACTED_SECRET]`；JWT、私钥、
  常见云/支付令牌、Authorization/Cookie/access-token 独立规则均为 0，
  `@secretlint/quick-start@13.0.5` 全树复扫 exit 0。

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
- ESLint 10 是当前受支持基线，但 Next 16 当前间接插件 peer 仍可能只覆盖 ESLint 9；
  P0-04 必须当天复验并记录显式决策。
- 本证据仅覆盖 P0-01 工具链与边界骨架；无 UI 变更，因此没有浏览器证据；
  四应用、PostgreSQL/对象存储、OCI preview 属于 P0-04 和 Phase 0 退出门禁。

评审者：Codex `/root/p001_review`；最终独立 Git 对象、凭据与真实 clean-clone 验收结论 `ACCEPT`，无剩余 blocker。
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

## P0-02 执行卡

**范围**：建立最小权限、依赖不可变的 GitHub Actions CI，覆盖 frozen install、format、lint、typecheck、unit、build、依赖漏洞扫描和 secret scan；缓存仅按 lockfile；不引入应用框架、业务功能、部署或真实 secret。

**本次执行登记**：

- Owner：Codex `/root`
- 开始：`2026-09-02T19:25:41+08:00`（`2026-09-02T11:25:41Z`）
- 精确范围：CI workflow、Secretlint 配置与锁定依赖、根安全检查命令、CI 结构回归检查、锁文件及进度证据。
- 明确不做：P0-03 环境 schema、P0-04 应用/数据库/容器、托管平台 secret 配置。初始实现不创建 GitHub 仓库或改动远端；用户后续提供空远端并授权后，终验仅补齐安全初始化、PR 和分支保护。
- 验证计划：先以缺少 CI 合同的失败检查建立红灯；随后执行 frozen install、完整 `pnpm check`、依赖审计、全树 secret scan、workflow 结构校验；在一次性临时 clone 中放入纯合成 secret，确认 scanner 非零阻断且输出掩码，随后移除 fixture 和临时 clone；最后执行真实 clean-clone 复验与独立评审。
- 并发/所有权：实现、本地终审与远端门禁已结束，Lane D 与根配置锁已释放。
- 风险映射：`R-02`（凭据泄露、日志回显、过宽 workflow 权限）和 `R-14`（依赖漂移、供应链与构建不可复现）。

**评审候选与实现证据**：

```text
状态：DONE（2026-09-03T01:29:52+08:00 真实 PR 与必需检查验收通过）
实现候选 HEAD：88efe390c86c8b8e58b371fa196a9ae62c65de99
实现提交：
- 748f884 ci: add quality and security gates
- bad50a2 ci: close secret scan bypasses
- 9782cb7 ci: redact policy parse failures
- 82493de ci: block scanner policy bypasses
- c14cbc3 ci: normalize ignored path matching
- 23afb73 ci: detect binary scanner suppressions
- 88efe39 ci: reject untracked scanner policies

CI 合同：
- `.github/workflows/ci.yml` 仅监听 `pull_request` 与 main push；全局权限只有
  `contents: read`，禁用 checkout 凭据持久化，设置 concurrency cancel 与 20 分钟超时。
- `quality` 与 `security` 并行；两者固定 `ubuntu-24.04`、Node 24.20.0、
  pnpm 11.25.0，pnpm store cache key 使用 `pnpm-lock.yaml`。
- quality：显式 frozen install + `pnpm check`。
- security：显式 frozen install + npm 官方 registry 的 high audit + Secretlint。
- 2026-09-02 核验官方 tag：checkout v7.0.1 固定完整 SHA
  `3d3c42e5aac5ba805825da76410c181273ba90b1`；pnpm/setup v2.1.0 固定完整 SHA
  `703c52620218391530e48b9e8870d5c0082e1b9b`。

可重复策略检查：
- `scripts/check-ci.mjs` 使用精确锁定的 `yaml@2.9.0` 语义解析 workflow，按完整对象校验
  trigger、权限、job、step、不可变 action、缓存和失败语义；workflow 目录只允许一个常规
  `ci.yml`，额外文件、key、step 或 action 均拒绝。
- Secretlint 13.0.5 与 recommend preset 精确锁定；配置必须 exact match，禁止 disabled、
  allowMessageIds 或宽泛 allows；`--no-gitignore` 覆盖被强制跟踪的 `.env`，
  `.secretlintignore` 只忽略精确列出的生成物。
- `scripts/scan-secrets.mjs` 先失败关闭：拒绝落入 ignore 的 tracked path、嵌套且大小写变体的
  tracked/untracked Secretlint policy、inline suppression（含 NUL/二进制文本）、`.GIT`
  路径与非生成目录 symlink；Git 与 scanner cwd 固定为仓库根。
- CI/YAML/JSON 策略错误只输出通用错误，不回显实际对象或输入片段。

TDD/失败路径：
- 首次 `node scripts/check-ci.mjs` 因 workflow、Secretlint 配置、脚本和依赖缺失
  -> exit 1；最小实现后 -> exit 0。
- 旧检查器对错层级 workflow 和 `disabled: true` 配置误放行 -> 两者 exit 0；
  改为 YAML 语义解析与 exact deep-equal 后 -> 两者 exit 1。
- 默认 Secretlint 对 force-add 的合成 `.env` 凭据误放行 -> exit 0；改为
  `--no-gitignore` 后同一类 fixture -> exit 1，输出含掩码且不含原值；fixture 删除并提交后
  -> exit 0，临时 clone 干净且已移入系统废纸篓。
- workflow 含合成敏感字面量时，旧 assertion diff 会回显 -> 修复后策略仍 exit 1 且原值不在输出；
  malformed JSON 同样只输出通用错误。
- 旧策略对额外 workflow、tracked `*.log`、嵌套 tracked policy、inline suppression、大小写
  `.LOG`/`DIST` 与 NUL/二进制 suppression 分别误放行 -> 对应语义目录检查、tracked-path
  guard、policy/directive guard、大小写归一和二进制内容检查加入后均 exit 1。
- 修复前，未跟踪嵌套 `.secretlintignore` 可屏蔽 tracked secret，Linux 上可提交的嵌套
  `.GIT/fixture.txt` 也落入 scanner 默认 ignore；最终 working-tree traversal 与 `.git` segment
  guard 后，两类 fixture 均 exit 1 且不回显合成 secret。
- 最终临时对抗套件逐项验证 force-tracked `.env`、`.LOG`、`DIST`、tracked/untracked/大写
  policy、文本/二进制 inline suppression、`.GIT`、外部 symlink 和额外 workflow 共 11 条拒绝
  路径全部 exit 1/raw absent；无 fixture 的 scan 与 CI contract 均 exit 0。

主门禁：
- `mise exec node@24.20.0 -- corepack pnpm install --frozen-lockfile`
  -> exit 0，lockfile 无变化。
- `mise exec node@24.20.0 -- corepack pnpm check`
  -> exit 0；workspace/CI policy/format/lint/typecheck/test/build/artifact smoke 全绿，
     clean clone 中 typecheck/test/build 34/34/34、0 cached，30 个 export 被 Node 导入。
- `mise exec node@24.20.0 -- corepack pnpm security:secrets`
  -> exit 0；wrapper 完成边界 guard 后执行 `secretlint --no-gitignore "**/*"`。
- `mise exec node@24.20.0 -- corepack pnpm audit --registry=https://registry.npmjs.org --audit-level=high`
  -> exit 0，No known vulnerabilities found；registry 网络/endpoint 错误不会 fail-open。
- 最终真实 clone `/tmp/fan-p002-final-clean.DL0Qfj/repo`：HEAD 为候选完整 SHA，安装前
  生成目录 0、working tree 0；重复 frozen install、完整 check、secret scan 与 audit 全绿，
  typecheck/test/build 34/34/34 且 0 cached，30 个 export 被 Node 导入；验证后 working tree
  仍为 0，临时 clone 已移入系统废纸篓。

真实 GitHub 门禁：
- 远端 `https://github.com/CZ3700/diandan.git` 初始为空；以 P0-01 根提交
  `9234e368e193e967e9e2abd39858f4f3eaf01da9` 初始化 `main`，以线性后继
  `5a1c8f9c89b7a8ebf88dcac2055b7eeccca5fefe` 初始化 `codex/p0-ci-baseline`；
  两次均为新分支推送，无 force/覆盖或改写历史。
- [PR #1](https://github.com/CZ3700/diandan/pull/1)（`main <- codex/p0-ci-baseline`）触发
  [CI run 33661119143](https://github.com/CZ3700/diandan/actions/runs/33661119143)，
  event=`pull_request`、head=`5a1c8f9c89b7a8ebf88dcac2055b7eeccca5fefe`、conclusion=`success`。
- [Quality job 100351615469](https://github.com/CZ3700/diandan/actions/runs/33661119143/job/100351615469)
  -> success；[Security job 100351615775](https://github.com/CZ3700/diandan/actions/runs/33661119143/job/100351615775)
  -> success，两者皆由 GitHub Actions App `15368` 提供。
- `main` classic branch protection 回读：`strict=true`，必需 checks 精确为
  `Quality`/`Security` 且 `app_id=15368`，`enforce_admins=true`，
  `allow_force_pushes=false`、`allow_deletions=false`；PR 回读 `mergeStateStatus=CLEAN`。
- GitHub 仓库回读 `secret_scanning=enabled` 且
  `secret_scanning_push_protection=enabled`；Actions 默认 workflow 权限为 `read`。
- 第一次完整保护请求同时传入 `contexts`/`checks` 被 GitHub 以 422 原子拒绝，
  回读确认无部分状态；按官方 OpenAPI 与运行时错误定位兼容性差异后，
  仅提交最小 `contexts` 请求，GitHub 正确自动绑定到 App `15368`。

可持久证据路径：
- `.github/workflows/ci.yml`
- `.secretlintrc.json` / `.secretlintignore`
- `scripts/check-ci.mjs` / `scripts/scan-secrets.mjs` / `scripts/check-workspace.mjs`
- `package.json` / `pnpm-lock.yaml`

范围与剩余风险：
- GitHub 原生 secret scanning 与 push protection 已开启，但平台能力不替代
  clean checkout/working tree 的本地可复现门禁；全历史告警仍以 GitHub 实际结果为准。
- 无 UI 变更，浏览器与多语言视觉证据不适用；无部署/发布结论。
```

独立评审：Codex `/root/p002_policy_review` 完成策略评审；Codex `/root/p002_final_review`
对最终实现候选 `88efe390c86c8b8e58b371fa196a9ae62c65de99` 重新执行 clean clone、全门禁与对抗
fixture，给出 `ACCEPT for REVIEW` 且未发现剩余代码阻断项；Codex
`/root/p002_remote_gate_review` 独立复核远端初始化拓扑、检查上下文和分支保护计划，
确认无改写历史或遗留阻断。真实 PR 与 required-check 外部门禁已满足，任务验收为 `DONE`。

### P0-02 S.U.P.E.R 检查

| # | 结果 | 证据 |
|:--|:--|:--|
| 1 | PASS | workflow、Secretlint 配置、CI policy checker 与 scanner wrapper 各自单一职责 |
| 2 | PASS | checker/scan 按读取、语义 policy、tracked boundary、working-tree boundary 和执行拆分 |
| 3 | PASS | 输入文件 → 语义解析 → 纯数据比较 → 错误输出，无反向依赖 |
| 4 | PASS | 未新增 workspace 依赖边，完整依赖图仍无循环 |
| 5 | PASS | workflow/Secretlint policy 由 YAML/JSON 与 exact expected objects 明确定义 |
| 6 | PASS | 校验边界只处理可序列化 YAML/JSON/plain JS 数据 |
| 7 | PASS | 无生产域名、密钥或业务常量；官方 registry/action SHA 是经核验的 CI 安全配置 |
| 8 | PASS | Secretlint/preset/yaml 均精确声明并锁入 `pnpm-lock.yaml` |
| 9 | PASS | scanner 或 Action 升级只需修改 CI/config/checker 边界，不触碰应用包 |
| 10 | PASS | 当前树、11 组失败 fixture、最终 clean clone、独立终审与真实 PR 双检查全部得到预期结果 |

## P0-03 执行卡

**范围**：在 `packages/config` 建立可序列化、环境无关的配置合同与解析边界，提供环境变量、`.env`、配置文件和默认值的明确优先级；根目录提供不含真实凭据的 `.env.example`；服务端缺少或包含非法必填配置时失败关闭；浏览器只能获得显式公开 allowlist。不得在 config/apps 复制 P1-01 才冻结的 locale 常量。

**本次执行登记**：

- Owner：Codex `/root`
- 开始：`2026-09-03T00:02:33+08:00`（`2026-09-02T16:02:33Z`）
- 精确范围：`packages/config` 的 schema、分层合并、服务端解析、公开配置投影与单元测试；根 `.env.example`；必要的精确依赖与 workspace/进度检查更新。
- 明确不做：P1-01 `SupportedLocale`/业务合同，P0-04 Next/Nest 应用组合根、数据库/对象存储容器与启动脚本，生产域名/市场/币种/支付方式，真实密钥或 Secret Manager 供应商实现。
- 验证计划：先写并运行失败测试，证明缺少必填项、非法 URL/环境、敏感字段进入公开投影及错误信息泄漏值会被发现；再以最小实现转绿。随后执行包级 test/typecheck/build、`.env.example`/locale/secret 边界检查、完整 `pnpm check`、secret scan、依赖审计与 clean-clone 复验。
- 并发/所有权：P0-03 是当前唯一 Lane A executor；实现期间独占 `packages/config`、根 `.env.example` 与本任务产生的 lockfile 变更。
- 风险映射：`R-02`；配置错误不得回显值，秘密字段不得进入公开 DTO、日志、fixture 或提交文件。

**完成证据**：

```text
状态：DONE（2026-09-03T00:47:13+08:00 独立验收通过）

实现候选：ba8b8864605e7181a85f2ffc13ca52087e0726e4
实现提交：
- badfa82 feat(config): add fail-closed runtime configuration
- 022b920 fix(config): harden source container boundary
- ff52e78 test(config): normalize disguised boundary errors
- ba8b886 fix(config): enforce least-privilege parsing

合同与边界：
- `@fan-support/config` 与 `@fan-support/config/public` 运行时只导出公开 parser/schema；
  `@fan-support/config/server` 独立导出 server/database resolver、公开投影与脱敏错误。
- 配置优先级为显式 `defaults < configFile < dotenv < environment`；只有 `undefined`
  表示缺席，空字符串、空白、null 等显式值会遮蔽低层并失败关闭。
- `defaults` 是组合根传入的最低优先级受信任值，不是包内隐式回退；本包不为 tier、站点、
  PostgreSQL URL 或凭据提供内置默认值，缺失配置仍失败。
- server 与 database fragment 共享全局键 allowlist，但只读取各自请求的字段；公开 DTO 通过
  两字段 allowlist 手工投影，冻结且携带 `schemaVersion: 1`。
- 外层/内层 source、公开 parser/schema 与 projector 只接受相应 own data property；继承属性、
  accessor、未知键、prototype-shaped key、hostile/revoked Proxy 均以固定错误归一化，不回显输入。
- `FAN_SUPPORT_SITE_ORIGIN` 仅接受 canonical HTTPS origin，或 development/test 的 loopback HTTP；
  数据库 URL 仅接受带主机和数据库路径的 PostgreSQL URL。对象存储配置留给 P0-04。

TDD 与失败路径：
- 精炼后的首次红灯：`.env.example`、public/server 模块和 subpath 尚不存在，58/58 失败。
- 外层 source 继承/accessor/unknown/Proxy 攻击加入后 4 条失败；伪装成包内错误的 Proxy
  加入后 1 条失败；四层/defaults、fragment 最小读取、public/projector/revoked Proxy
  合并补测后 15 条失败。对应实现后配置包最终 77/77 通过。
- 独立安全复核自写 42 条攻击断言全部通过；所有 canary 在 message、String、JSON、inspect、
  stack 与 cause 检查中均未出现。

主门禁：
- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/config test`
  -> exit 0，4 files、77 tests。
- config package typecheck/build 与 `eslint packages/config/src --max-warnings=0` -> exit 0。
- `mise exec node@24.20.0 -- corepack pnpm check` -> exit 0；workspace/CI/format/lint、
  typecheck/test/build 34/34、artifact smoke 全绿。
- `mise exec node@24.20.0 -- corepack pnpm security:secrets` -> exit 0；
  `pnpm audit --registry=https://registry.npmjs.org --audit-level=high` -> exit 0，
  No known vulnerabilities found。
- package self-reference 实际导入 `.`, `./public`, `./server` 成功；root/public 运行时键精确一致，
  server resolver 可用。范围 `rg` 未发现真实凭据或重复 locale 列表。
- 独立安全 clean clone `/tmp/fan-p003-security.PSe6qM/repo`：frozen install、完整 check、
  secret scan、audit、三出口 smoke 全绿；34/34/34 且 0 cached，最终 tracked tree clean。

可持久证据路径：
- `.env.example`
- `packages/config/package.json` / `packages/config/src/`
- `scripts/check-workspace.mjs` / `pnpm-lock.yaml`
- 本执行卡的失败路径、验证结果、S.U.P.E.R 与风险记录

范围与剩余风险：
- 无 UI 变化，浏览器尺寸/多语言视觉证据不适用；这不是部署或生产发布证据。
- P0-04 必须在应用组合根显式选择受信任 defaults，禁止提交生产 tier/site/DB/凭据默认值，
  并增加浏览器包不得导入 `@fan-support/config/server` 的依赖门禁。
- P0-02 真实 GitHub PR required checks 已完成，P0-04 现已 READY，但尚未领取。

独立评审：`/root/p003_security_review` 对最终候选给出 ACCEPT、42 条攻击与 fresh-clone
验收全绿；`/root/p003_config_design` 给出 ACCEPT；`/root/p003_repo_patterns` 完成 manifest、
lockfile、NodeNext、三出口与 clean-clone 集成复核，无 blocker。
```

### P0-03 S.U.P.E.R 检查

| # | 结果 | 证据 |
|:--|:--|:--|
| 1 | PASS | layer、URL、public schema、server resolver 与 error 各自单一职责 |
| 2 | PASS | 读取 own descriptor、分层选择、schema 校验、公开投影分别拆分 |
| 3 | PASS | source → allowlist/layer → schema → 冻结输出，核心测试无外部服务 |
| 4 | PASS | workspace 全图检查无循环；config 内依赖方向单向 |
| 5 | PASS | public/server/database 均有 Zod 或严格类型合同与 `schemaVersion: 1` |
| 6 | PASS | 成功输出是冻结 plain object，可 JSON 序列化，无 provider 对象 |
| 7 | PASS | 无生产域名、凭据、locale、市场/币种或供应商硬编码；无包内不安全默认值 |
| 8 | PASS | 唯一运行时依赖 `zod@4.5.4` 精确声明并锁定 |
| 9 | PASS | public/server subpath 与 server/database fragment 可独立替换、按需组合 |
| 10 | PASS | config 77/77；整仓 34/34/34；独立 clean clone 0 cached 全绿 |

## P0-04 执行卡

**范围**：建立稳定版 Next.js storefront/admin、NestJS + Fastify API/worker、PostgreSQL 与 S3 兼容对象存储的本地环境，并为四应用提供可重复的 OCI 构建、health 和 preview 证据。

**本次执行登记**：

- Owner：Codex `/root`
- 开始：`2026-09-03T01:54:21+08:00`（`2026-09-02T17:54:21Z`）
- 精确范围：四个应用的框架组合根与最小 health/readiness 界面；对象存储配置合同；Docker Compose 本地依赖与四应用 preview；独立 OCI 构建定义；可重复的结构、启动、health 和镜像验收脚本。
- 明确不做：P1 数据库 schema/migration、业务 API 与队列处理；P2/P3 设计系统与业务页面；P1-01 才冻结的 `SupportedLocale` 常量；P0-05 request ID/OTel/结构化日志；生产域名、凭据、云厂商或正式部署结论。
- 验证计划：先写并运行会因缺少框架/容器合同而失败的可重复检查；再分层运行四应用单元/类型/构建、整仓 `pnpm check`、secret/audit、Compose 配置与真实服务启动、API/worker health、storefront/admin 390×844 与 1440×900 浏览器验证、四个 OCI 镜像构建/预览/日志，最后在 clean clone 重复门禁。
- 并发/所有权：P0-04 是 W2 唯一 Lane D executor；Codex `/root` 独占 `apps/*`、`infra/`、容器/启动脚本、`packages/config` 的对象存储扩展、根 manifest/lockfile 和本执行卡。子代理只可执行明确的读取/研究/独立复核，或在不重叠文件所有权下实现。
- 风险映射：`R-14`；框架、PostgreSQL、S3 兼容服务和容器 base image 必须精确锁定并记录支持矩阵，必须用实际构建/health 而不是静态文件存在代替验证。

## Phase 退出证据

尚未开始。
