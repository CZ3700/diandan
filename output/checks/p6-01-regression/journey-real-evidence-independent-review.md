# P6-01 fresh journey 与受控服务器 abort 实证独立核对

Reviewer `/root/regression_readiness`，2026-09-23。**两份实证在各自标注范围内可消费；fullGate继续PENDING。** 本轮只读既有报告、源码与日志，并运行毫秒级JSON/文件一致性断言，没有启动任何服务、数据库、浏览器、测试套件或构建。检查结果机器记录在`journey-real-evidence-independent.json`。

## 新实例完整链路

`journey-coldstart-fixed-2/report.json`与`browser/report.json`互相对应新实例`test-regression-80b7722b361e4f5b`，实际PASS：

- 七种locale×390/1440两端精确14个唯一case，每个home/artist/gift/cart/checkout/hostedPayment/trustedConfirmation/localizedOrder/localizedMail/secureOrder十步均true；源码视口为390×844和1440×900。
- 28个语言菜单切换覆盖两端×checkout/order×七语，sameEntity/economicStateUnchanged全部true。
- FAILED与CANCELED两条恢复均同购买、私密上下文保留且可显式重试；非法locale404，pageErrors空。
- 14个唯一checkout的创建与28条RETURN查询逐一对应；每组是同checkout+同attempt的REQUIRES_ACTION→SUCCEEDED，stage精确对应。14个离站前同购买检查齐全；报告明确paymentBodyEvidenceScope=RETURN_AND_EXPLICIT_PRE_DEPARTURE_CURRENT，没有把失效旧文档response body冒充已检验。
- 44份截图路径实际存在；本轮未重新视觉判断截图。giftPublicationAtomicity真实计数全部满足已独立复核helper，含正常source draft1及unexpected0。
- fresh这轮postgresDiagnostics为空/40001=0，不能将本次自然成功说成它实际触发并恢复过40001。

## 受控 PostgreSQL abort

`journey-publication-abort-proof/report.json`标注`SYNTHETIC_SERVER_ABORT_AT_PUBLICATION_COMMIT`与`naturalConcurrencyProof:false`，该范围准确保留。另一新实例`test-regression-95caa37cda5c45fd`实际PASS：一次gift完整publication写入后、COMMIT边界前受控服务器40001，后续自动重试提交成功；单gift/head/variant/price-receipt/head/event各1，两个content publication/manifest，每个七语事件与purge组完整，unexpected0。

已读取owned instrumentation真实实现（hash49ae9809fffe757697b8541fe94a5dd643a122f34ca1c567f9c535aa44d60a45）：它只在观测到SAVE_GIFT且management operation更新SUCCEEDED rowCount=1后的首次COMMIT调用处，把将发出的COMMIT替换成同一PG连接上的DO块，由**真实PostgreSQL服务器**RAISE SQLSTATE40001。没有替换业务DTO/响应或伪造持久结果；既有transaction runner收到失败后进入rollback路径，再由已审核应用重试loop开启新事务。下一次完整写入后的真实COMMIT成功；report记录full-write COMMIT attempts1→2。**这是COMMIT边界故障注入，不是声称服务器自然拒绝了原始COMMIT SQL。** 报告没有单独逐条输出ROLLBACK日志，回滚路径由已复核runner源码及随后新事务/唯一持久效果共同支撑。

同次还记录自然price SELECT40001（gift-commerce-pricing-data/write→daily-publication-price），因此此次至少有该SELECT失败加受控40001后成功的完整尝试。仍保持整体SYNTHETIC范围，不能改报“纯自然并发一次冲突”。被控失败和自然price冲突之外，不推断未记录的冲突次数或阶段。

## 源码绑定与隔离限制

9个关键应用与journey文件（center/media/sharedhelper及两tests、publication-state及test、state/main）在当前root、实际诊断owned workspace812f4329及`final-6/source.json`逐字SHA相同；完整映射在机器记录中。final6当时sourceHash为`87f797d19aa12d578a99c487dad2f7640740c58f9547d7d93d1fc0b586ab131c`；本次只认领这9个文件一致，未在P2性能运行期间遍历全仓，也不因此声明整套冻结输入已最终验收。

实际诊断snapshot额外拥有局部SQL诊断/注入hook；`source-sync.json`及两份`instrumentation.json`保留before/after hash与范围。它们未进入root源码，不视为production实现的一部分。root最终final6从正常源码重新构建执行，仍必须单独成功；不能把诊断instrumented运行代替final6。

两个成功新实例都有实际stop/reset命令exit0及对应中文日志，dataPreserved=false；旧失败目录保留。没有重用用户实例或宣称生产/staging/真实商户已验收。

## 后续门

只对这两份真实局部证据给出可消费结论。五组17命令、14要求、完整执行输入指纹、S.U.P.E.R10均等待final6最终结果。P6-02当前仍未激活；届时其旧共享源适用性需补本轮media/sharedhelper变化与新独立review/真实证据，不能沿用旧49共享文件摘要直接宣布就绪。
