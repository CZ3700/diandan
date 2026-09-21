# P3-06 公开样式交付对照

基线 `3fc5df5`。旧证据中公开礼物页实际下载的 stylesheet 含内部 composites 规则，公开页面无对应消费者；本轮只把 composites.css 一条 import 从公共 globals 移至内部 design-foundations 布局。原样式内容、字体、图像、商业读取、Chrome/Lighthouse 选项不改。

采集前复核收窄：motion.css 与 primitives.css 存在同 specificity 的媒体圆角覆盖关系，直接后移可能改变样板视觉；因此它保持原全局位置，不以重复导入或新 CSS layer 扩大本次范围。composites 的实际组件组合未见该冲突，仍须真实样板验证。

同一个真实 PostgreSQL/TLS S3/worker/API fixture 顺序执行：旧实现三次标准 profile 中文礼物导航，候选三次相同导航，然后候选七语言390×844/1440×900完整 UI。每组独立原 Chrome launcher，恰好三次且全部原样保留；无额外预热/挑选/失败替换。每组一次公开 API 证明、逐导航原生0+1读取与内容检查。服务端/图片缓存可随顺序和重建变化，不用LCP差值单独推导因果。六份报告是有界诊断，不是正式63次或RUM。

主要可证伪预测：候选实际收到的公共CSS不再含内部样板规则，总CSS资源/传输量减少；字体字节和UI原样式文件不改、内部样板仍有完整样式。只有浏览器真实下载证明和UI回归共同通过才接受此切片，不预承诺LCP达标。用户可见样式若变化或内部样板缺失则拒绝候选。

新静态隔离测试先RED，再实施和GREEN；更新 composites 旧静态门时保留缺失/错误路由导入的反例。受影响测试、全仓check:dev、对应静态门及内部浏览器、adapter/artifact、秘密扫描、非作者复核/S.U.P.E.R；原5042未跟踪逐SHA保护。root统一运行构建/真实服务/Chrome，子步骤不并行重负载。

浏览器偶发BeginFrame等待另由精确版本源码与已有trace审计处理，没有可绑定sink的证据前保持UNKNOWN；不继续相同类别随机补采。P3-06整体IN_PROGRESS，29/2/18及外部验收边界保持，仅本地提交。
