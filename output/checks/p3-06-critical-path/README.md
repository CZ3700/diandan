# P3-06 公开样式隔离检查点

2026-09-21，基线 `3fc5df5`，本地分支 `codex/p3-06-critical-path`。仅接续 P3-06；29 DONE / 2 IN_PROGRESS / 18 PENDING 保持。接受范围是资源隔离和功能回归，**正式性能仍未通过**。

## 实现与测量

生产仅移动一条 import：公开 globals 不再加载 `@fan-support/ui/composites.css`，内部 design-foundations layout 加载原样式。四份原 UI CSS 字节不变，motion 仍在原位置，避免与 primitives 的同优先级圆角覆盖变化。新增公开/内部样式隔离测试，更新 composites 静态门及缺失、重复、注释、字符串、type-only、公开泄漏反例。无合同、SQL、依赖、图片或字体修改。

同一个真实 PostgreSQL/TLS S3/worker/API fixture：旧实现固定3次标准 profile 中文礼物导航，候选固定3次，再运行七语言完整 UI。原样本全部保留，没有额外预热或择优补采；原阈值、Chrome/Lighthouse 默认选项不变。组间重建/缓存与时序可能不同，LCP 差值不能单独推导因果。

| 观测 | 旧实现 | 候选 |
| --- | ---: | ---: |
| CSS 请求数 | 4 | 4 |
| CSS resource bytes（各3次一致） | 173321 | 162020 |
| CSS 实际 transfer bytes（各3次一致） | 48494 | 46963 |
| 模拟 LCP 中位 ms | 4212.1395 | 4359.5727 |
| 三次 CLS | 0 | 0 |

浏览器实际收到的 CSS 少 **11301 resource bytes / 1531 transfer bytes**，其中3个 stylesheet chunk内容SHA相同，仅全局chunk减少；候选没有 composites 主体规则，保留 primitive/overlay/motion。字体资源集合和体积相同；原字体文件由源码SHA保护。54原始文件SHA/长度有效，逐导航内容与0次unscoped+1次scoped成功读取保持，组首完整公开响应相同。官方离线重放6份报告的12个FCP/LCP值 difference 全为0。

两组均 `COLLECTED_DIAGNOSTIC_BUDGET_FAILED`。不宣称 LCP 改善、稳定无性能回归、正式63次矩阵或RUM通过。原 BeginFrame 等待原因仍 UNKNOWN；精确版本源码审计发现现有事件缺少绑定目标 sink 的信息，不能靠相同类别重复采集补足，详见 `scheduler-audit.md`。

## 功能与质量证据

- 真实协议 32461 assertions PASS；完整七语言390×844/1440×900回归88场景、88截图、85axe扫描，0violations、30incomplete留人工，0pageErrors，22705 callback assertions。发布9547ms、回退9244ms可见。root查看中文移动端、葡语桌面和内部越南语移动端截图，未见本改动造成的布局变化。
- 内部交互 P2-03：13场景/15截图/8axe；1个既有 moderate `region`、5incomplete、0blocking。原focus-guard排除规则未变，该排除与moderate region是不同项目。
- 内部组合 P2-04：16场景/18截图/10axe；0violations、4incomplete、0blocking。
- 内部动效 P2-05：8场景/22截图/3axe；3个既有 moderate `heading-order`、3incomplete、0blocking。结果仍为 `passed-with-physical-device-gate`，不替代真机性能。
- 新样式测试旧实现2FAIL/2PASS；静态门新边界先RED。首次GREEN因 `.fs-hero` 子串误匹配保留motion后代选择器而1FAIL，修正为独立规则判断后4/4通过；原失败保留。最终全仓check:dev exit0，type/test63/63、build36/36（缓存62/62/35）；storefront 91文件702tests通过。
- 设计基础、primitive、interaction、composite、motion完整静态门均exit0。恢复全仓构建后adapter/artifact均exit0。显式暂存101条准确路径后秘密扫描exit0/47.571秒；最终复核见 `final-verification.json` / `style-independent-review.md`。

## 保留的验证失败与处理

1. P2-03在原工作区跑到最终Git检查失败。旧runner要求完全clean，不是允许稳定dirty；原5042未跟踪文件及本轮修改已违反该前提，错误文案不能证明运行中改源。未修改runner门禁，另建 `.turbo/p3-06-critical-path-clean-snapshot` 独立Git快照 `115ce9a0532383184cb9c2a9f5548e5a3f0c8a79`，offline frozen install后跑原runner成功。2345候选源码逐SHA与主工作区一致且结束仍一致；两份生成的next-env声明另复制。快照不是主分支提交，成功证据对应相同候选源，不声称原工作区clean。见 `snapshot-verification.json`。
2. P2-03原runner在准备构建时清除所有workspace dist，仅恢复storefront闭包，导致随后adapter门缺少其他包声明而失败。运行原全仓build恢复36/36缓存产物后adapter/artifact成功，无源代码修正。原 `gate-adapter-result.json` 失败保留。
3. 模拟性能预算失败不是上述验证流程错误，继续保留为实际未完验收。

## 复跑入口与保护

所有准确命令、时间、耗时与exit在 `*-result.json`，未跟踪日志保留本地。核心入口：

```sh
FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS=1 python3 output/checks/p3-06-critical-path/run-check.py fixture mise exec node@24.20.0 -- node output/checks/p3-06-critical-path/run-comparison.mjs
python3 output/checks/p3-06-critical-path/summarize.py
mise exec node@24.20.0 -- corepack pnpm check:dev
mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs
mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs
```

对照入口是本检查点一次性驱动器：以 `stage.json` 明确依次控制baseline/candidate/ui并在各测量段使用对应源码；不能把当前候选直接重跑并称旧基线。首次原始fixture路径为 `output/checks/p3-06-storefront-acceptance/run-2026-09-21T13-25-04-359Z/`，原始大文件留本地，精选结果与SHA清单随检查点保存。P2-03需在真实干净Git快照运行原脚本；不要删用户文件或放宽Git门。

`source-candidate.json` 固定2345源码输入，SHA `6d89e148830443ec72da7982a9e3cd0d8ae9bf44e0a46ce2a9f1b20a11375600`；最终均未变。原5042未跟踪逐SHA不变、不混入暂存；旧102件共享UI证据已原字节备份至 `.turbo/p3-06-critical-path-evidence-backup`，旧提交也可恢复。仅本轮重跑P2-03/04/05更新其当前证据。fixture exit0，13个本轮已记录服务端口无监听。

下一性能实验候选为相同TLS入口下实际HTTPS/H1.1与HTTPS/H2有界比较，先证明真实响应协议与部署一致性；详见 `resource-audit.md`。这只是后续计划，未实施、不推断提速。其余P5和Phase6/7保持原门禁。未运行完整pnpm check、生产云基础设施、真实商户/小额支付、物理手机或VoiceOver验收；人工、译文、正式资产等门继续保留。只本地提交，不push或发布。
