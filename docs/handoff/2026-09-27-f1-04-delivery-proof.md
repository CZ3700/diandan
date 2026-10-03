# 交接：F1-4 送达证明照片完成（F1 全部完成）→ 下一步先请用户确认开草稿 PR 跑 CI

> 日期：2026-09-27
> 项目：`C:\Users\admin\Desktop\下单\下单`
> 分支：`v2/r1-production`（已推送 origin，工作区干净）
> 新会话冷启动顺序：
> 1. 本文件；
> 2. `docs/handoff/2026-09-26-core-features-first.md`：核心功能的范围与顺序（已获批准）；
> 3. `docs/progress/v2-progress.md` 的"R2 站点核心功能"一节；
> 4. 进入 F2 前读 `docs/decisions/018-leaderboards-guild-results.md`。

## 背景

用户 2026-09-26 批准站点核心功能按 F1→F2→F3 推进，沙盒与外部配置放到最后。F1-1 虚拟礼物自动履约、F1-2 订单公开短号、F1-3 首页四分类与价格直显已在之前的会话完成。本会话完成 F1-4 送达证明照片，**F1 至此全部完成**。设计文档：`docs/plan/f1-04-delivery-proof.md`。

按既定计划，F1 完成后要开草稿 PR，让 CI 跑一次 F1-1 到 F1-4 的 API 与浏览器级用例。**开 PR 前必须先问用户**（交接与记忆里都写明了）。

## 已完成

| 提交 | 内容 | 验证 |
|:--|:--|:--|
| `7d93b3b` | **F1-4a 后端**：迁移 0040 三张只追加表（上传预留、照片关联、撤回）及延迟校验；照片处理器与读取器（只写私有 source 桶）；后台五个动作；查单读模型与按会话授权的照片字节路由；本机真实 PG 脚本 | 合同、media-image（含 EXIF/GPS 去除实测）、application、persistence、api 单测；真实 PG：`postgres-delivery-proofs.mjs` 53 项、迁移往返与目录快照（40 个迁移）、回滚前缀守卫 59/59、查单 SQL 参数推断 19 条 |
| `54a803f` | **F1-4b 后台**：送达面板（隐私提示、0–3 张照片、隐私确认，先上传附加再送达）、已送达行补传、经理撤回、七语言文案；CI 脚本同步（送达要先确认面板；后台协议脚本实传照片） | admin 单测；lint/typecheck |
| `01da78c` | **F1-4c 前台**：同源 BFF 图片代理、查单页照片区（缩略图即对话框触发按钮）、七语言文案与审校哈希、WAF 路由（补 locate 与照片路径）、本地体验 CI 端到端（后台上传→粉丝查单页看到照片）、运维文档 | storefront、i18n 单测；本机浏览器验收见下 |

**最终单测计数**（`01da78c`）：contracts 544、media-image 76、application 657、persistence-postgres 788（另 1 个既有 Windows 符号链接跳过）、api 352、admin 226、storefront 828、i18n 63。

**本机浏览器验收**（`output/checks/f1-04/harness/`，不入库）：
- 方式：前台用**生产构建**（`next build` + `next start`），前面加本地 TLS 边缘 `tls-proxy.mjs`（和线上边缘一样覆盖 `x-forwarded-host/proto`），站点源为 `https://shop.example.invalid:4643`；假 API `fixture-server.mjs` 提供查单读取与照片字节。
- 结论：7 语言 × 390×844/1440×900 全部通过：
  - 两条实物行有照片区，虚拟行没有；缩略图全部解码；无横向溢出；零控制台错误；
  - 键盘 Tab 可达、焦点环可见，回车打开对话框，大图解码且在视口内，Esc 关闭后焦点回到缩略图；
  - 竖图（1200×1600）在两种视口都不越界；减少动态效果时弹层过渡 0s。

**门禁**：三次提交的 `check:dev` 前五段（workspace、boundaries、format、lint、typecheck）都通过；test 段只有与本次无关的既有 5 秒负载超时（F1-4a/b 是后台 `center.test.tsx`，F1-4c 是前台 `ui-interactions-specimen`、`ui-primitives-specimen`、`rum-bootstrap`、`rum-intake`）。每次都用 `turbo run test --concurrency=1` 串行复跑 69/69 通过，build 38/38 通过。

## 关键决策及理由

