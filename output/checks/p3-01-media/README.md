# P3-01 检查点 2B：真实图片处理

日期：2026-09-05。范围：本地媒体处理子检查点；P3-01 仍为 IN_PROGRESS，内容存储、受权编辑和发布链路继续在原任务内实施。

## 实际实现

已接通 PostgreSQL 持久任务 → Application → 图片 adapter → TLS S3-compatible → 原子结果写回，以及生产 worker 的组合、启动与关闭。输入为已登记的私有原图和 metadata revision，不提供无鉴权上传入口。

- 校验真实 MIME、字节长度、SHA256、编码尺寸和解码像素数；支持静态 JPEG/PNG/WebP/AVIF，拒绝损坏、多帧、超限及低像素输入。
- 校正全部 8 种 EXIF 方向，清理 EXIF/GPS/XMP/IPTC/ICC 等元数据，转换 sRGB，再执行焦点 COVER 或中性背景 CONTAIN。像素不拉伸、不放大。
- 为人物卡、桌面 Hero、手机 Hero、礼物主图生成对应 PNG master，以及 3 种格式 × 4 个宽度的 12 张响应式图片。实际前台 picture/srcset 接入仍在后续业务页任务。
- SOURCE 和 PROCESSED_MASTER 分别按 checksum 去重，保留原图字段及审核状态；不同 master 的同字节变体采用 master checksum 作用域。理由、迁移与回退边界见 ADR-010。
- 同一个任务的 master、12 个变体、尝试结果和成功状态在一个短事务提交。网络/编码在事务外；领取采用 SKIP LOCKED 和租约隔离，最多六次尝试，失败有退避和持久状态。已上传但尚未登记的对象可以被后续重试复用。
- 新主图版权为 PENDING，不创建或继承批准的 metadata，不自动发布，也不进入现有支付 outbox consumer。

## 验证入口与证据

统一环境：`mise exec node@24.20.0 -- corepack pnpm ...`。详细最终退出码、统计与源码指纹以 `validation.json`、`implementation-source.json` 为准。

| 检查 | 入口/日志 | 覆盖 |
|:--|:--|:--|
| 受影响单元测试 | `targeted-tests-final.log` | 10 个 package/app，783 tests |
| 图片 adapter | `adapter-final.log` | 39 tests，8 EXIF 方向、四格式、焦点/背景、元数据清理、损坏/截断、分帧与请求/总时限 |
| 真实 PostgreSQL | `pnpm --filter @fan-support/persistence-postgres test:postgres:media`；`postgres-identity-kind-final.log` | 136 断言；并发领取、真实过期、六次终止、完整提交/回滚、分类型去重、不可变历史、旧数据 up/down/up |
| 真实 PG + TLS S3 | `pnpm --filter @fan-support/worker test:media-processing`；`worker-integration-final.log` | 423 固定断言；正常/存储重试/DB 恢复/同字节 PNG/过期恢复共 5 个任务，最终尝试次数 1/2/1/1/2 |
| 字节独立校验 | 同上 | 4 组共 52 个实际存储对象，重新下载、解码并核对尺寸/格式/SHA256/长度/元数据；PNG 像素验证真实旋转和中性背景 |
| 迁移 catalog | `migration-catalog-final.log` | 12 个迁移、112 表的完整 up/down/up |
| 既有目录回归 | `catalog-regression-green.log` | 120 艺人/120 礼物/七语言，287 断言；最新媒体迁移下仍保持目录与旧译文不可变 |
| 浏览器 | `p2-04-browser.log`、`p2-05-browser.log` | 16+8 场景、18+22 PNG、10+3 axe；critical/serious 为 0，双基准视口、键盘、reduced-motion、长文案及原生 200% zoom |
| 完整仓库门禁 | `pnpm check`；`check.log` | exit 0；含上述新集成、旧 PG/HTTP/S3、合同、format/lint/typecheck/test/build 和架构检查 |
| 凭据与改动检查 | `pnpm security:secrets`、`git diff --check` | exit 0；详细记录见 validation |

