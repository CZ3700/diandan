# P3-06 transport 工具与诊断独立复核

2026-09-21，`/root/scheduler_audit`。复核范围为新增 TEST proxy/测试、一次性 runner、离线 reader 与固定 ABBA 原件；未运行测试、浏览器、构建或模型重放，也未修改这些文件。

**工具实现与诊断的如实归档可局部 ACCEPT；整个 transport fixture/reader 仍 FAIL，不能宣称性能阶段完成。** `analysis-summary.json` 的12份有效原始导航与 `wholeTransportGatePassed=false` 并不矛盾：首组两条事后取消违反预注册的全代理请求完整性门，原失败必须保留。

## 实现及绑定

- Proxy 共用一个 HTTP/2 compatibility server、ALPNCallback 和原始 `http.request`/pipeline，H1/H2仅改变协商选择。读取限定loopback upstream，GET/HEAD、origin-form及authority校验、hop-by-hop头清理、原压缩实体透传、deadline、上游/客户端中断与owned清理均有明确实现。早期`:scheme`冒号错误及localhost IPv6问题已修，20项最终GREEN覆盖实际TLS/ALPN、拒绝未知CA与错误SAN、压缩字节/状态/HEAD/query、流式并发、取消及关闭；没有新增依赖或产品逻辑。
- Runner 在一次callback中复用Next generation=1、同viewer origin/证书及构建，固定H1/H2/H2/H1各3次，四组均使用原源码模式candidate（0+1读取）。每组新建原Chrome，未增加renderer标志或SPKI pin；Node显式CA验证与浏览器既有pin豁免分开描述。原canonical仍指向HTTP upstream，因此无SEO或生产证书验收结论。
- 最终snapshot在close之后取得，324条记录、active=0、overflow=0、closed=true。独立核对四组连续切片（每组81条）均与最终全量数组逐项一致；所有记录ALPN/httpVersion为H1组`http/1.1 / 1.1`、H2组`h2 / 2.0`。四份Node探针证书hash/TLS版本/hostname相同且explicit-CA授权成功；不能把组级探针冒称逐CDP请求的TLS连接绑定。
- Reader 将原件/replay有效性与transport门分别保留。原件缺失不再因失败占位误算12；slice检查不再因首组失败连带污染后组。四组发布响应与fixture manifest按原字节及JSON比对，metadata observedAt不要求相同。原始设置、内容审计、native窗口、五项replay输入绑定、字体与终点链字段都与既有产物schema吻合。没有新采样或调整模型截止点。

独立重算全部 **108件原始capture文件、157,855,983 bytes** 的长度与SHA，全部相符；12份LHR设置和launcher对象一致，原始0+1读取证据由reader重建通过，12份已存在的官方FCP/LCP重放共24项差值为0。本人另外核对各终点链的duration+wait之和与终点时间一致，三样本中位数重算吻合。这个链分解只跟踪latest-finished显式依赖，不能当作带宽争用因果图。

`source-after-capture.json` 记录在2026-09-21T15:53:18Z复核2348冻结输入且changed=[]。fixture准备会产生新BUILD_ID：预先构建的`ynvWG4f8UH2_h8SoClzAO`变为fixture的`dRjFwmkYTpRBHkzNu7Akl`；四组测量内使用后一相同值，不声称整个准备期BUILD_ID未变。本人确认proxy、proxy测试及runner三项当前SHA仍与冻结清单对应项一致；2348项全量“测量前后未变”依据root当时记录，不冒称在后续font-range子检查点开始后重新证明所有当前文件未变。

## 结果与未通过项

| 固定组 | 模拟LCP中位ms | 实测localhost LCP中位ms | 各次LCP乐观图字体数 |
| --- | ---: | ---: | --- |
| H1-a | 2776.9867 | 294.242 | 9 / 0 / 0 |
| H2-a | 2255.7439 | 286.875 | 0 / 0 / 0 |
| H2-b | 2255.2436 | 282.484 | 0 / 0 / 0 |
| H1-b | 2868.2760 | 286.025 | 3 / 0 / 0 |

12次实际CDP均有九个字体响应；图中0个字体表示模型按观察到的paint截止筛掉了这些节点，不是浏览器没有下载字体。H2组本地模拟中位较低、通过该局部collector预算，不证明真实用户p75达标，也不能把全部变化归因为协议。旧失败结果、服务器/图像缓存与顺序、模型图截止和首次取消副作用仍限制因果解释。实际浏览器为 **Chrome/153.0.8010.48**。

h1-a的代理26/27为0-byte CLIENT_ABORTED。其开始时间位于第1次trace末尾之后约1.79s、image LCP之后约4.24s；测量中的LCP图与九字体均完整。具体触发动作与query/图片宽度无法绑定，不能直接称“非LCP图片被截图取消”。详见 `aborted-request-audit.md`。首次fixture exit1与reader exit1均保留，没有重采或将首组改绿。

独立从324条记录重建完整GET200的静态实体集合，确认 `successful-entity-comparison.json` 的 **22个pathname** 在四组的SHA/长度/encoding集合逐项相同，明确排除且并列的失败恰为h1-a 26/27。它是成功实体子集的一致性证明；不证明每个image query对应同一实体，也不使全transport门通过。该补充没有覆盖原始FAIL。

质量日志：受影响41tests PASS；proxy20项最终GREEN；check:dev首次因reader lint失败保留，修正后exit0，types/tests各63/63（62缓存）、build36/36（35缓存），adapter/artifact exit0。真实协议32,461 assertions通过，但fixture总体exit1。四组官方重放各exit0，reader最终按证据返回exit1。后续reader校验拆分由作者单独format/lint；不将较早check:dev扩大为之后所有新增代码的统一验收。此切片未新增七语UI、物理设备或RUM证据，未声称完整`pnpm check`或新提交秘密扫描已完成。

## S.U.P.E.R（新增工具范围）

| # | 检查 | 结论 |
| --- | --- | --- |
| 1 | 文件单责 | PASS：代理/测试、编排、离线解释各有职责。 |
| 2 | 函数单责 | PASS：转发、失败终结、协商/清理、schema验证与汇总可区分。 |
| 3 | 单向依赖 | PASS：TEST工具消费既有runtime/collector，未侵入业务核心。 |
| 4 | 无环 | PASS：新增工具没有反向导入或循环。 |
| 5 | 明确接口 | PASS：输入边界显式校验，结果schemaVersion=1，读取既有产物有断言。 |
| 6 | 可序列化I/O | PASS：快照与证据为JSON；socket/函数仅作callback内生命周期句柄。 |
| 7 | 外部配置 | PASS：端口/证书路径来自fixture；固定media域名仅为既有TEST约定，无生产配置硬编码。 |
| 8 | 声明依赖 | PASS：沿用Node与既有依赖，未加包或改lockfile。 |
| 9 | 可替换模块 | PASS：独立TEST代理接口可替换，应用源码不依赖该实现。 |
| 10 | 验证 | **部分通过、完整退出未满足**：工具tests/开发质量门通过；预注册fixture及reader整体FAIL仍在，性能/真实用户/人工/上线验收未满足。 |

按code-simplifier做了只读收敛审视：明确计划槽位、实际采集、原件有效、transport完整性四种口径已有实际收益；不建议为缩行改动冻结的ALPN/流转发/cleanup，也不增加通用测量框架。后续font-range工作属于另行登记的应用候选，本报告不提前接受其代码、字节收益或浏览器表现。
