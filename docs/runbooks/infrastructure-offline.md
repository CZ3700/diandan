# P5-08：离线基础设施验证与云执行交接

本入口实施 ADR-007 的资源定义，遵守 ADR-016 的本地边界。它**不连接 AWS API、不读取已有 state、不执行真实 cloud plan/apply**。通过结果只证明固定工具版本下的配置解析、provider schema、mock plan 和断言；P5-08 仍需真实 staging 验收。

## 输入与目录

- `infra/opentofu/bootstrap`：独立 state bootstrap，私有 S3、版本历史、KMS、TLS/指定操作角色保护、native S3 lockfile 和最小 state 操作策略。
- `infra/opentofu/registry`：独立的四应用 immutable ECR foundation，先建仓并由获准的 foundation 身份推入四个 digest；主 stack 只读取明确仓库，避免 ECS 在空仓创建时启动。
- `infra/opentofu/stack`：同一组模块用于 `staging` 与 `production`，必须使用不同 resource prefix、state key、DNS 名和明确账户；建议独立 AWS 账户。源码不保存真实 tfvars、backend 文件、凭据或 state。
- `infra/opentofu/modules/{network,data,media,compute,edge,operations}`：分别负责网络、RDS、媒体、运行时、边缘和运营护栏；只有 AWS provider。没有外部 module、provisioner、脚本执行器、Redis、SQS 或外部商城。
- `infra/opentofu/toolchain.json`、三个 `.terraform.lock.hcl`：OpenTofu **1.12.6**、AWS provider **6.66.0**，包括官网发布包 SHA256 和签名 provider lock hashes。版本升级必须重新执行全套离线检查与实际 staging 门。
- `deployment-manifest.schema.json` / `.example.json`：version 1 的四镜像 digest、完整 release commit 和 environment 身份。示例仅包含 `example.invalid`、全零账户与合成 digest。`cloudEvidence=false` 不能改成上线批准。

## 重复执行

```sh
node --test scripts/check-infrastructure.test.mjs
node scripts/check-infrastructure.mjs
node scripts/check-infrastructure.mjs --tofu /absolute/path/to/tofu
```

第二条只做静态安全检查，会明确返回 `STATIC_ONLY`，不能替代第三条。第三条在全新临时目录复制白名单源码与 provider lock，执行固定的 `fmt -check / init -backend=false -lockfile=readonly / validate / test -filter=tests/offline.tftest.json`，然后清理临时目录。测试文件只允许所有 AWS provider（包括 backup alias）均为 `mock_provider`，每个 run 必须显式 `command=plan`、`refresh=false`。入口没有 apply、真实 plan、AWS CLI、后台 state 初始化或任意参数转发能力。

子进程使用独立 HOME/CLI 配置与空 AWS 配置，删除继承的 AWS、TF、proxy 和其他凭据变量，禁用 EC2 metadata。冷 `init` 会从官方 registry/发布站下载 provider，因此“离线”表示与云账户、业务数据及资源隔离，并不表示首次运行完全无公网下载。下载也不需要 AWS 凭据。运行日志及每个源码 SHA256 写入 `output/checks/p5-08-local-deployment/iac/`；工具二进制、archive 和 `.terraform` 不进入 Git。

缺少 OpenTofu 时，从 `toolchain.json` 指向的官方 release 下载对应平台 zip 和 `SHA256SUMS`，先比对文件 SHA256 与仓库锁定值，再解压到任务 output 目录并赋予执行权限。不要修改系统安装；校验失败必须停止。首次正式复现还应按 OpenTofu 官方方式验证发布签名。此次使用 macOS arm64 archive `e083ee43790ab9e19ad66d9933e24a7244a1412e1d5728f37999ae2163fdac95`；provider 安装由 OpenTofu 验签并按 lock 验 hash。

## 已定义的资源与边界

