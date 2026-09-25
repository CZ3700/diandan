# P4-04 最终独立证据复核

结论：**ACCEPT，仅限保留间歇失败记录的本地 TEST 检查点**。不是单条 `pnpm check` 全绿、真实 PSP 验收或生产发布批准。P4-04 保持 IN_PROGRESS，P4-05 保持 PENDING。

本次只读复核协调者的最终门禁汇总、日志、源码演变和原文件保护；未重新执行测试、构建、数据库或浏览器。API/浏览器结果与其原始产物核对，不称为另一轮独立运行。仅新增本报告。

## 原命令覆盖

- `package.json` 的根 `check` 与基线 `f1f702f` 字符串完全相同；原 `test:postgres` 整串保留，仅尾部追加 payment-runtime。将其展开后，38 个步骤与 `gate-coverage.json` 的命令列表逐项、按序完全一致，没有遗漏或替换。
- `check-full-2` 实际 exit 1。原顺序 `&&` 链已通过前缀以及 PG/API 至 publication-preflight；不能将其改写为完整成功。
- publication-runtime 的原前置构建 25/25 通过；之后未改动的实际 HTTP 子进程在 51.111674 秒完成 12,826 断言、1,462 请求并 exit 0。CLI preload 没有传入该子进程，日志仅有 scope 声明，没有授权查询诊断记录。因此只有合并构建与实际脚本的通过证据，不能宣称已定位或修复此前 403/CLAIM_WINDOW。
- `check-remainder-1` 前 13 个命令实际 exit 0，覆盖全部剩余 API、支付、TLS S3、format、lint、types；第 14 项测试因既有合同测试 5,169ms 超过原 5,000ms 失败。`check-quality-final-1` 同源码、同阈值的测试 60/60 和构建 35/35 通过，其后 adapter 声明边界确实失败。
- 最终 `check-quality-final-2` 在新冻结源码上完整运行原 7 项质量后缀，全部 exit 0：format、lint、types、test、build、adapter boundary、build artifacts。实际 33.909622 秒；原 adapter 检查通过，31 个包出口由 Node 成功导入。主日志 SHA 与各自 JSON 元数据一致。
- 已读 `resume-check.py`：它从原 package scripts 提取剩余命令，先核对输入 SHA，逐命令执行、首个非零即停止，不改超时/阈值、不覆盖已有日志。故接受分段原命令覆盖；`singleFullCheckPassed: false` 必须保留。

## 源码与证据对应

最终 `source-final.json`：1,979 项，SHA `88c0bbbac1a1299885cafc7f27dd8999f4197518e55e0fcb4dd8f13dd80ee744`，本次逐文件复核零漂移。

浏览器源 `5d43c607…` → `aa99ed94…` 仅一个 TEST 配置 seed 文件改为复用现有词库；新 seed 已经正常配置 PG 与后续真实支付 HTTP 验证，旧浏览器截图的支付方式文案不冒称新 seed 复验。

`aa99ed94…` → 最终 `88c0bbba…` 精确只有 PG `index.ts` 与 `index.test.ts`，无新增/删除文件。删除本轮新增、无人从包外使用的私有 repository factory 导出，并补负例；当前 `index.ts` 恢复基线字节。正式 `postgres-persistence.ts` 仍通过内部相对 import 创建 repository 并提供 transaction manager。业务实现、SQL、UI 不变；公共入口构建字节改变，由最终全部消费者类型/测试/构建和原边界门验证，不能声称所有产物字节未变。

最终浏览器原始结果仍是 14 正常流程 + 14 空态 + 2 键盘 + 1 保留订单语言的导航，共 31 cases、71 PNG、57 axe，零 violation/incomplete/pageErrors。部分全页截图保留滚动中的 sticky 位置，不都是默认页面顶部布局。原 P2 回归自身的 moderate/incomplete/physical-device 边界与这 57 次扫描分开记录。

## 保护与状态

本次直接读取当前文件并与原始记录/基线比较：2,349 个既有未跟踪文件无变化或缺失；0001–0025 共 50 个旧 SQL 字节不变；JSON Schema 原 502 根、OpenAPI 原 87 路径和 161 个公开 components 均结构不变。当前总量为 539 根、92 路径、171 components。

已复读更新后的 `final-verification.md`、`root-review.md`、MASTER 和 Phase 4 最终执行卡。最终口径与 `gate-coverage.json` 一致：25 DONE / 2 IN_PROGRESS / 22 PENDING，共 49；本地提交，无 push、merge 或部署。

保留风险明确且没有被绿色复验抹去：此前 publication 授权/CLAIM_WINDOW 的具体原因未定位；合同测试原超时没有被证明根治；独立持久 TEST PSP 不是获批真实 PSP sandbox 或小额收款；P4-05 金融最终状态、生产服务、真实设备/读屏、正式译审及 P3-06 未完成的性能与人工门仍未获得本轮批准。未发现需要阻止上述精确本地检查点结论的新问题。
