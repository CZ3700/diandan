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
- Linux CI 基线（草稿 PR #13，run 36202613265）：security、operations 通过；quality、journey、commerce、catalog 失败。失败点分别是 UI 复合组件浏览器校验（360×800 英文 Hero 失败态布局偏移超过 1px）、本地体验在 Linux 上启动失败（supervisor 日志未随产物上传）、订单前台夹具的"每日礼物发布"媒体处理失败（`MEDIA_FAILED`）、catalog 详见产物。这些失败所在的脚本和代码 R0 都没有改动：R0 对回归框架的唯一改动 `resolveSpawnCommand` 在非 Windows 平台原样返回命令。回归矩阵加入 CI 后从未在 GitHub 上跑过，这是首次在 Linux 上运行，暴露的都是既有问题。修复单独立项。

## R1 生产就绪 + 支付预置 —— IN_PROGRESS（分支 `v2/r1-production`）

顺序见方案 §6 与 §3：R1-1 生产组合根 → R1-3 Stripe 适配器 → Airwallex → 其余条目；可并行的纯前台减摩擦项见 §4（1/2/4/5 项）。R0 的 Linux CI 基线：草稿 PR #13（`v2/r0-foundation → main`，2026-09-26 用户确认开启）。

| 条目 | 状态 | 范围与结论 |
|:--|:--|:--|
| R1-1 生产组合根 | LOCAL_ACCEPTED | 生产 API 注册全部路由依赖：admin 18 组、SEO、webhook（已部署验签器目录，未知端点在内存 404、不查库）、P5-05 支付目录（部署账户 + 数据库发布激活）；配置组"全缺=不可用、部分缺=启动失败"，淘汰静态绑定键；API 共享 3 个连接池（引用计数关闭）、单个 KMS/S3；worker 补管理中心任务循环。Test/Local 组合迁入 `src/testing/`，`pnpm deploy` 实测产物不含 `dist/testing`，导入图守卫经变异验证；29 个脚本 50 处导入改路径，静态校验 114 处 dist 导入全部可解析。`check:dev` 通过（api 84 文件/338 测试，worker 14/46；一次重跑前 persistence-postgres 3 个既有慢测试在负载下超时，单跑与重跑均通过）。未覆盖：真实 PostgreSQL 与浏览器集成（本机无 PG，交 CI）。遗留：`pnpm deploy` 安装阶段因 lighthouse→@sentry 缺 `@opentelemetry/core` 对等依赖失败，R0 版本同样复现，Docker 镜像构建会在此处失败 → R1-9 |
