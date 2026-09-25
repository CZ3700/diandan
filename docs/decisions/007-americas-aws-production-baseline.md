# ADR-007：美洲首发的 AWS 单云生产基线与 Akamai 退出路径

> 状态：Accepted
>
> 日期：2026-09-03
>
> 决策者：用户明确首发主要地区为美洲，并授权在 AWS / Akamai 与全球低运维方案间完成技术选型；Codex `/root` 依据供应商官方资料完成技术评估
>
> 关联：Phase 0 退出门禁、P1-05、P5-08、P6-05、P6-06、P7-04；R-02、R-11、R-14、R-15、R-16、R-17

## 背景

平台是四个独立 OCI 镜像组成的源码自有模块化单体，PostgreSQL 是订单、支付编排、价格和库存的唯一业务真相源；对象存储、CDN、WAF、KMS/Secret Manager 与监控只允许位于 port/adapter 或 composition root 后。首发需要覆盖美洲用户并保持全球可访问，但没有足够流量、团队或合规事实支持一开始建设 Kubernetes、多区域写入或双云控制面。

已核实的供应商事实：

- AWS 建议按主要用户距离和所需服务选择 Region；`us-east-1` 位于美国弗吉尼亚并有六个 Availability Zone，`sa-east-1` 位于巴西并有三个。<https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html>
- ECS Service 可在 Fargate 上维护期望任务数、替换故障任务、自动扩缩，并通过一个 Application Load Balancer 做基于路径/主机的 HTTP 路由。<https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html>
- RDS for PostgreSQL 的 Multi-AZ DB instance 在另一 AZ 维护同步 standby 并自动 failover；官方给出的典型 failover 时间为 60–120 秒。<https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html>、<https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.Failover.html>
- RDS 每五分钟上传事务日志并支持 retention 内任意时间点恢复；PostgreSQL 的 snapshot 与事务日志也可复制到另一个 Region。<https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html>、<https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReplicateBackups.html>
- CloudFront 从全球边缘读取源站，AWS WAF 可在请求到达源站前保护 CloudFront；CloudFront VPC Origin 可连接私有子网中的 internal ALB，避免公开源站绕过边缘入口。<https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HowCloudFrontWorks.html>、<https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-awswaf.html>、<https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html>
- Akamai Managed Databases powered by Aiven 支持 PostgreSQL 与三节点同区域 HA，但公开文档当前只明确每日自动备份、14 天保留及基于这些备份的恢复，没有给出本项目所需的五分钟级恢复点和一小时恢复时限承诺。<https://techdocs.akamai.com/cloud-computing/docs/aiven-database-clusters>、<https://techdocs.akamai.com/cloud-computing/docs/aiven-manage-database>
- Akamai LKE 的生产 HA control plane 是额外计费能力，用户仍负责 deployment/application 配置；Akamai App & API Protector 和对象存储本身可作为有价值的未来边缘/存储候选。<https://techdocs.akamai.com/cloud-computing/docs/linode-kubernetes-engine>、<https://www.akamai.com/products/app-and-api-protector>、<https://techdocs.akamai.com/cloud-computing/docs/object-storage>

本决策使用两个显式假设：首发流量分布在北美、拉丁美洲和其他地区，而不是绝大多数只位于巴西；首发规模是低到中等流量、无已确认的国家级数据驻留强制要求。首发国家、币种、经营主体和 PSP 资格仍是独立决策，不能从 Region 或 locale 推导。

## 决策

首发采用 **AWS 单云 origin + AWS 全球边缘**；Akamai 不承担首发计算或数据库，只保留为经量化后可替换的 CDN/WAF/DNS 候选。

1. **区域与容灾边界**
   - 主 Region 固定为 `us-east-1`，应用和数据库跨至少两个 AZ。
   - `us-west-2` 只作为加密 RDS cross-Region automated backup 的首个目标，不在 MVP 建设第二写入 Region、热备应用或全局数据库。
   - `sa-east-1` 是南美动态流量实测不达标或数据驻留要求出现时的首个重新评估候选；它不是由葡萄牙语 locale 自动选择的 Region。
2. **容器运行时**
   - 四个现有 OCI 镜像进入 Amazon ECR，并由 ECS on Fargate 统一运行；不引入 EKS、EC2 节点组或 App Runner + ECS 混合运行时。
   - Storefront、Admin 和 API 通过 CloudFront VPC Origin 连接一个 internal ALB，并使用独立 host/path target group；Worker 没有入站负载均衡器。四个 Service 的生产基线均为两个 task 并跨 AZ，由 ECS 自动替换；Storefront/API 的扩缩阈值在负载测试后确定。
   - 长任务、定时任务和可靠事件继续使用 PostgreSQL Outbox + pg-boss；本决策不引入 Redis、SQS 或 Kubernetes。
