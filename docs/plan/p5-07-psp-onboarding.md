# P5-07 PSP Onboarding Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the bounded work below, with independent specification then quality review. One Task ID / Lane D; root owns shared files, checks and commit.

**Goal:** 新 PSP 接入有可执行手册、明确商户决策门和一次完整可重复的 TEST conformance/分级灰度演练。

**Architecture:** 仅文档与测试工具，复用 PaymentProvider 七操作、独立 webhook verifier、既有 OIDC 管理配置命令、PostgreSQL 与两独立 API。核心领域、公开 API/UI、历史迁移和已验收付款恢复行为保持；不接入多余商业渠道。

**Tech Stack:** Node 24.20.0 / pnpm 11.25.0、node:test、Vitest、现有 PostgreSQL18 / TLS S3 / OIDC / TEST PSP 夹具。

## 1. 接入手册（psp_runbook 独占）

- [x] 新建 `docs/runbooks/psp-onboarding.md`、`psp-onboarding-evidence-template.md`。
- [x] 对照实际 port/registry/config/health/exception source，逐步记录部署 adapter、端点独立验签、共同 conformance、商户 sandbox、真实小额/退款、分级 go/no-go 与停止/回退；引官方当前资料及核验日期。
- [x] 商户主体/KYC、产品法律属性、市场/币种/方式、CARD networks、USDT 网络/原子金额/quote/确认、Secret/MFA/关键译审均具负责人和证据栏；TEST 不代签。
- [x] 明确双桶 AND、固定 checkout/account/rule、规则新 UUID 改变 cohort、INTERNAL 仅 TEST，LIVE 内部验收需已验证隔离；回退创建新 publication，旧 attempt 原账户恢复。

## 2. 可重复执行入口（root 独占）

Files: `scripts/verify-psp-onboarding.mjs`、`scripts/verify-psp-onboarding.test.mjs`、`scripts/psp-onboarding-conformance.mjs`、根 `package.json`。

- [x] 先写 node:test：未知/重复参数拒绝；`--plan` 不产生文件或启动服务；真实子进程失败保留退出码、停止后继；失败/signal 不可汇总 PASS；已有输出目录拒绝覆盖。
- [x] 运行 `mise exec node@24.20.0 -- node --test scripts/verify-psp-onboarding.test.mjs` 记录初始缺实现失败。
- [x] 实现 `pnpm verify:psp-onboarding [--plan] [--output NEW_DIRECTORY]`：固定 build → 共用15case fake认证 → fake/gateway单测（含独立verifier）→新HTTP演练，shell=false逐项运行，保留步骤日志与退出码。报告明确LOCAL_TEST、无商业sandbox/资金/浏览器/生产结论。
- [x] 同命令复验测试；真实总入口执行并保留整体/各步骤 PASS/FAIL，不接受部分步骤代替整个演练。

## 3. 真实分级灰度（exception_ui 独占新psp-onboarding前缀脚本）

Files: `apps/api/scripts/psp-onboarding-http.mjs`、`psp-onboarding-protocol.mjs`，必要专属 helper/tests。

- [x] 复用 `withOrderAccessFixture`、`createAdminPaymentConfigurationFixture`，原生PG通过 `PSP_ONBOARDING_TEST_POSTGRES_BIN` 指定绝对bin，默认临时Docker PG；不接受现有数据库连接/数据目录。
- [x] 正常管理命令及独立审核发布 disabled/internal-TEST/5%/25%/100%/stop/rollback，真实服务端checkout在双进程的能力与PG/Domain决策一致，所有版本传播≤60秒；低比例记录实际样本，不强称准确人数份额。
- [x] 测七语稳定、旧UNKNOWN原键/账户恢复且PSP计数不增加，保留历史版本/审计；结果scope标记独立TEST PSP与实际PG等边界。
- [x] 运行演练前通知root统一build；不启动Next，当前无UI修改，无需新截图矩阵。

## 4. 统一验收与交付（root；非作者两阶段）

- [x] 受影响 node:test / fake/gateway tests、完整新drill、`pnpm check:dev`、`check:contracts`、adapter/artifacts、secret scan。
- [x] 以基线e8185776逐SHA检查旧合同/SQL与5993原未跟踪，记录新工具输入指纹；规格审查通过后再质量审查，解决所有发现。
- [x] 完成S.U.P.E.R10项，phase移REVIEW后验收DONE。独立核对P5-08所有原直接依赖，仅可离线部分READY，不领取；Phase6/7保持LOCKED。
- [x] 同步MASTER/phase/remaining-delivery/task-breakdown和本轮evidence README，精确文件暂存、本地提交，不push/云apply/真实资金。

本任务原最低验收就是fake conformance/灰度与runbook，商业sandbox/真实小额是手册中的新渠道启用门，不能误报完成也不人为增设成P5-07永久欠项。完整持久本地体验另按 `docs/runbooks/local-experience-readiness.md` 追踪。

验收证据：`output/checks/p5-07-psp-onboarding/final-verification.md`、`final-gates.json`。本 Task DONE；P5-08 有限本地 READY，未在本轮领取。
