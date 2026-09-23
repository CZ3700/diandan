# P5-08 本地持久体验与离线基础设施

> Implementation workflow: writing-plans + bounded subagents + TDD + independent review.

## 验收目标

同一套 PostgreSQL 和媒体存储支撑前台、管理中心、API、Worker；本地 OIDC 登录，管理上传内容，TEST 托管支付，经签名 webhook 更新订单，安全查单，管理准备/送达/退款。停止并重启后内容、订单、配置和密钥保持。默认不外发邮件、不产生真实支付、不连接 AWS。

## 分工与顺序

1. root：持久状态与所有权失败测试；固定随机端口/稳定密钥，私有 TLS，持久 PostgreSQL/对象存储；单命令启动/状态/停止/打开；最小一次业务初始化。运行重复启动、停止、重启及隔离保护检查。
2. p508_services：本地 OIDC、TEST PSP、加密邮件捕获；持久 provider 数据，受信签名 webhook 可重试；服务测试先行。
3. p508_runtime：既有实际 composition 合并为 API，独立 Worker，稳定 TEST KMS，新增艺人的 TEST 履约配置；不放宽生产合同。
4. p508_iac：ADR-007 可复用 OpenTofu 模块，固定工具和 provider；fmt/init -backend=false/validate/mock plan；离线检查禁止云端副作用。
5. root：真实浏览器管理上传、购物与订单处理；390×844 /1440×900、键盘、错误、reduced motion；停止重启后复查。整理本地操作入口。
6. 非作者规格审查、质量审查、代码收敛、受影响测试与 format/lint/typecheck/build、合同/迁移/原有未跟踪文件保护和 S.U.P.E.R 10 项；精确暂存并本地提交。

## 边界

任务 P5-08 保持 IN_PROGRESS，直到实际 staging plan/apply、DNS/TLS、PSP/对象存储真实环境、二次 apply 无漂移和云端预算/配额证据齐全。离线验收与持久本地体验是独立证据，不冒称生产就绪。当前不推送、不部署、不申请云端资源。

## 证据入口

`output/checks/p5-08-local-deployment/`；启动私有状态位于 `node_modules/.cache/fan-support-local-experience/<instance>/`。检查报告只含脱敏结果；不得包含用户私密留言、完整姓名、email、token、支付或 OIDC 密钥。
