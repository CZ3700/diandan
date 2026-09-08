# 共享 UI 干净工作区实际回归

从本地提交 `7db722b4f5480ffb78eb19f5e2eec7675e50b1bd` 建立 detached 工作区 `/Users/mario/Desktop/下单/.turbo/p3-06-shared-ui-check`。Node 24.20.0、pnpm 11.25.0；`pnpm install --offline --frozen-lockfile` 成功，初始 Git 状态为空。没有修改产品、测试工具或既有断言。完整 Lighthouse 采样结束后，严格依次运行三项共享 UI 验证。

| 验证 | 退出码 | 实际运行时长 | 基础场景 | PNG | axe 扫描 | 原始结果 |
| --- | --- | --- | --- | --- | --- | --- |
| P2-03 interactions | 0 | 73.046 s | 13 | 15 | 8 | passed |
| P2-04 composites | 0 | 27.651 s | 16 | 18 | 10 | passed |
| P2-05 motion | 0 | 39.955 s | 8，另有 6 个专项入口 | 22 | 3 | passed-with-physical-device-gate |

这三个命令均在 detached 工作区执行：

```sh
mise exec node@24.20.0 -- node scripts/verify-ui-interactions-browser.mjs
mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs
mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs
```

P2-03 正常清理该验证工作区的 dist/.next 并强制重建前台完整依赖；最终报告确认同一提交、干净源码。P2-04/P2-05 前后源码指纹和工作区状态守卫均通过。两项 200% 缩放由隔离原生 Chrome 配置完成。三个验证器的 preview、staging、production 路由门均是**本地 standalone 环境配置测试**，没有宣称真实 staging 或 production 部署。

## 证据与回传

- `p2-0{3,4,5}-attempt-1.log`：每条命令完整 stdout/stderr。
- `p2-0{3,4,5}-attempt-1-meta.json`：命令、开始/结束 UTC、退出码、耗时、自有进程观察。
- `imported-evidence/p2-03`、`p2-04`、`p2-05`：完整成功报告、原始 JSON、axe 结果、构建日志和截图，分别 30、36、36 个文件。
- `p2-0{3,4,5}-files.sha256`：每个回传文件的 SHA256。源目录与复制结果逐项字节哈希相同。
- `p2-0{3,4,5}-copy-comparison.json`：与实现工作区原 canonical 报告的比较。执行代理没有覆盖 canonical；root 单独按其 `canonical-import-*` 记录归档并导入，原报告在 `previous-evidence` 保留。
- `verification-summary.json`：可机读汇总与准确源码指纹。
- `cleanup-verification.json`：三个 runner 完成清理后，观察到的自有后代 PID 均不存在；日志里的九个实际 loopback 服务端口全部无监听。没有终止其它进程。
- `checkout-final-status.log`：结束后仅报告目录发生变化，HEAD 保持指定提交。

P2-04 指纹：`bf64ef4c61eec873766549a97aad96f058b05227d6e33b4338f180a223a10ee1`，算法 `p2-04-render-inputs-v1`。

P2-05 指纹：`f8b460699de81e8aef6a493c47b6b500c4a1d1b69010a4f4cfedaeba5bab7383`，算法 `p2-05-render-inputs-v1`。

三项本轮均首次实际通过，没有重试、预算调整或失败断言豁免。Root 先前整仓检查因旧 P2-04 证据过期的失败是另一条命令，保留其原日志，不以本报告覆盖该历史。

## 范围限制

本轮证明共享 UI 在本地实际 Chrome 中的回归；public storefront 的 lazy Header/Drawer、完整七语页面和 Lighthouse 采用各自专项证据。P2-05 明确保留真实移动设备录像与帧率门；本轮没有真人 VoiceOver、运营计时或真实发布环境验收，也没有将 P3-06 标为完成。
