# P3-06 提交等待定向复现

基线a01cefe；同一真实PG/TLS S3/worker/Next构建固定4组三次，共12次中文礼物页导航。调用既有compositor-diagnostic profile，不修改库、Chrome参数、预算、内容、图片或字体。每组按既有helper启动一个独立Chrome，一次公开API证明。组顺序固定，失败也保留并继续预定后续组，无优选重跑/额外预热；计时与缓存差异如实保留。

优先假设：已激活内容帧因pending帧/ACK或BeginFrame需求/调度状态无法及时提交。出现慢样本时按同导航/renderer/compositor/Reporter范围/sequence关联，检查激活后等待、pending区间、ACK、真实BeginImplFrame与需求状态。0异常不等于修复；达到12次即停止本轮随机重采。新profile额外开销不同于原默认报告，不宣称性能收益或正式过门。

命令：`FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS=1 mise exec node@24.20.0 -- node output/checks/p3-06-compositor-repro/run-diagnostic.mjs`。serve=false，结束自动清理owned资源。编排不复用旧路径；每个group与browser-attempt在同层，使既有helper的原生日志定位仍正确。

所有新产物与原文件SHA/源绑定/采集设置留档。独立非作者复核，生产修改必须另登记/RED→GREEN/七语言UI；仅本地提交。P3-06及27/2/20、Phase5 LOCKED保持。