| 部分 | 定义 | 真实环境仍需证明 |
| --- | --- | --- |
| State | S3 versioning、SSE-KMS、TLS、角色限制、`use_lockfile=true`；lock 删除权限仅 `states/*.tflock` | 建立受控 bootstrap 本地 state→迁移到专属 state key；两个并发 executor 锁冲突；版本恢复；操作角色有效且无自锁 |
| 网络 | `us-east-1` 至少两 AZ；public subnet 只有每 AZ NAT；ECS/internal ALB 在 private application subnet；RDS 在无默认出口的 database subnet；S3 gateway 和 ECR/logs/KMS/Secrets endpoints | 账户实际 AZ ID（当前排除 `use1-az3`）、CF origin prefix list 配额、NAT/endpoint 路由、无法从公网绕过 internal ALB；VPC Origin service-linked role/ENI 创建 |
| 容器 | 四个 ECR immutable repository、扫描、Fargate service 每项 2 task、AZ rebalance、健康检查/优雅停止、独立 task/execution role；只有三个 HTTP target group，Worker 无入站 | 实际四镜像已推送到对应 registry、x86_64 支持、跨 AZ placement、替换与回退；非 root UID、临时文件/cache 写入兼容；`/healthz` 不能替代业务 smoke |
| RDS | 显式版本/实例尺寸、Multi-AZ、TLS 强制、KMS、35天 PITR、deletion protection/最终快照、加密复制到 `us-west-2` | 账户当前 PostgreSQL minor/实例可用性及仓库 migration 兼容；CA `verify-full`；应用最小 DB role；跨区 restore/PITR/RPO/RTO 实测 |
| 媒体 | 独立私有 source/derivative，versioning/KMS、未完成上传清理、历史版本分层；仅 derivative 给指定 CF OAC `GetObject`+KMS decrypt | presign/CORS（含 grant 必需 `if-none-match`）/checksum、实际 IAM 拒绝、原图不能公开、衍生图读取、版本恢复和保留策略 |
| 边缘 | CloudFront VPC Origin→HTTPS internal ALB（仅 `/api/v1/*` 转 Nest，Next BFF 留在各前端）；S3 OAC 单独 media distribution；Route53/ACM；canonical alias 308；WAF managed/rate 默认 count | 证书/DNS/Host路由、HTTP跳转、托管接口/回跳/大请求兼容；count-before-block 取证后才启用 WAF block |
| 观测/成本 | CloudWatch ECS task/CPU/ALB healthy/5xx/RDS空间/实际Fargate quota阈值、加密 SNS、预算实际/预测及成本异常邮件；严格 OIDC deployment role | 邮件确认和告警实际触达、idle/base/peak Pricing Calculator、配额余量、CloudFront/ALB/RDS配额、account已有cost monitor的import/归属 |

所有 HTML/API 默认 `private, no-store`，包含 locale 根入口、Admin、preview、cart、checkout、order/token/auth 和失败响应；TTL 与错误缓存 TTL 为 0。不可变 Next 静态资源缓存包含 Host，两个前端互不串缓存；公开衍生媒体单独分发。公共目录暂时不启用共享动态缓存，这个安全默认不制造 locale/market/currency 共用 cache key。未来启用动态缓存须用真实七语言、market/currency、cookie 变体证据建立独立缓存策略，不能把敏感 route 设为正 TTL。

ALB/CloudFront 原始访问日志和 WAF sampled request 均不启用，避免 query、Cookie、Authorization、token、完整邮箱或私密留言进入云日志。应用沿用现有结构化 allowlist；RDS 禁止 SQL statement/parameter error logging。CloudWatch 平台指标仍可用。应用 OTel exporter、pg-boss backlog/DLQ 自定义指标的 cloud composition 与触达仍须实际接通，不能把本模块的基础设施告警说成完整业务监控。

## 密钥和运行时组合

IaC 不创建 `secret_version`、随机密码或任何带明文 secret 的 data source。RDS 自管管理员密码，Terraform 只保存 secret ARN；应用角色不获管理员 secret 权限。DB role 和具有 `sslmode=verify-full`/受信 CA 的连接配置必须经受控流程建立为独立 Secrets Manager 对象。应用只接受完整 ARN references，通过 ECS execution role 在启动时注入；每 app 的 KMS/Secrets 权限单独列明。日后轮换注入 secret 需要受控 service rollout，不会因为 ARN 不变而自动更新运行中的环境变量。

`application_environment` 只允许非秘密配置；含 PASSWORD/SECRET/TOKEN/PRIVATE_KEY/DATABASE_URL/ACCESS_KEY/CREDENTIAL 的键被拒绝，保留的 origin/port/environment 也不得覆盖。不会把实际数据库 URL、PSP credential、OIDC client secret、envelope key 放入 tfvars、镜像或 manifest。API/Worker 的对象存储使用现有配置名和 `ambient` IAM 模式；bucket、region、HTTPS endpoint、public media origin 来自云资源输出与明确配置。当前四镜像使用非 root UID 与 Fargate 临时可写根目录；Next cache/worker临时文件不使用持久卷，业务数据仍只写PG/S3。只读根文件系统须先完成镜像内临时/cache目录与卷权限兼容验证，再收紧。envelope key refs 仅授权实际 adapter 使用的 `Decrypt/GenerateDataKey/GenerateDataKeyWithoutPlaintext`；独立 `application_mac_key_arns` 只给 API/Worker 实际盲索引需要的 `GenerateMac`，当前 adapter 没有调用 `VerifyMac`。严格区分 media key、Secrets key、envelope key 和 HMAC key，禁止全账户 `kms:*` 赋给应用角色。

