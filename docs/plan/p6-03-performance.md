# P6-03 本地性能实施与验收

状态：本地完整范围已 ACCEPT，Lane D 已释放；P6-03 保留原外部门而仍 IN_PROGRESS。原任务依赖和外部门见 `../progress/phase-6-hardening.md`。基线 `b7df3400` 已复制为独立源码快照，执行输入 SHA `34e9e6c36b8a286501a1ae4de55b54e39ce07786b307c52ef957c03ef5a5df1c`。

## 实施顺序

1. 固定测量工具、数据与预算；保留基线和每个失败样本。阅读当前实现后再根据证据选择优化，不预设首页或数据库一定变快。
2. 在隔离 PostgreSQL 中测量旧严格目录与现代日常发布目录：12/48 条页、足够大的目录；SQL 次数、总耗时、版本聚合、完整证明读取与响应字节分别记录。只读测量不能省略真实发布、媒体权利、语言和事故恢复校验。
3. 接通可关闭、可替换的 Web Vitals 采集、同源入口、严格合同和日志聚合仪表板。采集只包含指标、匿名单次测量键与有限枚举维度，不包含原 URL、查询、fragment、用户身份、业务 ID、DOM 或完整性能 entry。TEST/自动化样本不得进入真实用户达标结论。
4. 对最终冻结的 production 编译 TEST 服务串行验收，再做相关功能回归、完整开发质量门和非作者复核。

## 预先固定的性能采样

- Lighthouse 沿用既有 13.4.1 默认 mobile simulated slow 4G/CPU profile、同导航内容检查及七语 home/artist/gift 每组三次：63 原报告、21 组，全部样本保留，使用三次中位数。score ≥ 0.90、LCP < 2500 ms、CLS < 0.1；错误页和缺样本不能进入成功聚合。
- 资源/布局采集覆盖七语、原六个公开页面加无市场礼物目录、SPEC 六视口：360×800、390×844、768×1024、1024×768、1440×900、1920×1080，共294次导航。额外记录同导航 lab LCP/CLS，明确它不等于 Lighthouse 得分、真实设备或 field p75。
- JavaScript gzip <150000 B、首屏海报 <600000 B、常规图片 <400000 B为原 SHOULD 建议，超标逐项记录，不隐藏或改成更大预算。记录真实 script/image/font/style 请求、错误、字体 script 分包、语言消息与第三方脚本；图片不强制 eager。
- 固定工具版本、视口、网络/CPU、浏览器新上下文和缓存策略。正式性能期间不并行构建、其他浏览器或数据库压力测试；诊断运行单独命名，不混入正式矩阵。
- 真实用户指标依旧要求 p75 LCP <2.5 s、INP <200 ms、CLS <0.1。暂无真实流量时仪表板必须显示样本不足/本地测试，不能以 Lighthouse TBT、自动点击或日志样本伪造 RUM 达标。

## 保护与交付

用户持久实例不重置，测试内容使用独立实例。初始8457个未跟踪文件逐SHA保护；不修改原迁移、历史合同或验收报告。新合同兼容新增，指标不成为业务真相源。代码/工具完成后保存命令与失败、检查 S.U.P.E.R 十项、更新进度并本地提交；不推送或部署。若只有本地范围满足，任务仍 IN_PROGRESS 并准确交接真实用户/环境欠项。

## 参考

2026-09-24 核对 [Next.js Web Vitals](https://nextjs.org/docs/app/api-reference/functions/use-report-web-vitals)、[Web Vitals](https://web.dev/articles/vitals) 与 [INP](https://web.dev/articles/inp)；以锁定依赖的实际 API 为准，默认不采用实验 soft-navigation。

## 最终本地交付

最终candidate-5执行源 `ea5371aa693c4c2d46c238ac393036b11770c15e267d69e90460c829fe26baab`。完整质量、实际PG/S3、63 Lighthouse/21组、84+294资源单元、真实RUM14场景/42记录/离线看板与秘密扫描、保护、非作者复核均通过。所有原失败、脚本SHOULD超标和20条采样窗口外图片取消保留；没有凭测量报告宣称完成未经验证的性能优化。完整证据与S.U.P.E.R见 `../../output/checks/p6-03-performance/final-verification.md`。真实用户p75等原验收继续保留；仅P6-04按原依赖复核后有限READY，不自动进入生产或跳过后继登记。