完整 check 的 typecheck 56/56（53 cached）、test 56/56（27 cached）、build 35/35（28 cached）通过。该运行再次执行联合验证，423 断言通过，实际尝试次数为 2/2/1/1/2；普通任务一次临时存储失败也被有限重试恢复。上述表中的 1/2/1/1/2 是独立专项运行结果，不混写两次观测。

PostgreSQL 独立 harness 使用合成产物元数据检验约束；真实字节结论来自联合 harness，不混为同一证据。全部实体、原图和内容均为临时虚构 fixture，临时数据库/对象存储在测试结束后清理。

新增 14 个内部 schemaVersion 1 根定义；之前 184 个生成定义深比较不变，当前共 198 个。新增合同没有伪装成可调用的上传/管理 HTTP operation。

## 发现与修复

所有新行为先保留 RED，再实现与复验：`contracts-red.log`、`registry-red.log`、`content-red.log`、`adapter-red.log`、`postgres-unit-red.log`、`tdd-application-red.log`、`tdd-worker-red.log`、`tdd-composition-red.log`、`transaction-red.log`、`lifecycle-red.log`、`production-worker-red.log`。

- `variant-scope-red.log`：不同角色 master 的小图可能同字节；变体键增加主图作用域，保留旧 object key 唯一约束。
- `postgres-identity-kind-red.log`：符合目标规格的 PNG 可以与主图完全同字节；采用 SOURCE/PROCESSED_MASTER 独立不可变身份，原图与批准不被改写。
- `postgres-boundary-red.log`：savepoint 边界失败必须使外层事务不可提交，沿用 typed transaction failure 和 trackOperation，不伪造业务错误。
- `adapter-deadline-red.log`：总预算耗尽后不得再启动请求；`adapter-truncated-red.log`：严格拒绝会触发解码 warning 的损坏图，正常四格式仍通过。
- 联合 harness 初始失败包含中途迁移指纹/构建状态和测试自身的抢先过期任务占用 worker。最终固定源码与迁移后，先完成存储/数据库恢复，再独立领取过期场景；用 PostgreSQL 的真实时钟等待，不改小生产租约或篡改已记录的租约时间。
- `check-initial.log`：旧目录回退测试仍确认 0011 为最新 head，被正确拦截。现在显式回退没有加工历史的 0012，再验证 0011/0010，并回到当前 schema；数据库保护没有被绕过。

独立非作者对图片之外的 DDL/repository/Application、共享合同/receipt 校验及 worker 生命周期作了只读评审；同字节冲突修复后结论 ACCEPT。code-simplifier 仅收敛编码分支，保留 data/output/repository 和 transfer/pipeline/budget 的职责分离。

## 运维与下一入口

- 继续 `docs/plan/p3-01-content-runtime.md` 的 2B-内容存储：艺人别名、礼物结构化详情及专属七语言译文；随后受权上传/编辑、预览、独立审核和事务发布/回退/purge。
- 上传时须由可信字节登记 MIME/尺寸/checksum，并使用服务端分配的原图命名空间；不得占用 `processed/v1/`。公开前要验证原图授权撤销的 provenance、主图专属 metadata/七语言审核、桌面和手机 Hero 的独立原始来源。
- 自动重试已完成；终止任务的人工重试接口仍待实现，不能重置不可变历史。部分上传后无引用对象的回收需另行设计，避免删除共享文件。
- 联合测试验证 composition.stop 等待当前工作后关闭连接。现有真实进程 SIGTERM 上限仍为 10 秒，长任务可能被强退；这种情况依靠持久租约重领和不可变对象重用恢复，未宣称真实进程长任务一定完整 drain。
- 此次没有新的前台业务接入、手机验收、远端 CI、PSP、云存储/CDN、staging 或生产发布证据。当前黑金样板与历史手机材料保留原指纹。

图片库参数核对使用 [Sharp constructor](https://sharp.pixelplumbing.com/api-constructor/)、[operations](https://sharp.pixelplumbing.com/api-operation/) 和 [output](https://sharp.pixelplumbing.com/api-output/) 官方文档（2026-09-05）；功能结论以仓库锁定版本 0.35.4 的实际测试为准。
