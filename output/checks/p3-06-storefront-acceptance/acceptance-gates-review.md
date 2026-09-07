# P3-06 退出门与真人交接复审

审查人：`/root/storefront_read`，2026-09-08 01:11 Asia/Shanghai（2026-09-07 17:11 UTC）。只读核对规范、Task 卡、Phase/MASTER、运行手册和现有证据；只新增本文，没有启动服务、浏览器、构建或测试。

**结论：当前证据支持多个技术子项通过，尚不支持 P3-06 DONE 或 Phase 3 退出。** MASTER 当前 22 DONE / 1 IN_PROGRESS / 26 PENDING，共 49；Phase 3 ACTIVE、Phase 4 LOCKED，与尚缺的人工门及最终技术验收一致。不得因为 P4-01 的任务级依赖已完成而绕过 Phase 解锁矩阵。

## 门禁归属与实际证据

| 门 | 阶段与依据 | 当前可证明的范围 / 仍需补齐 |
| --- | --- | --- |
| 七语言真实页面、目录、SEO 与缓存隔离 | P3-06；Task 卡 `docs/plan/task-breakdown.md:116`，Phase 文件第 24–28 行 | `run-2026-09-07T11-46-25-432Z/protocol-results.json` 为 PASS，32,461 累计准备/协议断言、6,090 setup 请求；实际 PG/TLS S3/worker，不能全部称为浏览器断言。最新 browser callback 为 PASS，22,692 断言；`browser-results.json` 为 88 cases、88 PNG、86 重排、0 pageErrors，七语 390×844/1440×900。性能字段仍 null，不能称本任务全部通过。 |
| 发布/回退后 ≤60 秒可见 | Phase 3 必须证明；规范 §9.6、Phase 3 退出门 | 同一最新 run 的 `browser-attempt-1/publication-visibility.json` 为 PASS：PUBLISH 14,562ms、ROLLBACK 17,291ms；真实 API、Chrome 文档、根/locale sitemap 与分片。`externalCdnEvidence:false`、`manuallyRunPurgeWorker:false`。旧 `run-11-18` 的 84,923ms 失败必须保留，不能改成过去已通过。 |
| axe、键盘、IME、焦点与读屏 | 当前 P3-06 明确有读屏；规范 §18.1；P6-02 后续覆盖完整购买/订单 WCAG | 最新 85 个 axe runs 零 violations；仍有 30 条 incomplete rule、536 个节点，需要对本次 targets 明确复核，不能称零 incomplete 或自动 AA 全过。`voiceover-attempt.md` 只有真实开关尝试，没有可核验朗读；最新 browser `voiceOverEvidence:false`。必须补真实 VoiceOver/NVDA 的浏览流程 smoke；P6-02 的后续完整验收不代替本轮。 |
| 浏览性能预算 | P3-06 Task 卡 LCP；规范 §16.2；P6-03 继续六视口、优化和 RUM | 最新浏览器 callback 明确不含 performance。需完成 root/E2E 串行采样及原始报告归档：七语 × 三页面 × 三次移动 Lighthouse，保留全部样本及每组中位/最小/最大值；资源预算独立报告。源码微基准、未节流本机页面或单次最好分数不能替代该门。 |
| 非开发人员 3/5/8 分钟 | **当前 Phase 3 硬门**；规范 §9.1，Task 卡第 116 行，Phase 第 27 行 | 两次 UAT 只是准备 smoke，各 1,796 准备断言/581 setup 请求。最新 `operations-uat/run-2026-09-07T11-29-29.609Z-bb1a716f/timing.json` 的 attempts 为空、humanOperationsAcceptance 为 false。尚无真人培训与完成记录，不能由自动化时长、角色窗口或材料生成代替。 |
| 七语关键内容批准 | 当前 Phase 第 28 行、规范 §8.2/§9.7；正式经营稿在 P7-01/P7-02 再冻结导入复核 | TEST PG 中正常作者→独立角色审核→发布可证明工程门。当前 storefront/admin 各七份 `.review.ts` 仍 DRAFT、reviewer/approvedCommit 为 null，不能据此写“七语人工批准完成”。当前验收稿需有相应语言能力的人工核对及精确版本证据；正式稿的法律/品牌批准也不能由这份 TEST 证据继承。 |
| 正式品牌、Logo、摄影/肖像与商品素材 | 规范 §21、ADR-008 最新批准记录、ADR-009；正式导入前且不晚于 P7-01/P7-02 | 已有明确授权沿 V2 和内部虚构素材开展研发。**不要求先交齐正式商业素材才能继续内部开发**；内部素材不能变成正式授权。导入真实人物前须有肖像/摄影授权及相关隐私流程；公开时效、退款和经营承诺须经实际负责人批准。 |
| 真实云 CDN、多实例与 staging | 本轮实现/本地验证缓存与 purge；真实基础设施 P5-08，staging 全业务 UAT P7-03，Release Gate §18.4 | 当前零 TTL 每次 origin 重验和本地持久 purge 不等于真实 CloudFront/CDN 验收。实际 CDN 仍需验证 min TTL=0、完整 scope、Cookie/Auth bypass、HTML/RSC 区分和失效映射。P5-08 明确依赖 P3-06，因此不能把尚未建设的 production-like staging 反向当作 P3-06 的隐含先决条件。 |
| RUM / 真实用户 p75 / 新真机 | 规范 §16.2、P6-03、P7-03/04 | 本轮最新 browser `physicalDeviceEvidence:false`；实验室 Lighthouse 不是 RUM/field INP/线上 p75。RUM dashboard 与有真实流量后的分布验证继续保留后续门；不能为提前宣称 p75 达标制造样本。已有手机连接、开发者模式或减少动态设置本身不是新页面的实测记录。 |
| 全仓最终一致性与独立复核 | 规范 §18.3/§22 与项目 skill | 两次整条 check 失败均留存；`preflight-final-result.json` 的 format/lint/typecheck 为 0，test 为 1。后续 `cold-workspace-tests-bounded-result.json` 为全部 workspace tests 强制执行 exit 0、并发 2，原断言/超时不变。这个受控通过不等于原整条 check 已通过；最终组合验证、来源指纹与 S.U.P.E.R 汇总仍由 root 收尾。 |