**当前源码的生产业务 composition 尚未验收。** Admin 的 `TEST/LOCAL_OIDC`、TEST PSP、通知 TEST adapter 等不能在 staging/production 假冒真实身份、商户或邮件。此交付提供配置引用和资源边界，不擅自启用这些模式。正式部署前必须实现并评审批准 OIDC/MFA、KMS envelope、PSP sandbox/凭据、真实事务邮件、数据库角色与业务 worker 的 production composition，确认完整业务路径已启用；只看到容器健康不能通过此门。

## 云执行门与回退交接

本次不执行下列动作。账户、域名、成本、运行时、正式商户/身份/邮件资料和用户云执行授权齐备后，由独立云执行任务完成：

1. 审核非秘密参数、不同环境 state/account、正式四镜像 digest/签名/漏洞结果和 source commit；保留前一完整 manifest。确认 AWS 区域服务、RDS minor、Fargate CPU/memory组合及配额，保存 idle/base/peak 成本估算。
2. 在有备份和访问控制的 bootstrap 工作目录初始化本地 state，建立 state 资源后，在该受控工作副本新增未跟踪的 `state-backend.tf`，其中声明 `terraform { backend "s3" {} }`；再以明确的迁移流程迁移 bootstrap 自身，随后对 staging 使用独立 key。原 bootstrap 源码使用 implicit local backend，不能先初始化尚未存在的 S3 backend。生产和 staging 不能共用 state。把 bootstrap 输出 KMS ARN、`encrypt=true`、`use_lockfile=true` 写入私有 backend 配置；附加输出的 state IAM policy 并实际验证角色后再限制访问。bootstrap 的第一次执行不能试图使用尚未存在的 S3 bucket。
3. 先在独立 registry state 建立四个仓库并推入已验收 digest，再获得主 stack 的真实可审查 cloud plan、干净 staging apply、smoke 和第二次零漂移 re-apply。mock plan 不承担该证据。账户已有的 Cost Explorer monitor、DNS记录、service-linked role 应先审核 ownership/import，禁止覆盖未知资源。
4. 完整 smoke 覆盖四应用 digest/跨AZ/健康恢复、实际 PG+pg-boss、TLS/IAM/KMS拒绝、source上传与checksum、OAC、locale/market/currency/no-store、purge≤60s、WAF支付回跳/webhook、预算告警和secret轮换。七语言完整业务由原任务门共同验收。
5. 回退只引用前一已验证 manifest 的四 digest，保持已有未知支付的原 provider/account/idempotency；不重建订单或回写支付结果。ECS circuit breaker 辅助失败回退，不能替代人工比对与业务证据。数据库先行 expand/contract；破坏性数据恢复必须新实例 PITR/受控切换，不在原库反向覆盖。对象按 key+checksum+version 恢复；DNS/WAF/CF保留前版并验证回切。
6. P6-06 另做 failover/PITR/跨区/对象/四应用回退演练，计时 RPO/RTO/15分钟目标；P7 再完成真实资金、UAT与灰度。上述条件缺少时保持 P5-08 `IN_PROGRESS`。

## 官方资料（2026-09-22 核对）

- [OpenTofu 1.12.6 发布](https://github.com/opentofu/opentofu/releases/tag/v1.12.6)、[test/mock provider 与 plan 默认](https://opentofu.org/docs/cli/commands/test/)、[S3 backend/lockfile](https://opentofu.org/docs/language/settings/backends/s3/)。测试默认会 apply，所以本入口必须逐 run 拒绝省略 command。
- [AWS provider 6.66.0 VPC origin 定义](https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/cloudfront_vpc_origin.html.markdown)、[CloudFront VPC origin 前提与限制](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)。IGW 是 VPC origin 前提，不给 private subnets 添加公网 route。
- [S3 OAC 与 SSE-KMS 权限](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)、[RDS 自管 master secret](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html)、[跨区 automated backup](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReplicateBackups.html)。供应商能力不代表已经完成本项目恢复验收。
