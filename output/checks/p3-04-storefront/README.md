# P3-04 — 公开首页与艺人浏览

入口：`docs/operations/storefront.md`；执行/验收状态以 `docs/progress/phase-3-storefront.md` 为准。基线 `fc6e28e6a6ec8ef7cd3316ef901c7e104c1bb1d6`，开发分支 `codex/p3-04-artist-storefront`；本轮按用户要求只本地提交，不推送远端。

## 实现与兼容

- Next 七语言公共路由、站名配置、导航/语言切换、SSR 首页、连续艺人目录、搜索建议与稳定 ID 定位、艺人详情，沿用已批准 V2 黑金视觉。
- 新 homepage 聚合读取经 Route → Application → Content → Port → PostgreSQL，单个 SERIALIZABLE 事务加载当前发布首页及明确引用的稳定 ID；必需 Hero 失败封闭，其他失效推荐显式不可用。
- 新增 3 个 schema roots，共 373；旧 370 个逐项深比较保持原样。没有新增迁移，数据库仍为 20 迁移 / 153 表。
- 响应式图片只读取已发布 READY 衍生物；手机独立构图按实际比例占位，候选不超原宽，错误占位稳定。精确 HTTPS origin、路径/格式/重定向限制见 `image-README.md`。
- 英文源与请求界面译文必须分别通过 production 审核和实际 hash 检查；七份清单保留 DRAFT，不伪造人工批准。
- 修复真实目录集成暴露的事件时间边界：稳定事务/必要授权/前序历史确定事件时间，实时会话/MFA/权限/到期和 SQL 约束原样保留。

