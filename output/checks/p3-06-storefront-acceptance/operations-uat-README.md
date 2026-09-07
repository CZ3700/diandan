# P3-06 非开发运营 UAT 准备包

最新交接（2026-09-07 19:54 UTC / 北京9月8日03:54）：新run `operations-uat/run-2026-09-07T19-52-15.055Z-e0c4cf3e` 已READY并保留；指导页 http://127.0.0.1:59939，中文Admin http://localhost:59200/zh-CN，上限约北京时间04:52，身份会话可能略早到期。正常准备1796断言/581请求、只读Chrome双端smoke22断言通过，root实际查看双端首屏；材料hash一致、未创建待测礼物、计时0。见run内 `final-preparation-smoke.json`、四PNG和静态 `timing-at-handoff.json`；实时 `timing.json` 不随技术检查点提交，留给真实操作者追加。此为LOCAL TEST Admin dev环境，未以程序执行人工作业。到期后通过下列既有命令重新准备，旧URL不保证继续可用。

以下“两次已停止”段落记录此前两次准备历史，不指本次新run。

2026-09-07，`/root/storefront_read`。准备工具已通过两次真实本地 PG/S3/API/Admin/Chrome 准备 smoke；第二次包含改进后的中文材料分组。两次均未点击 START/FINISH，也未代做待测任务。**当前验证环境已停止，真人验收仍为 `PENDING_HUMAN_OPERATIONS_UAT`**。后续正式人工运行需重新执行准备入口，使用新运行卡及对应材料。

## 可重复准备入口

准备人先完成项目既有 API/Admin 依赖构建，避开 storefront 性能验收，再执行：

```sh
mise exec node@24.20.0 -- node apps/api/scripts/storefront-operations-uat.mjs --serve
```

默认不带参数或 `--help` 只打印说明。显式 `--serve` 才复用临时 PostgreSQL/S3 生命周期、正常迁移、真实媒体处理、API 和 Admin Next 开发服务器。约一小时 TEST 会话/运行窗口；结束按 Ctrl-C，只清理所拥有的进程和临时资源。需要与既有 Admin 验证相同的 Docker、Chrome 和运行时依赖。实际准备与受控退出证据见下文；退出码边界如实保留。

成功后输出真实 `LOCAL_OPERATIONS_UAT_READY http://127.0.0.1:<port>` 操作卡地址与 `LOCAL_OPERATIONS_UAT_OUTPUT <绝对路径>`。三个不同非持久 browser context 分别打开 editor、reviewer、manager，另一个无凭证窗口打开操作卡；按钮只切换已存在的角色窗口。只正常读取会话并核对当前权限，不改生产认证。

Admin 是 `http://localhost:<port>`，使用 Chrome localhost 的 Secure cookie 例外；只有对象存储走实际 TLS，浏览器仅信任本次 S3 证书精确 SPKI。合成 TEST 身份和数据库 MFA 标记不是生产身份源或真实 MFA 验收。凭证只在所属进程及各隔离 context 内存；不会输出 cookie、CSRF、预览 capability，也不保存 storageState、HAR、trace。

## 准备完成后的材料

入口只复用 `giftCommerceExtension.seed` 和 `.compositions`，不调用会预造商品的 `.prepare`。新增准备逻辑：

- 正常发布既有且未修改的旧首页基线；记录真实旧 publication/revision/hash、Luna Mira 当前草稿/发布 revision 和旧媒体 IDs。
- 通过现有正常 upload → source metadata/review → rights → worker → derived metadata/review/publication 创建四个替换 READY 资源：桌面、手机、portrait、礼物主图。**不会把替换图附加到待测首页或艺人**。
- 正常列表读断言没有任何预建礼物；通过真实 commerce context 选取已有 TEST GLOBAL/USD。材料提供待创建的唯一 handle/SKU、PHYSICAL 类型、独立的 PROCURE_ON_DEMAND 策略、一个规格、Luna Mira 资格、OTHER 分类、1 件物品、1–7 DAY 交付说明、10.00 USD 示例价。准备不创建 gift、variant、price 或库存。
- 七语示例字段可逐字段复制。这些是本地训练素材，不是正式翻译批准。新礼物只提供待录入字段，不造 variant ID；取得真实 Admin 导出包后才绑定实际 ID。

