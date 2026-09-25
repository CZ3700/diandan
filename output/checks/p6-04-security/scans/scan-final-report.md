# P6-04 最终源码扫描报告

已执行范围内，人工分类后没有确认的未关闭 High/Critical；这不是全应用无漏洞保证，也不是完整上线安全门已满足。父任务的隔离集成与浏览器验收仍独立进行，本子项不代签。

## 冻结源码与隐私

最终选择2535个自有技术源文件，比基线新增5个新源码/测试文件，未排除已存在的候选。全部与父任务 `../run-1/source.json` 的2921文件快照逐项SHA一致；sourceHash 为 `e2e16adc03d98cf80b0b8f69ab3196f71dc0fe9300ce2ea1f115980f84c15523`。检查结束后再次比对，源码无漂移。完整路径、SHA、新增/变更列表分别见 `source-final-manifest.json`、`source-final-delta.json`、`source-final-parent-comparison.json`。

源快照只包含Git跟踪或非忽略新增的 .ts/.tsx/.js/.mjs/.cjs/.mts/.cts/.yml/.yaml/.tf/.sh 和 Dockerfile，来自明确的应用/包/脚本/infra/CI/database/provider-fixtures 根；排除私有 .env、用户配置、生成与运行时目录、symlink。JSON合同、SQL、依赖实现、实际镜像和云资源不是本次Semgrep语义覆盖范围；锁文件另行audit、IaC另行mock-plan。工具与规则仍在 node_modules/.cache 的隔离目录，未新增tracked运行依赖。Semgrep metrics/version check关闭、无云登录/代码上传；audit只提交标准依赖元数据给官方npm registry。

## 实际结果

| 检查 | 最终结果 | 完整证据 |
| --- | --- | --- |
| npm audit | Node24.20 / pnpm11.25，exit0；628总依赖，各级0 | `pnpm-audit-final.json`、`pnpm-audit-final-command.json`、stderr |
| 官方已知Next通告 | admin/storefront声明与实际安装均16.3.6，lint plugin同步；已离开GHSA影响范围 | `next-final-advisory-assessment.json`；baseline官方通告评估保留 |
| 原秘密扫描 | exit0；没有修改scanner、ignore、policy或suppression | `secret-scan-final-command.json`、`secret-scan-final-log.txt` |
| Semgrep OSS1.157.0 | 官方固定规则494，实际运行482；2536扫描目标=2535源码+选择配置；exit0；130原始候选 | `semgrep-final.json`、`semgrep-final-sarif.json`、`semgrep-final-log.txt`、command/coverage |
| 人工分类 | 3ERROR/114WARNING/13INFO；工具等级不等同已证实漏洞等级；未确认剩余High/Critical | `semgrep-final-findings.json`、`semgrep-final-delta.json`、`semgrep-triage.md`、`../content-review.md` |

最终候选与基线的差异只有两处：TEST邮件GCM tag长度候选移除；新的限流测试从本地、受版本控制的路由声明构造RegExp，新增1个non-literal-regexp候选，无不可信输入/部署运行路径。原始130候选不删除、不改成零。3个剩余GCM候选均在固定切片的16B标签路径，已逐处人工核验。

基线npm feed没有包含已发布的Critical GHSA-vcvr-r3jv-pc5j，因此audit0不能独自证明已知风险清零。候选版本16.3.6关闭了该已披露版本范围，官方条件/应用可达性与未来通告仍见 [Next安全更新](https://nextjs.org/blog/nextjs-security-update-september-22-2026)、[GitHub通告](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)。[9月23日预告](https://nextjs.org/blog/upcoming-nextjs-security-release-september-2026)的9月30日新发布仍须届时或部署前重核，未披露范围不能推断。本轮未重启或升级用户持久体验实例，不宣称已部署环境修复。

## 部分解析：逐位置复核

11个诊断覆盖15个不同源码行；没有将它们隐藏成100%覆盖。实际冻结源码各行已读取核对，详情为 `semgrep-final-partial-parse-review.json`：

| 路径（均相对仓库） | 行 | 人工抽查说明 |
| --- | --- | --- |
| .github/workflows/ci.yml | 62 | 两条嵌入Bash规则不识别固定pnpm命令里的GitHub matrix.suite插值；不是任意输入执行 |
| apps/storefront/src/storefront/artist-directory.test.tsx | 80 | 测试URL查询中的&字符 |
| apps/storefront/src/storefront/cart-checkout-entry.test.tsx | 37 | 同上 |
| apps/storefront/src/storefront/commerce-context.test.tsx | 67、140 | 同上 |
| apps/storefront/src/storefront/gift-browse.test.tsx | 50 | 同上 |
| apps/storefront/src/storefront/gift-directory.test.tsx | 130、214 | 同上 |
| apps/storefront/src/storefront/page-factory.test.tsx | 159 | 同上 |
| apps/storefront/src/storefront/site-header-lazy-boundary.test.tsx | 113 | 同上 |
| apps/storefront/src/storefront/site-header-navigation.test.tsx | 24 | 同上 |
| packages/persistence-port/src/index.ts | 1、2、333、334 | export type *纯类型重导出，行内无可执行表达式 |

人工抽查只能解释这些位置，不能补足被跳过的规则语义或OSS缺失的跨文件数据流分析。基线首次invalid-rule退出7、首次配置导致零targets、Pro引擎不存在、首次Vitest配置路径/安装窗口lint错误均在 `scan-report.md` 与相应原始日志保留；未把启动失败或0扫描当作通过。

## 修复与独立复核

本扫描子代理仅受托修改TEST mail helper及现有test：先RED证明4/8/12/15B正确前缀被Node24接受，再固定authTagLength16，16B原格式可解、IV/tag/ciphertext篡改拒绝。最终9/9测试与ESLint/Prettier通过，见 `gcm-final-checks.json`；这是TEST-only防御加固，未证明远程数据库改写/利用链。非作者验收由其他reviewer负责。

本子代理独立审查Next/CI、RUMv2及IaC作者改动；旧生成合同仅新增RumReportV2，其余defs值相等。RUM合同3/3、聚合15/15、CLI/依赖/UI证据验证器18/18、IaC/安全工具7/7及最终check-ci均通过，见 `independent-change-review.md`。IaC作者最终14条工具命令全exit0，21个输入SHA全部重新比对一致，cloudEvidence=false；mock-plan不是云阻断证明。

## 保留风险与范围

- **Low：SPEC15的全站CSP / Permissions-Policy基线尚不完整，严格nonce/hash脚本策略也未覆盖全应用。** 当前没有已证实的注入前提；此事实不应被写成完整安全门已满足，上线前须跟踪与真实Next/PSP兼容验证。
- Low：部署role的task-definition wildcard权限需在云部署前依据当前AWS service授权与实际角色需求再收紧/确认；没有真实云执行证据。
- 匿名RUM即使CLEAN也不证明样本真实、代表性或release acceptance；DEGRADED不得通过性能预算门。
- 实际WAF阻断/私网不可绕过、正式IdP/PSP/邮件composition、运行时镜像与完整staging仍属于部署门；本地TEST直连不经过WAF。

该报告仅提交本子项扫描与独立源码复核结果；P6-04的最终状态由父任务合并全部真实集成/浏览器证据后决定。
