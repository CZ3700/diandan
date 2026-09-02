# Fan Support Platform

这是全球偶像礼物应援平台的源码单仓库。当前里程碑是可重复的本地运行基线：Storefront、Admin、API、Worker、PostgreSQL 和 S3-compatible 对象存储可在 Docker preview 中启动。产品范围、安全边界和当前任务以 `docs/FAN_SUPPORT_PLATFORM_SPEC.md` 与 `docs/progress/MASTER.md` 为准。

## 前置条件

- Node.js 24.20.0（建议由 `mise` 选择）
- pnpm 11.25.0（通过 Corepack 运行）
- Docker Desktop 或兼容的 Docker Engine，支持 Docker Compose
- OpenSSL，用于 preview launcher 生成临时本地 CA 和服务器证书

仓库通过 `.node-version`、`package.json` 和 lockfile 锁定工具版本。命令示例一律显式使用 Node 24，避免本机默认 Node 造成不可重现差异。

## 安装与本地门禁

```bash
mise exec node@24.20.0 -- corepack pnpm install --frozen-lockfile
mise exec node@24.20.0 -- corepack pnpm check
mise exec node@24.20.0 -- corepack pnpm security:secrets
mise exec node@24.20.0 -- corepack pnpm audit --registry=https://registry.npmjs.org --audit-level=high
```

`--frozen-lockfile` 失败时不要删除 lockfile 或改用非锁定安装；先确认 Node/pnpm 版本和当前分支。`pnpm check` 依次检查 workspace、CI、runtime、observability、format、lint、typecheck、test、build 和构建产物。

## 启动 preview

```bash
mise exec node@24.20.0 -- corepack pnpm preview:config
mise exec node@24.20.0 -- corepack pnpm preview:up
mise exec node@24.20.0 -- corepack pnpm preview:verify
```

`preview:up` 会生成短期本地 TLS 材料和随机 preview 凭据，串行构建四个 OCI 镜像，启动七个容器并等待 healthcheck。不要把本地随机凭据复制到 `.env`、日志、issue 或截图中。

启动后可访问：

- Storefront：<https://localhost:3443/>
- Admin：<https://localhost:3444/>
- API health：<http://localhost:3002/healthz>
- Worker health：<http://localhost:3003/healthz>

本地 CA 不会自动写入系统信任库。`preview:verify` 使用实际 CA 验证 HTTPS；API 和 Worker 容器通过 `NODE_EXTRA_CA_CERTS` 信任同一 CA。禁止使用 `curl -k`、`--insecure` 或 `NODE_TLS_REJECT_UNAUTHORIZED=0` 绕过 TLS 校验；如遇证书问题，应重新执行 launcher 或修复 CA 挂载。

## Request / trace 排障

应用只输出字段 allowlist 约束的单行 JSON 日志。`x-request-id` 是请求关联标识，`traceparent` 是 W3C trace context；两者都只用于可观测关联，不参与认证、授权、幂等或业务状态。

排障顺序：

1. 运行 `preview:verify`，先确认四应用、PostgreSQL、TLS 对象存储和 Storefront→API 诊断链路可用。
2. 仅使用脱敏日志命令查看应用输出：

   ```bash
   mise exec node@24.20.0 -- corepack pnpm preview:logs
   ```

3. 按 JSON 字段 `requestId` 找到 Storefront 和 API 记录，再比对 `traceId`。若 request ID 一致但 trace ID 不一致，检查 `traceparent` 传播；若两者都缺失，检查 Next instrumentation 和 Fastify hook 是否在服务监听前完成初始化。
4. Storefront 诊断链路使用配置注入的 `FAN_SUPPORT_INTERNAL_API_ORIGIN`；不要在源码中改写容器主机名。该诊断端点在非本地/preview 环境返回 404。Next.js 会把字面下划线目录当作 Next.js private folder，因此文件系统路径必须是 `apps/storefront/src/app/%5Finternal/observability/route.ts`，对外 URL 仍是 `/_internal/observability`。

日志禁止包含完整邮箱、留言、显示名、Cookie、Authorization、查单 token、密钥、偶像地址、raw payment/provider payload、完整 URL query 或原始 error/stack。不要直接运行未脱敏的容器日志命令；`preview:logs` 是本地 preview 唯一文档化的日志入口。

## 常见故障

| 现象                          | 检查与处理                                                                                                                                    |
| :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_PNPM_UNSUPPORTED_ENGINE` | 确认正在使用 Node.js 24.20.0 和 pnpm 11.25.0，然后重跑 frozen install。                                                                       |
| `CONFIG_INVALID`              | 对照 `.env.example` 检查运行时必填项。Preview 凭据应由 launcher 注入，不应手工固定。                                                          |
| Docker 构建被终止             | 确认 Docker 可用内存不低于当前 4 GiB 基线；preview launcher 已将构建并发设为 1。                                                              |
| 端口占用                      | 检查 3443、3444、3002、3003、7443 和 54320，停止冲突进程后重跑 `preview:up`。                                                                 |
| HTTPS 或 S3 TLS 失败          | 先执行 `preview:down`，再用 `preview:up` 生成新的临时 CA；检查 clients/edge 挂载和 `NODE_EXTRA_CA_CERTS`，不要关闭校验。                      |
| 容器不 healthy                | 先跑 `preview:verify`，再通过 `preview:logs` 查看脱敏的 `runtime.start_failed`、`http.request.failed` 或配置错误代码。                        |
| 进程无法优雅关闭              | Docker 会先发送 `SIGTERM`；应用必须停止接收新请求、关闭 Nest/Next runtime，并等待 OpenTelemetry `shutdown` 完成。只有超时后才应进入强制终止。 |

## 停止 preview

```bash
mise exec node@24.20.0 -- corepack pnpm preview:down
```

`preview:down` 会停止容器并删除 launcher 管理的临时 TLS 目录。不要手工递归删除不确定的路径。

## 证据范围

上述结果只是本机 Docker preview 和代码门禁证据，不等于已接入 cloud exporter、错误监控、dashboard 或告警，也不是 staging 验收、production 部署、备份恢复、多架构镜像或正式发布证据。观测、告警和备份供应商仍需通过后续 ADR/决策门确认。
