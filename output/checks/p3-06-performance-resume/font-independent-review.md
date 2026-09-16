# P3-06 字体 CSS 互斥修复：非作者独立源码审查

- Reviewer: `/root/order_bff`
- 基线：`7d1a5391a70c655da2d0a654d47c79c11e37b04d`；分支：`codex/p3-06-performance-resume`。
- 结论：**源码范围 ACCEPT，无阻塞发现。** 不据此宣称 P3-06 性能验收、共享 UI 门或发布完成。
- 本审查只读源码、diff、产物和已有日志；未运行测试、生成器、Python、build 或 Chrome，未建立 worktree。唯一写入为本报告。

## 审查范围

完整检查 `scripts/fonts/generate-fallback-css.mjs` 与其 8 个测试、`generate-ui-subsets.py` 新 hook、字体 README、日文/简体中文两个 profile、两份生成 fallback CSS 和 `fallback-manifest.json`；检查 `scripts/font-ui-subset.test.mjs` 的新语义断言、`check-design-foundations.mjs` 两个入口常量、对应两个拒绝旧入口测试，以及根 `package.json` 串接新测试的变更。

对照原 `font-ui-subset-support.mjs`、现有 UI artifact/loading 检查和 Fontsource 原 CSS；核对无 `pnpm-lock.yaml`、字体包依赖、`sources.json`、原 UI manifest、UI CSS/WOFF2 或许可证变更。原 Latin/Thai/Vietnamese profile 不在本次修改范围。

## 关键判断与依据

1. **可重复生成与临时目录语义正确。** `--output-dir` 只控制三份输出，默认 UI 输入仍来自规范目录；`--ui-dir` 独立控制 manifest/CSS/WOFF2 输入。生成前检查完整词库源码 SHA、完整 codepoint 集、UI CSS 声明范围、实际资源路径和二进制 SHA/长度，以及声明和安装的 Fontsource 版本。所有 profile 验证完成后才写文件。产物没有时间戳或机器绝对路径；两次生成与提交产物逐字节比较，测试也拒绝 `.pnpm`/`/Users/`/`file://` 路径。临时输出使用正式安装位置的资源相对路径是有意约定，README 明确只供再现比较，不承诺从临时目录直接加载。

2. **Python hook 使用本轮输入。** hook 在新 UI 产物、manifest 和格式化完成后执行 Node 生成器，将同一个 `args.output_dir` 同时传给 `--output-dir` 和 `--ui-dir`，并使用 `check=True`。它不会因临时输出路径而默读旧 manifest。新 CLI 测试实际覆盖两参数同目录与篡改该目录 manifest 后拒绝；本次没有执行完整 Python/字体二进制再生成，因此这里是 hook 源码及 Node 输入契约审查结论。

3. **完整 CSS 声明字符范围保持，UI 范围互斥。** 对每个原 face 仅从 `unicode-range` 减去完整当前 UI 词库 codepoints；空差集 face 才省略。保留原顺序和其余 descriptor；生成器检查 `fallback ∩ UI = ∅`、`fallback ∪ UI = original`。日文为原 17,929 / UI 384 / fallback 17,545 points，简中为原 15,605 / UI 416 / fallback 15,189 points。范围检查覆盖全部原声明集合，未缩成特定页面文本或样本。

4. **非 UI 字符仍选择原文件，二进制不变。** 语义测试逐原 face 核对完整差集、descriptor、顺序、资源 realpath 与真实字节；对每个原非 UI codepoint 比较当前和原 cascade 选择的资源，不仅比较 union。生成器读取原文件并记摘要，不写/复制/裁剪原 WOFF2；manifest 记录日文 124、简中 101 份原资源。现有 UI 二进制/许可证/manifest 的 HEAD 相等证据保留，原 artifact gate 仍在。这里证明的是 CSS 范围与选择模型、真实文件身份；不把它描述成全部字符浏览器塑形或像素等价实测。

5. **生产引用与 display 策略兼容。** 两个 profile 均依次引入生成 fallback 和既有 UI CSS。资源通过稳定的 `design-tokens/node_modules/@fontsource-variable/.../files/` 路径解析，生成前 realpath 绑定同一个原资源；未序列化 pnpm store 位置。原源 CSS 的 `font-display: swap` 保留，现有 Storefront 构建插件仍转为 `optional`，语义检查覆盖转换后的所有 face。未改加载插件、其他 locale 或部署配置。

