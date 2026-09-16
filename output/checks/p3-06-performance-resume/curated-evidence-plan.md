# 本轮证据暂存候选计划

**PLAN ONLY：没有执行 git add / commit，没有修改源码、原始证据或 canonical。**

快照 HEAD：`0dabba96e88d421d4679f6891e9e237efc3ef24d`。范围仅 `output/checks/p3-06-performance-resume` 本轮新增文件与三套已导入 canonical 的实际变更文件。

现有候选 **157 文件 / 25.04 MiB**（当前未压缩大小，不代表 Git 压缩增量）：

- 本轮新证据 109 文件 / 8.59 MiB。
- canonical 变更 48 文件 / 16.45 MiB，其中16张已跟踪PNG必要更新；其余原有未变文件无需重复暂存。
- 另加这份 JSON/Markdown 计划自身；最终3个结果待 root 补齐后再选择。

initial-untracked 清单 2438 路径与所有候选交集为0；候选无 `.log`，`git check-ignore --no-index --stdin` 未发现被忽略路径。

## 保留的证据链

- 基线、正式候选和完整检查前的来源 manifest；initial-untracked 保护清单、兼容性核对、实施文件清单。重复中间来源 manifest 留本地。
- 原正式采样失败/不完整、两轮 partial 复算、baseline 与新诊断 run 索引、Lighthouse 官方图复算及其脚本。原 raw 路径和已有摘要保持，不补齐、不拼接失败样本。
- 字体原始 warm `results.json`（约4.36 MB）继续保留 `pass:false` 的严格反证；candidate-only delta 判读另存，不能把原 FAIL 改称全通过。逐变体重复数据、HTML 与图片不重复收录。
- default-off TEST 诊断单测结果、非作者源码评审和 actual-fixture 8份真实阶段归档；异常未重现不表示已修复。
- 购物车/字体 TDD 摘要及复现脚本、现有浏览器摘要、共享UI独立报告与hash清单。小日志本地保存，其hash记录在JSON省略清单；不强制加入被忽略文件。
- 共享证据辅助导入失败与被取代的初版提取记录均保留并标明最终报告；不删失败历史。

## 原始材料只留本地

本范围内当前排除 **743 文件 / 552.46 MiB**：raw trace、DevTools、逐次LHR JSON/HTML、生成字体HTML、PNG副本、完整 imported-evidence / previous-canonical 重复归档、所有 `.log` 及重复中间manifest。未删除任何文件。

`curated-evidence-plan.json` 精确列出每个候选的路径/尺寸/SHA/理由，及每个本地保留文件的路径/尺寸/排除理由；已有各报告仍可引用这些本地原始材料。Git-only checkout 无法读取故意省略的原始字节，这个限制不应隐藏。

原正式PG/Storefront fixture任务目录没有加入；该目录中的实际raw证据仅由本轮摘要/hash引用。禁止把其他任务输出或 initial-untracked 路径顺带暂存。

## 完整检查结束后待补

- `full-check-result.json`：读取真实 exit / command / duration 后再纳入。
- `final-verification.json`：读取最终兼容性、保护与 S.U.P.E.R 限制后再纳入。
- `source-final.json`：与完整检查前来源manifest复核后再纳入。

`README.md`、`full-check-review.json/md`、`compatibility-and-protection.json` 目前仍允许 root 收尾更新；JSON里的当前SHA不是其最终承诺。`full-check.log` 无论运行完成与否都不进入Git，结束后可记录最终SHA。

root 最终应按 JSON 精确文件列表审阅、刷新发生变化的快照，显式暂存，随后运行原 secret scanner。不要暂存整个 output 目录，不使用 -f 绕过忽略规则。本计划不宣称完整 pnpm check、P3-06 性能门、真机或人工验收已完成。