1. **照片只存私有 source 桶的 `fulfillment-proofs/v1/` 命名空间，不复用内容媒体管线的存储与任务表。** 原因：derivative 桶由 CloudFront 整桶公开读取；内容管线按 checksum 跨公私去重，角色与产物数量写死在 0012 触发器里，还要求 `content.media.*` 权限。只复用底层零件：`readSourceImageMetadata`、`decodeSourcePixels`（自动转正、丢弃全部元数据）、`createStorageTransfer`、预签条件 PUT。
2. **照片在 API 内同步处理**（每行至多 3 张，量小）：省掉任务表、租约与前端轮询。`ProcessingBudget` 新增总时限参数，照片处理总时限 25 秒，低于后台 BFF 的 30 秒超时；超时或抖动时预留保持 RESERVED，可用同一 uploadId 重试。
3. **上传/附加与"标记送达"解耦**：DELIVER 合同与履约触发器一行未改。附加只允许在 PREPARING/DELIVERED 的实物行上做，粉丝只在 DELIVERED 之后看到。后台面板顺序是上传→附加→送达，所以粉丝看到"已送达"时照片通常已经在了。已送达的行可以补传。
4. **照片可选**（附录原文是"可传 1–3 张"），不阻塞送达。
5. **经理撤回是对批准范围的补充**：误传他单照片或露出第三方信息时必须有补救手段。撤回只隐藏，不删除对象；保留期限属于隐私政策配置，列为后续。
6. **粉丝读取走 API 字节代理，不下发预签地址**：访问与查单会话绑定，URL 稳定，不暴露存储端点。每张图消耗一个 READ 限流单位，运维文档已注明 `readMax` 要把图片请求算进去。
7. **后台查看照片只开放给 `orders.fulfillment` 和 `orders.manage`**：照片可能拍到粉丝的留言卡，而后台读留言本身就需要专门权限。查看用按需签发、至多 300 秒的预签 GET。
8. **数据库层兜底**：三张新表都只追加；延迟触发器在提交时重验会话、MFA、权限、审计与操作回执；拒绝虚拟行；每行未撤回照片不超过 3 张；有照片时拒绝 0040 回滚。

## 在途

没有改到一半的代码。

**CI 首跑的风险点**（本机跑不了，都只能在 CI 验证）：
- F1-3 交接已记的两处：`apps/api/scripts/local-experience-browser.mjs:434`（F1-4c 加了一行 import，原 433）与 `apps/api/scripts/accessibility-flows.mjs:170`，在唯一 GLOBAL 市场夹具下仍在礼物详情页等待 `[data-market-choices]` 里的市场按钮。
- 本次新增或改动、从未实际运行过的 CI 脚本：
  - `admin-orders-protocol.mjs` 的 `verifyDeliveryProofUpload`：经 API、临时 S3 与处理器实传一张带 EXIF 的 JPEG，检查送达前粉丝看不到、送达后看得到、后台预签缩略图是无元数据的 WebP；
  - `admin-orders-runtime.mjs` 用 `context.s3` 构建照片存储端口（`admin-orders-http.mjs` 已把 s3 放进上下文）；
  - `local-experience-browser.mjs`：送达时 `setInputFiles` 上传照片并勾选隐私确认，然后在粉丝上下文打开查单页，检查缩略图与对话框大图都能解码；依赖该脚本已为后台源配置的 source 桶 CORS（PUT）；
  - `admin-orders-browser.mjs`、`accessibility-flows.mjs`：送达改为先打开面板再点 `[data-proof-submit="DELIVER"]`；无障碍脚本在面板打开时多做一次 axe 检查。
- F1-1 到 F1-4 的 API 与浏览器级用例都还没在 CI 跑过。

**既有问题未动**：`pnpm deploy` 缺 `@opentelemetry/core` 对等依赖；CI 有四组回归既有失败（见草稿 PR #13：quality、catalog、commerce、journey 失败，operations、security 通过）；并行负载下的慢测试超时（后台 `center.test.tsx`、前台 specimen/RUM 等）。

## 下一步（按优先级）