七语人工批准需区分“当前供验收的文案”和“最终商业稿”。规范允许后者在正式导入前准备，但没有允许代理把当前缺少人工批准的事实写成已完成。若项目负责人以后明确调整某一阶段的人工作业范围，应归档该真实决定并同步门禁；本次“继续”以及过去 V2 视觉批准均没有自动批准翻译、读屏或计时结果。

## 需要 root 在收尾时准确更新的记录

1. 当前检查 README 第 31–32 行仍以 `run-11-18` 可见性失败及“最终浏览器待归档”为最新状态；应保留历史失败，再追加 `run-11-46` 实际 PASS 的范围、时间与独立计数。性能、人工和最终全仓仍单列待完成。
2. 85 次 axe 的零 violations 与 30 条 incomplete/536 节点分别记录。本轮若复用既有对比度依据，必须证明当前样式与目标适用性，并链接本次复核，不能沿用旧轮“零 incomplete”的摘要。
3. UAT 环境当前已停止：最新 cleanup 记录控制卡 53411/Admin 52661 均 `ECONNREFUSED`，受控 SIGINT 实际 exit 1 已保留。重新交给操作者前必须准备新运行卡、新材料和三个真实角色窗口；本文不把旧端口当作可用入口。
4. 最终性能、全仓和人工证据未齐前，保持当前 P3-06/Phase 状态及计数。其他未来门按所属 Task 追踪，既不冒称完成，也不增加未写入规范的提前上线要求。

## 给用户的精简 UAT 交接说明（供 root 发送）

准备工具和材料已验证，下一步需要真实使用者验证操作体验。环境准备由开发人员完成；拿到**本次新操作卡和三个后台窗口**后，再进行以下事项：

1. 安排一位接受一次培训的非开发操作者，以及另一位独立审核人。编辑、审核、发布/价格窗口按权限分工；同一人切换账号不算独立审核。先读 `operations-uat-training.md`，材料使用卡中的本次图片、艺人、英文和七语文件，不提前修改目标。
2. 由操作者亲自点击开始/结束，完成：首页换双端海报并预览 ≤3 分钟；艺人照片及简介更新并核对七语预览 ≤5 分钟；从新建礼物开始，完成规格/库存策略、图文、翻译导入、独立审核、实际价格、预览和发布 ≤8 分钟。写稿、翻译、法律审校可事先完成；结构和价格录入、查找图片、整理导出包、等待审核与处理错误均计时。操作卡已有安全计时与材料工具，不需操作者运行命令。
3. 如实保留超时、阻断和协助情况。交回运行编号、计时记录及见证结果；见证者核对实际新版本、照片、七语和发布/价格结果，不能只看接口成功或“我报告已完成”。正式审核记录绑定实际英文源/hash/译文版本；需要具备相应语言能力的审核者确认含义和履约/退款表述。
4. 使用真实 VoiceOver 或 NVDA，在提供的七语浏览页面检查艺人搜索建议/结果提示、键盘选择与退出、继续浏览、礼物筛选/分页、抽屉焦点及错误恢复。记录设备/系统、浏览器和读屏版本、locale、步骤、实际朗读及焦点结果；录音、读屏字幕或逐步见证记录须能核验。不能用截图或 axe 报告代签；未测语言或步骤标明待测。

这组 UAT 可使用现有明确 TEST 材料；无需为该本地任务先准备正式照片或真实收款资料。正式导入/上线前另交品牌与授权素材、七语正式内容及人工批准、经营市场/币种、政策/SLA/客服等负责人决定，按规范 §21/P7 的时间门办理。当前交接不涉及真实付款，也不是 staging 或生产发布。

相关入口：`operations-uat-training.md`、`operations-uat-README.md`、`voiceover-attempt.md`、`docs/operations/storefront-acceptance.md`。本审查不向用户发问，也不替代 root 的最终验证与阶段状态更新。