3. **数据与恢复**
   - 使用 Amazon RDS for PostgreSQL Multi-AZ DB instance（一个同步 standby），私有子网、TLS、KMS at-rest encryption、deletion protection、最终快照和 35 天自动备份/PITR。
   - 使用 standard PostgreSQL 能力与仓库 migrations；不选择 Aurora 专有能力，不允许 RDS 对象、ARN 或 SDK 类型进入 Domain/合同。
   - 启用到 `us-west-2` 的加密自动备份复制。五分钟事务日志上传是能力依据，不等于已经取得 RPO/RTO 证据；实际 failover、PITR 和跨区 restore 必须由 P6-06 实测。
4. **对象、边缘与入口**
   - 使用 Amazon S3；原始媒体 bucket 私有，公开衍生图由独立私有 bucket + CloudFront Origin Access Control 提供，开启 versioning、KMS encryption、生命周期和 checksum 校验。
   - 使用 CloudFront + AWS WAF + Route 53 + ACM。公共内容按 locale/market/currency 的真实变体缓存；Admin、preview、cart、checkout、order、token exchange 和认证响应全部 `private/no-store`。
   - internal ALB 不提供可从互联网绕过的源站入口；若 P5-08 发现 CloudFront VPC Origin 的限制与应用冲突，唯一允许的降级是 internet-facing ALB + CloudFront origin-facing managed prefix list + origin verification，并必须记录 ADR amendment。公开入口使用 WAF managed baseline、速率限制和可观测的 count-before-block 调整，避免规则误杀支付回跳/webhook。
5. **密钥、配置、观测与 IaC**
   - 使用 AWS KMS + Secrets Manager 保护 envelope key、数据库凭据和部署 secret；任务通过最小权限 IAM role 获取引用，不把值写入镜像、IaC state、浏览器或日志。
   - CloudWatch 承担 AWS 平台日志/指标的首发落点，应用继续输出当前 OTel/结构化 stdout 合同；是否再接第三方 observability/error vendor 仍留到 Phase 4/6 决策，不允许 SDK 反向渗透 Domain。
   - 使用 OpenTofu 管理 VPC、ECR、ECS/ALB、RDS、S3、CloudFront/WAF、Route 53/ACM、KMS/Secrets 引用、预算/告警和部署角色。新增 P5-08 明确承担 production-like staging 与可复用 production module，避免把“已选供应商”误报成“已部署”。
6. **成本护栏**
   - 首发接受 Multi-AZ RDS、ALB、Fargate 最小 task、NAT/endpoint、WAF/CDN、日志与跨区备份形成的固定成本；这是可靠交易站的有意取舍，不按单台 VM 最低价优化。
   - P5-08 apply 前必须用 AWS Pricing Calculator 按 idle/base/peak 三档保存估算，并配置月预算、异常成本告警和服务配额检查。稳定使用量出现前不购买长期承诺。

本 ADR 不冻结 PostgreSQL major、实例/任务尺寸、NAT 与 VPC endpoint 的具体组合、首发国家/币种/PSP、正式域名、邮件供应商或第三方观测供应商；这些值必须通过兼容性、账户、负载、成本和业务决策获得，不能在业务代码硬编码。

## 考虑的方案

| 方案 | 优点 | 缺点/风险 | 结论 |
|:--|:--|:--|:--|
| AWS 单云：ECS Fargate + RDS PostgreSQL + S3 + CloudFront/WAF | 同一 IAM/IaC/支持与网络控制面；四容器和 Worker 统一运行；RDS 有明确 Multi-AZ、五分钟日志/PITR 与跨区备份能力 | 固定成本高于单 VM；单供应商/主 Region 风险；仍需真实恢复演练 | **选择** |
| 纯 Akamai Connected Cloud | 计算和对象存储公开价直观；全球边缘能力强 | 合理生产形态需 VM 运维或 LKE；公开 DB 恢复证据不足以证明目标；KMS/Secrets 与私网成熟度需要额外方案/确认 | 首发拒绝，保留以后复评 |
| AWS origin + Akamai edge | 可保留 AWS 数据/密钥能力并获得 Akamai WAAP/边缘产品 | 两套 IAM、IaC、账单、TLS/DNS、purge、日志和事故归属；增加 egress，且不会自动形成多云容灾 | 首发延期；有合同或量化收益时再选 |
| App Runner 承载 HTTP、ECS 承载 Worker | HTTP 服务部署更少配置 | 两种运行时；连接私有 RDS 后仍要处理 VPC egress/NAT/endpoint；发布、日志和故障模型分裂 | 拒绝 |
| EKS/LKE | 标准 Kubernetes 生态，迁移表面统一 | 对四个镜像的 MVP 增加集群、Ingress、升级、节点、secret 和容量运维 | 拒绝 |
| 单 VM / Lightsail 类方案 | 初期账单和概念最少 | 支付/订单站的 HA、补丁、扩缩、恢复和不可变部署更多由团队承担 | 拒绝 |

