# Offline RUM dashboard locator RED → GREEN

结论：这是验收工具的定位错误，未发现这一处产品无障碍命名缺陷。工具已冻结；候选副本与产品代码未修改。定向 PASS 不替代完整 Next/RUM 外层验收，原失败 run 保持 FAIL 并原样留存。

## 真实浏览器定位

对 candidate4 真实 CLI 生成的 HTML，在 Chrome 153.0.8010.53 的 390×844、1440×900 分别检查：

- 原 `getByLabel("locale", { exact: true })` 与 viewport 对应定位均匹配 0 个元素，实际 selectOption 在两尺寸都复现 TimeoutError。
- DOM 隐式 label 的 textContent 包含子 select 的 option 文本，例如 `localeallenesjaptthvizh-CN`。这是旧工具文本匹配失败的具体原因。
- 浏览器 accessibility snapshot 明确给出 `combobox "locale"` 与 `combobox "viewport"`；各自 `getByRole("combobox", { name: field, exact: true })` 都唯一匹配 1 个元素。因此保持准确可访问名称定位即可，不需修改产品 label。
- RED 证据：`rum-dashboard-locator-red/diagnostic.json`、两尺寸截图以及 `rum-dashboard-locator-red.txt`。没有脚本注入指标或修改页面控件。

## 最小修复与真实复用

`rum-browser.mjs` 只导出原有 `verifyRumDashboard`，并把七处 locale/viewport 选择与可见性定位换成 exact combobox role/name。原超时、所有数据/行数/缺样本断言、筛选顺序和截图均保持。与 candidate4 的精确差异保留在 `rum-dashboard-locator-fix.diff.txt`。

新增显式定向入口 `rum-browser-dashboard-regression.mjs`，读取现存 CLI HTML/report 并直接调用同一个验收函数。使用新的独立输出目录，运行前后核对两份输入 SHA；不重写原失败产物、不生成或改写真实指标、不调用 Next/数据库。

实际定向命令退出 **0**（session 84496，completion 6885c3）。`rum-dashboard-locator-green/dashboard-browser.json` 证明：

- 390×844 与 1440×900 均 PASS；初始 42 行、每行九列逐值匹配实际 CLI report。
- 每尺寸完整 23 组筛选（七语言各 all/mobile/desktop，加 all-locale 的两个 viewport），逐值匹配且能恢复全部行。
- 合法空窗口显示零行与明确 `No observations — INSUFFICIENT`，仍说明不能把缺失 INP 补零。
- 每尺寸 pageErrors 0、HTTP(S) 网络请求 0，并各保留 all / desktop-filter / empty-window 三张截图。
- `input-provenance.json` 记录真实输入哈希与浏览器版本，输入字节在定向验收前后相同。

## 冻结与门禁

完整工具测试 36/36 PASS；本轮两个工具文件的 ESLint、Prettier 检查退出 0。`rum-dashboard-locator-freeze.json` 保存最终工具 SHA、输入身份与范围。非作者已独立核对最小差异和真实产物。源码和浏览器现已停止改动/运行，交由主任务建立最终候选并串行完成整链与正式性能验收。