`materials.json` 含本次真实 IDs 和材料；`preparation.json` 记录其精确 SHA-256，并明确 `measuredGiftCreated:false`、`humanOperationsAcceptance:false`。每次新建独立运行目录，不覆盖旧尝试。文件只含安全 ID 和示例材料，不含凭据。

## 真人操作和计时边界

操作者须是接受过一次培训的真实非开发人员，使用匿名代号。独立审核人操作 reviewer 窗口；同一人切换角色不等于真实双人审核。开始前可阅读材料；**开始后不执行命令、代码、部署或让自动浏览器代操作**。

| 任务           | 开始后必须由人完成                                                                                      | 结束点                                 |
| -------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 3 分钟首页     | 编辑当前版本，选择新双端图、保存新版本，需要的审核和预览                                                | 实际看见双端预览中的更换结果           |
| 5 分钟艺人     | 当前草稿换 portrait，录入英文简介，正常导出、整理七语包、导入、审核及预览                               | 实际确认照片和七语简介                 |
| 8 分钟完整礼物 | 从创建开始，结构/类型/规格/艺人资格/英文/图片/七语导入/审核/地区价格/校验/预览/发布，所有 UI 录入均计时 | 正常发布成功，内容和商业参数符合操作卡 |

文件工具不是整商品导入器。仅接受当前英文与材料完全一致、固定七语顺序的 `translationTransferPackageSchema`，只修改 `entries[].text`，保留 target、revision、source hashes、package/export metadata。拒绝错误对象、不同英文、非唯一规格、无变化的同包整理。仍须在既有 Admin 导入，由真实 API 校验导出凭据、当前版本、权限与审核；不修改 hash 伪造批准。文件整理也计入 5/8 分钟任务。

## 证据边界

只有真人点击 START/FINISH 才计时，服务端用单调时钟。一时只允许一个 active attempt；重测追加保留旧记录。开始要求培训/非开发自述；结束记录 REPORTED_COMPLETE 或 BLOCKED、协助类型、UTC 起止、毫秒及是否在预算内。`timing.json` 串行原子写入；只允许已知 Admin 操作路径、HTTP 状态/outcome 和 UUID 回执字段，不收集原始请求/响应体、私密留言或显示名。

耗时合格的记录也始终是 `AWAITING_HUMAN_REVIEW`、`humanVerified:false`、`humanOperationsAcceptance:false`，程序不生成 PASS。独立见证者后续核对操作者/培训、协助情况、双端画面、真实 revision/publication 与参数、七语质量、真实审核分工。超时或无法完成应保留原失败作为 UX 差距，不能预建目标或自动操作充数。

既有 runner 的 `PASS ... preparation only ...` 只表示环境准备断言，不能当成人工通过；新入口明确打印 `PENDING_HUMAN_OPERATIONS_UAT`。本包不是生产或 staging 验收，正式 copy review、生产身份源和 CDN/基础设施仍有独立门。

## 本批检查

```sh
mise exec node@24.20.0 -- node --test apps/api/scripts/storefront-operations-uat*.test.mjs
mise exec node@24.20.0 -- corepack pnpm exec prettier --check 'apps/api/scripts/storefront-operations-uat*.mjs'
mise exec node@24.20.0 -- corepack pnpm exec eslint 'apps/api/scripts/storefront-operations-uat*.mjs'
mise exec node@24.20.0 -- node apps/api/scripts/storefront-operations-uat.mjs --help
```

初始 RED：`operations-uat-red.log`、`operations-uat-control-red.log`、`operations-uat-fixtures-red.log`。初始结果：`operations-uat-tests.log`、`operations-uat-format-check.log`、`operations-uat-lint.log`、`operations-uat-help.log`。这一初始检查阶段仅使用虚拟时钟和轻量 loopback HTTP，未启动 Admin/PG/S3；后续经 root 明确授权才执行下列真实准备 smoke。这些检查都不是真人计时。

