# P3-04 S.U.P.E.R 复核

| # | 检查 | 结果 |
|:--|:--|:--|
| 1 | 单一文件职责 | PASS：首页合同/领域投影/Application/仓储/HTTP，前台读取/图片/导航/搜索/轨道/路由分离 |
| 2 | 单一函数职责 | PASS：输入校验、发布证明、目录请求竞态、定位与渲染分别处理；收敛无效样式和嵌套状态分支 |
| 3 | 单向依赖 | PASS：Browser/Next Route → API → Application → Content/Port → PostgreSQL，没有浏览器数据库访问 |
| 4 | 无循环 | PASS：workspace/依赖/adapter静态门及完整构建验证；route loading只依赖独立展示/读取模块 |
| 5 | Schema边界 | PASS：3个versioned新root，旧370逐项不变；API/BFF按共享schema解析 |
| 6 | 序列化 | PASS：公开DTO不含callback、内部manifest、私密intent、地址、actor凭据；内部transaction callback不进入HTTP |
| 7 | 环境配置 | PASS：站名、API origin、媒体origin来自配置；TEST人物和画布只在fixture；新增层级值进入共享token |
| 8 | 显式依赖 | PASS：i18n workspace出口/依赖和pnpm锁同步；图片复用已有Next/Sharp，无新增业务SaaS |
| 9 | 可替换 | PASS：首页读取Port与PG实现分离；图像优化仅可重建投影，内容和商业真相继续PG |
| 10 | 验证 | PASS：同一1374输入下全仓各门分段通过、真实PG/API/S3/浏览器、secrets/diff和非作者复核；并行artifact超时与缓存范围明确保留，见validation.json |

独立复核入口：read-integration-review.md、final-independent-frontend-review.md、catalog-time-independent-review.md、mobile-composition-independent-review.md、route-loading-independent-review.md。生产审核、正式资产、PSP、staging、实际交付与物理手机未被本地验证替代。
