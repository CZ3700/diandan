# P3-02 管理后台传输与真实浏览器验证

当前：完整 UI 验证通过（1003 断言、306 次 setup API 请求）；本文件不是整个 P3-02 的完成声明。

## 可重复命令

从仓库根目录执行，使用锁定 Node 24.20.0。先构建依赖，再运行受控环境：

```sh
mise exec node@24.20.0 -- corepack pnpm exec turbo build --filter=@fan-support/api... --filter=@fan-support/worker... --filter=@fan-support/i18n...
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api exec node ./scripts/admin-workspace-http.mjs
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api exec node ./scripts/admin-workspace-http.mjs --ui
```

默认执行实际 PostgreSQL、API、TLS S3、图片处理 worker、内容审核/发布与当前权限验证，以及真正 Chrome 对 Next 同源 BFF 的 Cookie/CSRF、分页、搜索、翻译导出与跨域上传。默认不写截图。`--ui` 额外执行七语言的 1440×900 / 390×844 布局、实际编辑保存、独立审核、源变化矩阵和私有图片预览，截图写入 `output/playwright/p3-02-admin/`。`--serve` 仅供受控本地人工预览，启动独立编辑者 Chrome 窗口；不代表完整按钮验收。普通浏览器打开相同 URL 没有测试会话，显示会话提示。

脚本只删除自己创建的 PostgreSQL/S3 容器与临时目录，正常关闭 API 池、worker、Next 和独立 Chrome。Node 信任该次临时 CA，实际签名 PUT 和服务端 GET 经过 TLS；Chrome 只为该次临时证书的 SPKI 精确放行，不使用全局 `ignoreHTTPSErrors`。对象存储只向当前随机 localhost origin 开放源桶 PUT 与派生桶 GET/HEAD。不是云对象存储、公开证书或生产 CDN 的验收。

## 实际链路与隐私边界

所有业务素材由正常 API 产生：原创建图 → TLS 签名 PUT → 实际图片检查 → SOURCE 登记 → 独立版权确认与七语言 metadata 审核 → 真实处理 worker → MASTER/DERIVATIVE → metadata 发布。艺人引用三种构图，首页引用实际 Hero，目录另含多页艺人草稿。初始数据库仅通过正常约束准备隔离测试身份和权限，没有伪造已发布媒体证明。

HttpOnly、Secure、SameSite=Strict 的两个 `__Host-` Cookie 在真正 localhost Chrome 中验证。session bootstrap 只返回当前 actor ID、允许列举的权限、locale scopes 和供客户端内存使用的 CSRF；没有登录/任意身份签发入口。BFF 只接受固定 operation，严格校验当前站点 Origin、Cookie/CSRF、请求/响应合同和限额，再向固定内部 API origin 转发。后端每次重新验证真实 session/MFA/RBAC/locale，bootstrap 结果不构成后续授权。

凭证、签名 URL 与原始请求不写日志、HTML、RSC、URL query、localStorage 或 sessionStorage。Playwright 不启用 trace/HAR/视频；失败诊断只保存操作名、HTTP 状态、安全错误枚举和行号。截图只含原创合成图片与非用户文本。最终 PASS 中的 `setup API requests` 只计脚本直接调用，不包含浏览器额外 BFF 请求。

## 验证与修复证据

- 新 session 合同、App、PG、API 与 BFF/config 的初始 RED/GREEN 日志均在本目录 `transport-*`。
- 最终默认协议：`transport-http-protocol-final.log`，957 个断言、306 次 setup API 请求；默认模式未写入截图。
- 最终完整 UI：`transport-http-ui-semantics-final.log`，1003 个断言、306 次 setup API 请求。包含 14 个七语言双视口截图，加 editor / preview / source-changed 三张稳定流程截图，以及 en-reviewer.png 一张审核成功后刷新加载中状态截图（该图不是稳定审核矩阵，审核成功与矩阵行为以实际 HTTP 和浏览器断言为依据）；真实三张 blob 图片解码、dirty 离开取消、保存后字段读回、提交和独立审核、英文变化后六种 STALE 均通过。 `accessibility.json` 另记录目录、编辑器、preview 三个完整页面 axe 4.13.0：违规和 incomplete 均为零。先前编辑器的 `aria-prohibited-attr`（目标 `.admin-locale-matrix`）在补正确命名分组语义后消失；本次同时断言真实 `role=group` 和该 incomplete 不再出现，自动扫描范围不等于完整 WCAG 认证；5 个目标通过 Tab 到达且 3px 可见焦点，Enter 完成搜索、打开记录与预览、结束预览。葡语目录及英文编辑器/preview 的 320 CSS px 检查、三个页面的 720×450 重排均无横向溢出。后者是将 1440×900 CSS 视口减半的等效 200% reflow，不是原生浏览器缩放。身份表单同时修改 handle 与 acceptingGifts、仅提交 handle 后，真实刷新保留未提交的 checkbox。
- 初始真实协议：`transport-http-seventh.log`，945 个断言，303 次 setup API 请求；后续增加当前 session 的 locale/permission 撤销与恢复。
- Next dev 本地 TS 导入解析：`transport-next-import-red.log`。修复为 Next 所用本地 extensionless imports，没有更改公共 ESM 包输出。
- 真实预览 API 三张 AVAILABLE、浏览器无图片：`transport-http-ui-third.log`。测试环境派生桶缺少读取 CORS，补当前 origin GET/HEAD；第四轮真实三张 blob 图片解码通过。
- 独立构造边界评审：`transport-construction-review-red.log` / `transport-app-construction-red.log`。非字符串 pepper 在获取池前拒绝；缺 transaction capability 在构造时拒绝；获取池后构造失败关闭一次。`transport-construction-review-green.log` 5 tests、`transport-app-construction-green.log` 4 tests。
- `transport-final-*-unit.log` 记录最后一批各层定向回归；API 最后 13 tests；Application 构造修复后 4 tests。其余合同 3、PG 4、BFF 6、config 4，共 34 个相关定向测试通过。`transport-lint-final.log` 无违规；App/API/PG typecheck 通过，admin 当次 typecheck 的新增媒体模块缺文件由 UI owner 单独收口。

## 限制

管理页面使用显式 TEST + development 的 Next dev 与 loopback 内部 API。默认 DISABLED；本轮没有生产登录、OIDC、角色切换、真实人类译文审核、正式素材、云 CDN、PSP、staging 或远端 CI 的结论。正式 `next build` 与全仓 `pnpm check` 由最终总验证单独记录；本轮无 push。