## 操作卡顺序核对补充

实际 Admin 的“保存新版本”内部执行复制；“发布”控件内部执行所需验证，没有独立复制/验证按钮。新 gift 先保存唯一规格，再编辑类型/图文，避免未保存内容禁用规格操作；整体 gift 在首次发布前不能手动启用，首次成功发布会自动启用。价格在真实价格簿核对，内容预览不含价格。以上只修正操作卡文案，不改变业务门禁或自动化行为。新增对应 RED→GREEN 回归后共8项轻量测试；证据 operations-uat-instructions-{red,green,format,lint}.log。给真人的简短说明是 operations-uat-training.md。

## 真实准备与材料展示 smoke

首次运行 `operations-uat/run-2026-09-07T11-20-42.459Z-a3ec0e5e` 正常完成 1,796 个准备断言与 581 个 setup API 请求。真实打开三个隔离角色 context，材料 hash 匹配、没有预建礼物、计时为空。日志为 `operations-uat-smoke-first.log`，运行目录保留初始 smoke 和双尺寸截图。root 实际查看后指出原材料 JSON 平铺不便于非开发者查找，随后停止该环境，改进指导页。

材料展示只新增一个纯投影 helper 和对应测试，默认按“替换素材”“艺人英文”“礼物英文与规格／价格”显示中文标签与复制按钮。完整原始材料及 audit 字段移入默认收起的详情，保留原 JSON 下载。七语文件工具、原材料结构/hash、绑定与计时行为不变。新增测试先 RED 后 GREEN；当前共 9 项轻量测试通过，格式和 lint 通过，见 `operations-uat-material-view-{red,green,format,lint}.log`。

第二次运行 `operations-uat/run-2026-09-07T11-29-29.609Z-bb1a716f` 同样完成 1,796 个准备断言与 581 个 setup API 请求，实际打开角色窗口与操作卡。`operations-uat-smoke-second.log` 保留 READY 与准备断言结果。该运行目录中：

- `smoke.json`：1440×900 与 390×844 均 HTTP 200，三个分组、34 个复制按钮、raw 默认收起、无水平溢出，浏览器 page error 为 0。材料 SHA-256 与准备证明一致，七语材料和四种实际 READY 替换素材齐备，无预建 gift，attempts 为 0。
- 八张截图：`control-{desktop,mobile}.png` 与 `materials-{media,idol,gift}-{desktop,mobile}.png`。root 另在真实 Chrome 查看分组锚点及截图；没有点击计时或执行业务变更。
- `input-fingerprint.json`：记录 READY 后、受控停止前的 8 个 UAT 运行模块 SHA-256；聚合为 `72f9964ba98230b44697eab3340da49104e77a594ca3ab6b1c37f970aef6bd98`。材料 SHA-256 为 `e6199f40983dc9f6ef71bb7b363538fb190494ff196a83f9a380f1add3c1c642`。这是本工具模块及材料的后置输入核对，不冒称整个编译环境的启动前来源证明。
- `cleanup.json`：2026-09-07 11:36:57 UTC 核对；仅向已确认 owned child PID 90374 发 SIGINT，父进程 90362 随后结束。`pgrep` 无 UAT 进程，原 guide 53411 与 Admin 52661 端口均 `ECONNREFUSED`；落盘计时仍为 0 次、人工验收仍为 false。

两次受控 SIGINT 都使既有 runner 在 READY 后追加 generic FAIL，并以 **exit 1** 结束。保留该观察，不将它表述为零退出码的生命周期通过，也没有为隐藏退出码改动共享 runner。已确认所属进程和对外端口停止。两次环境地址均已失效，不能作为目前可用的人工入口；正式 UAT 必须重新准备。环境准备与屏幕 smoke 均不替代真人 3/5/8 分钟完成、独立审核和生产验收。
