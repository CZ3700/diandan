# final-8 commerce 证据只读复核

复核者 `/root/regression_readiness`；2026-09-23。结论 **ACCEPT_COMMERCE_ONLY_FULL_GATE_NOT_ACCEPTED**。cart、payments、orders 三条命令与原 plan 顺序一致，均 exit0、无 signal/launch failure；只读取本次实际报告、日志与冻结 harness，未运行服务、浏览器或测试。源码输入指纹为 `642a55a818680d763f41ce5d87b5386092591ea5341c92ce4e88c8248bcb8b72`。

## 已核实的本地证据

| 套件 | 实际结果 | 明确保留边界 |
| --- | --- | --- |
| cart | 5924 checks，4条HTTP复合场景；浏览器20 cases/40PNG/30axe，七语言×390/1440的14个购物车及抽屉组合；0violations/0pageerror，所有主矩阵无横向溢出 | 抽屉14条 `aria-hidden-focus` incomplete、140个节点；不能等同完整无障碍认证 |
| payments | 7077 checks；浏览器31 cases/71PNG/57axe，14空购物车及14托管回跳，71次截图时均检查实际viewport无横向溢出，0violations/0incomplete/0pageerror | 独立持久TEST HTTPS PSP；actualPspSandbox=false，回跳本身不把订单标记已支付 |
| orders | 7429 checks；25 cases/55PNG/55axe，14七语双端订单查询矩阵；0violations/0incomplete，55次截图无横向溢出；16个带观察器场景均0pageerror、leaked=false | 人工译审/读屏/实体手机未完成；本次原生back navigation确实执行，但actualBfcacheRestoration=false |

全部166个截图存在。三组真实源均与冻结快照内读取的harness一致；证据路径和18个SHA记录于 `final8-commerce-independent-review.json`。购物车双端键盘焦点循环各20次正向/反向，14个焦点元素，均PASS；触控目标、抽屉最终可见及减弱动态另有原报告。不能以这些自动结果抹除axe人工判断项。

## 交易与语言不变量

七语购物车恢复逐项比较market、currency、item ID、数量及金额，普通恢复不读取私密编辑内容；新增、审计私密编辑、版本冲突、同key恢复、删除及不得复活均由原协议与浏览器复合case覆盖。

支付协议七语言明确记录 providerLocale=en，六个非en的fallbackUsed=true；实际en→ja导航对比SQL与HTTP，checkout session、attempt、金额、币种及原下单语言保持，PSP创建次数不增加；14个跨站回跳均保留原attempt及冻结locale。页面刷新不创建新支付。原beginCreate/settleCreate两处真实COMMIT已成功但响应丢失注入各PASS，恢复保持原订单/attempt且总create调用为1；UNKNOWN只经持久timer与认证reconcile恢复，并验证TEST PSP进程重启。

协议已实际验证CANCELED经认证证据后可在同一订单生成新attempt，永久旧key仍回放旧取消结果，重放不再次派发支付。**FAILED/CANCELED两类完整连续浏览器恢复由journey补齐，本组不能替代；final-8该组尚未执行。** 实际延迟到达的捕获、过期订单与重复证据规则另见quality中order-payment实际HTTP/PG报告；此处的普通回跳仍只查询，P4-04测试保留EVIDENCE_PENDING，最终付清状态由orders组签名webhook→worker→canonical订单链验证，不能把浏览器return当成支付依据。

## 安全查单与历史数据

14订单矩阵实际交换和读取的响应均private cache/no-referrer/noindex，fragment在交换前清理，所有fragment事件cleared=true。另包含消耗token重放拒绝、新会话撤销旧会话、跨订单隔离、原始语言查询、撤销、真实link expiry及浏览器session expiry。两个expiry场景等待PG clock跨越真实存储期限，没有缩改存储时间或放宽断言。

订单header实际pt→ja/zh-CN/pt切换保持同订单、历史内容、原locale与全部金额；当前艺人/礼物重新发布、图片更换、价格变化并归档后，历史订单仍保留原快照。financialStateUnchanged=true。

JSON响应丢失两场景明确为NEXT_RESPONSE_BODY丢弃，socketDisconnected=false；discarded-read另为BROWSER_REQUEST_ABORT。浏览器返回后重新授权已通过，但未实际恢复BFCache，不能声称验证了真实BFCache命中。

**落报告时整轮steps已记录FAIL于后续operations，journey为NOT_RUN。commerce局部接受不覆盖此失败；S.U.P.E.R10、P6-01完整本地验收及后继激活继续未接受。** 原远端CI、商户sandbox/真实小额、真实邮件及云staging/灰度、人工无障碍/译审门均不变；此次使用原生隔离PG的通过亦不代表已证明或修复此前Docker时间失败的因果机制。