1. **先问用户：是否为 `v2/r1-production` 开草稿 PR 跑 CI。** 会消耗 Actions 分钟。
   - 先执行 `gh pr list --head v2/r1-production --state all`，确认本会话结束后有没有已经开过（截至写本文时没有）。
   - 建议 base 用 `v2/r0-foundation`：它是本分支的祖先（本分支领先 22 个提交），PR 差异只含 R1；`ci.yml` 的 `pull_request` 不限分支，照样触发。CI 结果可以和 PR #13 的既有失败逐组对照，分清哪些是新引入的。
   - 获准后执行：`gh pr create --draft --base v2/r0-foundation --head v2/r1-production --title "V2 R1：生产就绪与 F1 站点核心功能（CI 验证）" --body-file <正文文件>`；正文列出 F1-1 到 F1-4 与上面的风险点，结尾加规定的署名行。
   - 按实际失败修复，先处理上面列的风险点，再对照 #13 看既有失败有没有变化。
2. **F2 榜单与公会赛**：按 ADR-018 拆子里程碑，依次为合同与迁移、投影与冲销、API、前台页面、后台公会赛录入。每项开工前先在 `docs/plan/` 写设计。
3. **F1-4 的后续小项**（不阻塞）：
   - 送达邮件提及照片（要改快照函数与模板版本）；
   - 未附加上传的回收，撤回照片与订单照片的保留期限（随隐私政策的保留配置一起实现）；
   - 照片读取单独的限流桶（等有真实流量数据再定）；
   - 后台裁剪工具（本期只提示并要求确认）。
4. F1-3 留下的小项：规范 §5.1 桌面透明覆盖式页头、磁贴分类计数、唯一市场时礼物详情 JSON-LD 带 offer。

## 环境注意

- **查单页的本机浏览器验收必须用生产构建与 https 公网形态的源。** 查单 BFF 的 `paymentRuntimeOriginSchema` 拒绝所有 localhost 源；dev 模式下查单页 CSP（没有 `unsafe-eval`）会拦截开发脚本；`__Host-` cookie 不能设到 http 源。做法见 `output/checks/f1-04/harness/`：
  - `run-prod.sh build` 之后 `run-prod.sh` 启动 `next start`（4600）。启动时会提示 standalone 输出应改用 `node .next/standalone/server.js`，本机验收照常可用，可以忽略；
  - `tls-proxy.mjs` 在 4643 提供 `https://shop.example.invalid:4643`；
  - `fixture-server.mjs 4610 4611` 是假 API 与假媒体；
  - Chrome 启动参数 `--host-resolver-rules=MAP shop.example.invalid 127.0.0.1, MAP media.example.invalid 127.0.0.1`，浏览器上下文开 `ignoreHTTPSErrors`，证书是本机自签；
  - 验收脚本 `proofs.mjs`（`REDUCED=1` 模拟减少动态效果）与 `portrait.mjs`。
- **Python 在 Windows 上 `open(p, "w")` 默认写 CRLF。** 补丁脚本写文件一律加 `newline="\n"`；本会话进度表曾被写成 CRLF，已转回 LF。检查换行要用 Python 读字节，Git Bash 的 grep 会吞掉 `\r`。
- **PL/pgSQL 的 `IF` 条件里不能出现不带括号的 `CASE WHEN … THEN`**：解析器读到第一个 THEN 就截断条件，报"syntax error at end of input"。
- **`postgres-integration.mjs` 会把未知错误改写成"PostgreSQL migration integration failed"**，看不到原因。定位时把迁移按顶层语句切开，在临时库上逐条执行（本会话的临时脚本写在包的 `scripts/` 下，跑完即删）。
- **`withEphemeralPostgres` 会改写回调里抛出的错误**；新脚本 `postgres-delivery-proofs.mjs` 在回调内先输出安全字段（断言标签、PG 错误码、约束名、函数名）再抛出。
- jsonb 会重排对象键，比较读模型输出时用深比较，不要比较 JSON 字符串。
- 取各包准确测试数：`turbo run test --output-logs=full --filter=<包>...` 会从缓存回放日志，先去掉 ANSI 颜色码（`sed 's/\x1b\[[0-9;]*m//g'`）再 grep `Tests `，否则匹配不到。
- Bash 前台不能 `sleep`；用 `&` 起的后台进程可能残留，用 `netstat -ano | grep LISTEN` 找 PID，再 `taskkill //PID <pid> //T //F`。
- 上一份交接（`2026-09-26-f1-03-home-categories.md`）的环境注意仍然有效。
