# 首次绘制等待取证计划

基线a560ac7，保持所有生产应用源码。已知旧同构建慢样本的983.518ms发生在同一个PipelineReporter的EndActivateToSubmitCompositorFrame；主线程JS/字体/样式表及主图正常显示结构不能解释这段等待。

新增TEST compositor-diagnostic profile仅在Lighthouse默认trace categories后追加cc、cc.debug、renderer.scheduler等类别。默认入口、Chrome flags和预算不改；额外trace存在开销，所有新结果只作定位，不与默认profile声明性能收益或正式过门。

原真实PG/TLS S3/worker/Next生产构建。固定中文礼物3次导航，没有UI或浏览器预热，没有优选重试；全部结果留存，是否重现均记录。不重跑本轮未修改的七语言UI。总报告累计另列扩展诊断，不混入48份原条件诊断。

命令：`FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS=1 mise exec node@24.20.0 -- node output/checks/p3-06-paint-delay/run-diagnostic.mjs`。serve=false，正常结束自动清理owned fixture。保留protocol、build、source关联、27个原始文件及SHA。工具RED→GREEN；最终check:dev、独立review、S.U.P.E.R和暂存secret扫描。仅本地提交。