6. **校验门没有降级为只接受新文件名。** 静态入口检查的两项常量改成新 cascade，两个拒绝测试确认旧重叠入口不再被接受；独立语义测试检查真实范围、文件和完整非 UI 选择。新生成器测试加入原 `check:design-foundations` 命令，根 `check` 继续调用该门。既有 PostCSS/Prettier 与固定 Fontsource 版本复用，无新依赖和 lockfile 漂移。

## 已读取的有效证据

以下均为作者/root 已执行日志，本 reviewer 没有重复执行：

| 证据 | 实际结果与范围 |
| --- | --- |
| `font-overlap-probe/production-coverage-red.log` | 修改前两个 CJK profile 的真实重叠断言失败，另外三个 selection 测试通过。 |
| `font-fallback-css/temporary-output-red.log` | 旧实现错误要求临时输出目录内存在 UI manifest，实际 ENOENT；新独立输入/输出语义直接修复该行为。 |
| `font-fallback-css/generator-green-final.log` | 8 PASS / 0 FAIL，包含临时目录、确定性、范围边界和不兼容输入拒绝。 |
| `font-overlap-probe/production-coverage-green.log` | 9 PASS / 0 FAIL：loading、artifact、完整 source-selection/互斥范围检查。 |
| `font-profile-gate-red-result.json`、`font-profile-gate-green.log` | 原静态入口不匹配实际新生产 profile 时 exit 1；更新两项入口及加入旧入口拒绝案例后 34 PASS / 0 FAIL。 |
| `font-fallback-css/result.json` | 记录上述计数、生成 CSS SHA、原二进制/manifest/许可证不变及执行限制。 |
| `font-fallback-css/format-check.log`、`lint.log` | 格式化日志明确 matched files PASS；lint 无诊断，exit 0 由 result.json 记录。 |

`font-fallback-css/generator-red.log` 是最初缺模块的导入失败，**不作为功能行为 RED**。上述证据路径均相对本报告所在目录。

## S.U.P.E.R 检查

| 项 | 实际依据 | 结论 |
| --- | --- | --- |
| 1 单一模块职责 | 新生成器只验证输入并派生 fallback CSS/来源摘要。 | ACCEPT |
| 2 单一概念职责 | 范围差集、UI 验证、profile 构建、产物集合、CLI 写入分离。 | ACCEPT |
| 3 单向数据流 | 固定源/现有 UI 输入 → 差集与摘要 → 三份产物；无运行时业务反向依赖。 | ACCEPT |
| 4 无循环依赖 | 复用无生成器反向引用的字体解析 helper；Python 只单向调用 CLI。 | ACCEPT |
| 5 明确接口 | CLI 参数白名单/唯一性校验，manifest schemaVersion 和 profile 顺序校验，输入身份与范围断言。 | ACCEPT |
| 6 可序列化输入输出 | UTF-8 CSS/JSON，SHA/字节数/codepoint 等显式值，无持久运行时对象。 | ACCEPT |
| 7 无部署硬编码 | 路径由脚本/包位置计算；没有域名、生产配置或机器目录写入产物。 | ACCEPT |
| 8 依赖显式 | 使用已声明包和已固定 Fontsource 版本，验证安装版本与资源身份。 | ACCEPT |
| 9 可替换性 | 生成逻辑导出纯产物入口，UI 输入目录可选，临时输出可逐字节再现；现有 CSS profile 接口不变。 | ACCEPT |
| 10 所需测试与门禁完成 | 定向 8/9/34 PASS 已读；最终 warm 浏览器、P3 性能/购物车整合、原 P2-03/04/05 clean-checkout 与全仓门由 root 汇总。 | **待 root 最终门** |

## 确切限制与交接

本报告不作下载数量、流量、LCP 或像素效果的浏览器结论。新的范围语义仍需 root 正在安排的真实 warm 浏览器结果以及最终共享 UI 证据；未读取或复用尚未完成的结果冒充最终通过。原 P2-03/04/05 clean-checkout 顺序、独占 Chrome/构建和证据冻结要求已单列在本目录 `shared-ui-plan.md`。无需为本次源码审查另造抽象或扩大生产修改。
