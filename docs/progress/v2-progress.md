# V2 进度记录

> 方案：[2026-09-26-v2-launch-plan.md](../plan/2026-09-26-v2-launch-plan.md)
> 状态：`DONE`（完整验收）· `LOCAL_ACCEPTED`（本地完成，等外部条件）· `BLOCKED_EXTERNAL`（等外部决策/资源）· `IN_PROGRESS`
> 规则：每条不超过十行；验证产物在 `output/`（git 忽略），这里只记结论。

## R0 地基清理 —— DONE（2026-09-26，分支 `v2/r0-foundation`）

| 条目 | 状态 | 结论 |
|:--|:--|:--|
| R0-1 决策落盘 | DONE | ADR-018 Accepted、ADR-019 新增、方案 §7 记录用户批复（c3be1b5） |
| R0-2 远端备份 | DONE | 45 个分支全部推送 origin，66 个仅本机提交已备份 |
| R0-3 仓库瘦身 | DONE | 53G→7.1G；归档 `C:\Users\admin\Desktop\xiadan-archive-20260926\`（含 gc 前 .git 备份）；checkpoint ref 删除+gc，.git 2.0G→533M，fsck 干净 |
| R0-4 忽略与换行规则 | DONE | .gitignore 忽略 output/、生成合同、凭证扩展名（a1a7c20）；.gitattributes 统一 LF，research/root-evidence 保留原始 CRLF（fa0d2e5） |
| R0-5 Windows 开发环境 | DONE | 便携 Node 24.20.0（官方 SHA256 校验）+ corepack pnpm 11.25.0（`source ~/.tools/xiadan-env.sh`）；Mac 带来的 node_modules 不可用（空文件链接+darwin 原生包），frozen 重装 45 秒 |
| R0-6 门禁 Windows 可移植 | DONE | 修复真实缺陷：corepack 无 shell 启动、设计门禁路径比较（原在 Windows 上漏检=假绿）；夹具 junction、符号链接/POSIX-only 测试在 Windows 精确跳过、bootstrap 导入超时（fa0d2e5） |
| R0-7 证据出库 | DONE | UI 门禁本地只查结构，CI/`--require-browser-evidence` 强制；入库证据已过期（Next 16.3.6 后未重生成）；6,464 个证据文件移出跟踪、464 份 md 摘要保留（46197f5） |
| R0-8 治理对齐 V2 | DONE | 规范 4.0.0（§0.2/§2.2/§16.3）；AGENTS/CLAUDE/SKILL 改为 V2 入口、解除 push 禁令、简化进度记录；MASTER 加 V2 指引 |

**R0 验收**：`pnpm check:dev` 通过（workspace/边界/format/lint、typecheck 64/64、test 64/64、build 36/36）；完整 `pnpm check` 链 24 段中 22 段通过、`test:postgres`/`test:s3` 因本机无 PostgreSQL 18 与 S3 模拟而跳过，由 CI 承担。

**遗留说明**：
- `output/` 另有约 2 万个被全局规则（`*.log`、`dist/` 等）忽略的历史本地文件，从未入库、不在已确认的删除清单内，未处理。
- 远端 CI 自 2026-09-04 起未运行；建议 R1 开工前把 `main` 快进到 V2 主线并跑一次 CI（push 到 main 会触发 5 组回归，消耗 Actions 分钟，需用户确认）。

## 下一阶段：R1 生产就绪 + 支付预置

见方案 §6 与 §3：R1-1 生产组合根 → R1-3 Stripe 适配器 → Airwallex → 其余条目；可并行的纯前台减摩擦项见 §4（1/2/4/5 项）。
