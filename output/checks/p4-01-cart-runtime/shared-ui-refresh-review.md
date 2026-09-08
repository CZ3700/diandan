# P4-01 共享 UI 证据刷新

P2-02/P2-03 原样门禁通过，无需重复浏览器采集；P2-04/P2-05 的合同、依赖和配置输入变化使旧证据过期。全仓源与文件创建冻结后，按原脚本严格串行采集，两项均 exit 0。没有改产品 UI、脚本逻辑或单独替换指纹。

## 范围与来源

`shared-ui-fingerprint-diff.json` 记录两项各 9 个变化、6 个新增输入，均为 package / lock / config / cart contracts / generated / registry 相关，没有 UI 产品源变更。旧证据 72 个文件完整归档在 `shared-ui-previous/`，逐文件 SHA 见 `shared-ui-previous-manifest.json`，没有删除旧失败或伪造复验。

## 实际执行

- P2-04：`mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs`；2026-09-08 09:21:23.370Z → 09:21:52.648Z，exit 0。16 scenarios / 18 PNG；10 axe scans 共 0 violations、4 incomplete；结果 `passed`。日志与起止信息：`shared-ui-p2-04.log`、`shared-ui-p2-04-meta.json`。
- P2-05：`mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs`；09:22:17.812Z → 09:22:56.444Z，exit 0。8 viewport scenarios，另含动效 / reduced-motion 矩阵，共 22 PNG；3 axe scans 共 3 violations、3 incomplete，critical/serious blocking violations 为 0；结果 `passed-with-physical-device-gate`。日志与起止信息：`shared-ui-p2-05.log`、`shared-ui-p2-05-meta.json`。
- 采集后独立执行 `node scripts/check-ui-composites.mjs` 与 `node scripts/check-ui-motion.mjs`，均 exit 0，见 `shared-ui-composites-after.log`、`shared-ui-motion-after.log`。
- 两个 collector 均验证内部 preview 八种 locale 返回 200，禁用 preview 的 staging / production 模式八种 locale 返回 404，健康入口返回 200。这是本地环境配置验证，不是远程 staging 部署。

精确来源：P2-04 `8837f89efbf4b4b81ae7b22a00b14983830c42795500342f6c23003d3a77edac`；P2-05 `0a98b534213ee0bb468aa55dc2123402b1e216f4e351edfcd8a15c176ef74385`。canonical 完整产物分别在 `output/playwright/p2-04/` 与 `output/playwright/p2-05/`，由原 collector 正常生成并校验。

## P2-05 axe 的准确边界

三项 violation 是同一个 `moderate / heading-order` 在 desktop / mobile / pseudo 三次扫描各出现一次，节点均为 `div[data-active="true"] > h3`、`<h3>Mira Vale</h3>`。逐项与归档旧产物比较，id / impact / HTML / selector 完全相同，并非本轮引入的新结果。

`apps/storefront/src/app/ui-motion-lab.tsx:175` 在内部动效实验页使用合成 `IdolSwitcher`；该组件在 `packages/ui/src/motion-client.tsx:444` 输出 h3，而该实验页的艺人区没有前置 h2。`ui-motion-specimen.tsx` 明确标注 fictional / preview only；当前应用中的该组件调用仅在此实验页。它是测试场景中的真实标题层级问题，并非因此自动算通过或代表正式内容无问题。

现行 `scripts/verify-ui-primitives-browser.mjs:716` 的 `summarizeAxeResult` 仅将 critical / serious **violations** 放入 blocking；`verify-ui-motion-browser.mjs:1643` 要求该集合为空，且在 `:2411` 从原始 axe 结果重算并核对摘要。故 moderate 项被原门允许，没有本轮白名单或放宽门禁。另每次扫描的 `serious / color-contrast` 是 incomplete（各 3 个节点），不是已确证通过；尚不能代替人工判断。不能将 P2-05 写成“零 violations”。

## 清理与剩余门

两个 collector 正常退出；运行日志均记录 owned runtime 停止。独立 lsof 复核 64548 / 64744 / 64767 / 64802 / 64959 / 64981 六个端口均无 listener；进程表没有本轮 collector / owned preview，未终止用户其他浏览器。无 collector 运行异常。

真实手机录屏与帧率证据仍未完成；桌面 Chrome touch / viewport emulation、局部延迟和帧率代理值不等于物理设备或 RUM / field INP。整仓检查由 root 继续执行，本报告不宣称阶段 DONE 或上线。

代表图：`/Users/mario/Desktop/下单/output/playwright/p2-04/viewports/1440x900-ja.png`；`/Users/mario/Desktop/下单/output/playwright/p2-05/viewports/390x844-vi.png`。