## 可重复检查

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/storefront test
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:storefront
mise exec node@24.20.0 -- corepack pnpm verify:storefront:browser
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test:postgres:admin-catalog
mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs
mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs
mise exec node@24.20.0 -- corepack pnpm check
mise exec node@24.20.0 -- corepack pnpm security:secrets
git diff --check
```

默认 storefront 协议集成已纳入根 `test:postgres` / `check`；浏览器集成单独运行，不以单元测试代替实浏览器。目录时间专测也纳入正常 PostgreSQL 集成。

## 审阅入口

- `directory-README.md`：分页、搜索、IME、竞态、定位及键盘模型。
- `image-README.md`：真实尺寸、精确来源限制及缓存撤回边界。
- `copy-review-README.md`：英文源/请求译文的 production 审核门。
- `design-font-route-README.md`：保留旧字体门，新增精确 public profile/locale 检查。
- `final-independent-frontend-review.md`、`read-integration-review.md`：非作者接线、合同、图片、配置及静态门复核。
- `catalog-time-independent-review.md`：时间修复非作者复核；新专测 10 断言，原管理目录 258 断言。
- `contracts-artifact-cost-README.md`：并行执行时出现的 5 秒测试超时与孤立 314 测试成功证据。测试预算未调整，旧合同比较未削弱。
- `output/playwright/p3-04-storefront/`：真实 TEST 数据、媒体字节、双端七语言截图与交互原始记录。

保留的失败记录及其完整程度见下文，不能把后续成功重跑解释为先前未测得的根因。首轮 Next 空 500 的确切根因未捕获；素材通道/初始状态/政策生效时刻和浏览器 effect 等待问题按真实合同修正夹具。自然 `CATALOG_SESSION_TIME` 错误与受控时间越界共用 guard，受控探针精确证明八个会话谓词为真、仅事件上界失败；不声称记录到了自然故障瞬间的墙钟回拨。

- 首次独立协议运行出现政策 preflight 可发布、VALIDATE 拒绝的结果，但未捕获具体 issue。后续只补充严格 schema 解析后的 issue code/path 诊断，没有改政策发布判断；第二次完整协议通过。`protocol-first.log` 仅是工具记录摘录，原始完整日志被覆盖，不能称为完整失败日志。
- 首次 P2-05 浏览器回归在并行夹具运行时未达到既有 30 fps 下限；串行重跑通过，未修改下限或等待预算。没有测量证据确认其具体成因，记录在 `p2-05-browser-first.log` 与 `p2-05-browser.log`。
- 首次全仓检查拒绝手写的七语言聚合对象。改为从合同唯一语言清单构造，审核记录与 fixture 的实际导出值逐项完全相同，未给检查器增加豁免；见 `check-first.log`、`copy-review-migration-README.md` 及 copy 等值记录。

## 范围

本轮只有本地 TEST 身份/媒体和编译产物证据，未发布正式站点。120 个 TEST 艺人共用两组原创双端照片用于规模测试；低像素原图保留像素嵌入中性画布，没有冒充新摄影分辨率。正式品牌/摄影授权、人工译审、公开市场配置、PSP、真实支付转交、云 CDN、staging/生产和新的物理手机验证均不属于本轮完成结论。

P3-05 礼物分页/筛选/详情/政策及 P3-06 SEO/重定向/正式运营与性能门继续保留。动画精修按用户要求后续进行。当前主页没有市场时不显示猜测价格，交易预留页面不提供假下单。

## 最终验收（2026-09-07T00:16:55.385949+00:00）

P3-04 本地验收通过。实现输入 **1374** 项在最终门前后逐项一致，SHA256 `49fd55e1470ce9ca5e16f5fb82cde578580f8e50bbb06237b365778e1b094d5d`。`validation.json` 记录命令、结果、缓存与未覆盖范围；S.U.P.E.R 十项 PASS，非作者复核 ACCEPT。

本次全仓门禁采用**分段验证**，不声称最后一次 `pnpm check` 整条命令 exit0：`check.log` 已通过工作区/设计/依赖/运行时/合同、全部 PostgreSQL/HTTP、S3 与媒体恢复423断言及格式检查，随后在 output 中一次性迁移证明脚本的 `URL` lint 报错。仅该辅助脚本改为 `globalThis.URL`，8项迁移证明重新通过；1374项实现输入没有改变。随后执行 `package.json scripts.check` 从 `prettier --check` 开始的**原样完整后缀**，见 `check-resume-command.txt`，最终 exit0。typecheck58/58（58 cached）、test58/58（56 cached）、build35/35（30 cached）、31 package出口实际Node import通过；secrets、显式扫描被忽略的本轮日志、diff及源码/历史产物检查通过。

第一次后缀执行中的合同生成测试再次超过既有5000ms，保留 `check-resume-first.log`。同一代码的合同314测试通过独立Turbo执行（0 cached，2.51秒）；最后后缀复用了该验证缓存。未修改测试、生成器、超时或断言，也没有宣称并行波动已修复。只读复核确认首测计时包含动态导入初始化，未发现正确性缺陷；初始化移动到模块作用域作为后续稳定性候选，不把聚合transform数据当作失败热路径测量。

- 新协议在最终全仓门中再次通过：**15,221断言 /5,006 setup请求 /120艺人**，真实PG/API/TLS S3/worker；当前发布head、改handle、暂停和归档实际验证。
- 最终UI：七语言双端**51截图 /59案例 /48重排 /10 axe零violations /81图片候选真实解码 /0浏览器未处理错误**。198个轨道外contrast incomplete保留原始targets并人工复核；不声称自动zero-incomplete。截图摘要见 `output/playwright/p3-04-storefront/screenshots.sha256`。
- 手机Hero按实际独立源图比例占位，390宽下487.5高，完整头脸；目录标题层级已修。七语言不存在艺人的真实HTTP404也已验证，避免共同祖先loading造成已流出200。
- P2-04与P2-05共享浏览器回归通过，截图hash逐项复核。69项界面key、七份DRAFT审核清单保持一致，canonical locale整理没有改变实际文案/审核记录或放宽门禁。
- 本轮日志按仓库扫描规则仅保留本地、不纳入Git；可复验脚本、结构化结果和截图纳入检查点。一次性文案生成脚本不作为交付。261项此前未跟踪产物逐项未变且不暂存。

下一入口 P3-05 READY：礼物分页、筛选、价格排序、URL恢复、七语言详情、选择艺人与政策。虚拟/实体/心愿/周边等类型继续与库存策略独立，由真实商品数据驱动；正式SEO与性能/运营门在P3-06。

归档说明：仓库扫描策略禁止跟踪被忽略的生成日志。首次暂存127份日志被该策略拒绝后，只撤销了本轮日志的暂存，未改规则、未删改日志。日志仅在本地保留，另经显式secretlint扫描；提交包含源码、文档、结构化证据和截图，完整暂存区diff检查通过。
