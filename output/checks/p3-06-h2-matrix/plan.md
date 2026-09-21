# P3-06 full H2 lab matrix

- Owner：Codex `/root`，继续同一 ACTIVE P3-06、Lane D 唯一 executor；开始 `2026-09-21T16:33:17.693606+00:00`，基线 `bfe259a`。用户要求连续完成余下2+18项，先闭合已有技术缺口；未满足依赖的任务不冒领，29/2/18暂不变。
- 范围：在已验收字体修正上运行原完整84资源导航与7语言×3页面×3次=63次Lighthouse，原预算、默认模拟、Chrome启动参数、页面内容证明、顺序与三次聚合均不改；TEST读取诊断关闭。生产代码冻结；不再以中文单页诊断代替完整矩阵。
- 传输：复用已测TLS/ALPN/压缩实体字节的loopback只读viewer，仅浏览器入口改为H2；原上游仍本机HTTP。沿用原精确TEST SPKI豁免，不修改系统信任或新增浏览器开关。明确是本地H2实验室证据，不代表已部署CloudFront、生产TLS、SEO或RUM。记录全部样本、辅助请求取消、原始报告和构建来源，不因失败挑选重采。
- 所有权：root独占新 `output/checks/p3-06-h2-matrix/` 一次性运行入口、实际PG/S3/Next/Chrome与文档/Git；slow_lcp_audit只读现有慢快原件、matrix_plan_review只读复核方案；remaining_task_audit只读核对剩余任务依赖。任何产品改动须先登记具体范围并先RED再GREEN，不并行运行构建或CPU测试干扰采样。
- 验证：原真实协议、完整原性能函数及三次聚合，源码/原未跟踪SHA保护、实际H2记录/关闭与端口清理；工具检查、check:dev、独立复核及S.U.P.E.R后本地提交。人工运营/读屏/关键译文/真机、真实商户与后续部署门保留，原失败不覆盖。
