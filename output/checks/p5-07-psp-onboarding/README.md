# P5-07 接入手册与分级 TEST 演练

最终依据为 [验收报告](final-verification.md)、[统一入口结果](drill-final/result.json) 和 `integration-2026-09-22T10-05-55.604Z/`。四步骤通过；实际 PostgreSQL/TLS OIDC/S3/独立 TEST PSP/双 API 七阶段共 35259 断言通过，所有自有测试资源已清理。

- 使用与商户决策门：`docs/runbooks/psp-onboarding.md`；空白接入证据模板：`docs/runbooks/psp-onboarding-evidence-template.md`。
- `pnpm verify:psp-onboarding --plan` 无副作用；实际运行的输出目录必须不存在，详见验收报告命令。需要临时 Docker PG 或本机 native PostgreSQL bin。
- `runner-red.txt`、`http-first-run.txt`、`http-second-run.txt` 与失败 integration 目录保留原失败；`http-third-run.txt` 是较早成功样本，最终统计使用 final 目录。
- 非作者复核：`spec-review.md`、`quality-review.md`；下一项依赖：`next-stage-readiness.md`。
- 源码及原文件保护：`baseline-source.json`、`candidate-source.json`、`preexisting-untracked.json`、`compatibility-verification.json`、`final-gates.json`。

仅本地 TEST；未验证商业商户 sandbox、真实资金、云环境、生产发布或新浏览器/手机。持久可体验环境由 P5-08 明确承接，当前不可把会清理的测试夹具当完整本地部署。