## 后果

- Phase 0 的“生产区域/容器/PostgreSQL/对象存储/CDN/WAF”选型门关闭；它只证明决策完整，不证明 AWS 账户、staging、生产、备份或恢复已可用。
- Phase 1/2 可同时激活；主执行者先冻结 P1-01 合同，P2-01 保持 Lane B 的独立 READY 工作。
- P1-05 的 PostgreSQL/S3/CDN/KMS adapter 必须保持标准 port；AWS SDK 对象与 ARN 只允许在 adapter/config 内。
- 新增 P5-08，填补原计划中“P6-06 要求云上恢复演练、但没有任务创建生产 IaC”的缺口；该任务在 Phase 6 前完成 OpenTofu、production-like staging、不可变镜像部署和基础 smoke。
- 单 Region 和 AWS 集中风险被有意接受为 MVP 风险；跨区备份降低数据灾难风险，但不能替代已演练的 Region failover。
- Akamai 的强项被保留在替换边界：切换边缘供应商不应修改 Domain、订单、库存、支付状态机或媒体对象身份。

## 验证与回退

### 分阶段验证

- **当前 Phase 0**：复查本 ADR、供应商官方能力链接、任务依赖与状态计数；运行 `git diff --check`、文档状态统计和完整 `pnpm check`。不得写“生产部署完成”。
- **P5-08**：`tofu fmt -check`、`tofu validate`、可审查 plan、干净账户/环境 apply；四镜像使用固定 digest；验证多 AZ placement、健康替换、least-privilege IAM、private RDS/S3、presign/CORS/checksum/version restore、CloudFront cache/no-store/origin lock、WAF、purge ≤60 秒、预算和配额告警。
- **P6-05/P6-06**：注入 task/AZ/DB/对象/edge 故障；分别演练 Multi-AZ failover、PITR 到新实例、跨区备份 restore、对象版本恢复、四应用 OCI 回退、WAF/CloudFront/IaC/DNS 回退，并记录实际 RPO、RTO 和代码回退时间。
- **P7**：从美国东/西、加拿大、墨西哥和南美测量动态 API 与 RUM；完成 PSP sandbox/真实小额、staging UAT 与逐级灰度后才可宣称可发布。

### 重新评估触发器

- Phase 6/7 的美洲 RUM、动态 checkout/API 或支付成功率未达到既定预算，且证据显示瓶颈是 origin 距离而不是前端、PSP 或第三方脚本。
- 南美成为主要交易来源，或法律/合同要求数据位于指定国家/Region。
- Akamai 提供包含 CDN/WAF/DNS、支持、日志和流量的正式报价，并在真实 A/B 中相对 CloudFront 有可量化收益。
- RDS/S3/CloudFront 的成本、配额、区域能力或事故风险超出预算与恢复门限。

### 回退与供应商退出

- 部署回退只切换到上一已验证 OCI digest；数据库破坏性问题通过 PITR 创建新实例并受控切换，不在原实例上反向覆盖。
- WAF/CloudFront 变更先保留前一配置，使用低 TTL 和 count/canary 验证；误杀或 5xx/延迟/支付失败越线时恢复前一分发/规则/origin。
- 供应商迁移以 OCI 镜像、标准 PostgreSQL migration/逻辑复制或 dump/restore、对象 `key + checksum + version` 清单和 CDN 双写/预热为边界；KMS ciphertext 必须通过受审计的解密-重加密流程迁移，不能复制主密钥。
- 迁往 Akamai 或其他云时先并行构建新 origin/edge，校验数据与对象 checksum，降低 DNS TTL，小流量切换并保留 AWS 回切窗口；完成验证后再撤销旧 secret/role 和清理资源。
