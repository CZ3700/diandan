# P5-08 本地组合失败与修复记录

本文件保留开发中观察到的真实失败，不将局部通过当完整验收。早期报告见 output/playwright/p5-08-local-experience 各时间目录。

- 首次 OIDC：本地 IdP 对 Basic 凭据编码理解不一致；改为严格表单解码后常量时间比较。实际 canonical adapter / 浏览器登录通过。
- OIDC 测试随机失败：state/nonce 的 base64url 随机首字符可能为 `_` 或 `-`，不满足既有合同；测试生成改为明确字母前缀，生产合同不改。首次合并 46 项中 1 项失败，后 46/46 通过；旧 affected-tests.txt 被最终合并结果覆盖，失败细节按本记录保留，不冒称原日志原件仍在。
- 前台缺少 presentation name：正常配置门拒绝；本地入口现在提供明确 LOCAL TEST 名称及可选本地覆盖。
- Next image optimizer：公开衍生图直读200，/_next/image原请求500。已检查安装的Next CLI实现，其HTTPS子进程把NODE_EXTRA_CA_CERTS替换为CLI rootCA。加入 --experimental-https-ca 后，同一实际请求返回200、image/jpeg、8660字节；未关闭TLS校验。
- 首页初始化：普通daily媒体无legacy review，不能伪造；正规新metadata审批可共存，但v2主页正确拒绝双端复用同一original。改用独立TEST双端原始素材，经正常上传/处理/独立审批发布，保留原草稿与资产。
- 浏览器加购：SSR表单尚未hydration时操作触发原生重载；改为以可逆控件交互确认就绪后再提交，不增加固定sleep或放松业务断言。
- 用户收件箱入口：邮件登录解析fragment中的token参数；统一launcher已修正为#token=并补回归，凭据不进入HTTP query。
- 停止/reset：停止失败不能仅凭控制端口关闭宣称成功；匹配run证据、保留失败锁和PostgreSQL存活记录，显式reset只删已停止且绑定目录匹配的自有容器。
- 工作区陈旧锁：独立审查真实并发复现二次回收删除新owner；已改为独立UUID选择/票号仲裁；实际8进程及128轮竞争通过，root已逐行非作者复核。

- 签名回调503：本地API组合未启动既有telemetry，入队trace carrier门正确拒绝。为API和独立Worker按生命周期启动/关闭观测后，真实原签名事件从503变202×2，inbox恰1、无二次收款；正式webhook/schema不改。
- PSP回跳停留：首个可信查询可能仍为REQUIRES_ACTION，旧自动查询条件漏掉该状态。生产前台限定有效回跳上下文继续有界只读轮询，不重发支付命令；新增测试先RED后27项受影响测试PASS，并要求FULL浏览器验证同一attempt和创建恰一次。
- 本地首页locale来源检查：完整locale-keyed副本被合同工具拒绝；提取TEST文案函数并沿用canonical SUPPORTED_LOCALES枚举，正常已有文字不变。合同检查复验PASS。
- 完整入口不能信任局部通过：新增首轮或重启PARTIAL_PASS测试原实现两项失败；入口现在仅接受PASS和factsPath，其余停止自有进程、保留数据且不reset。7项回归通过。

- 第一轮统一fresh验收：`acceptance-60e60dfa0a79411cbc94`，422断言后在第二笔待付款取消的列表搜索等待失败；原管理中心详情需先返回列表，同section点击并不会清除详情状态。支付本身已用原attempt从REQUIRES_ACTION自动查询为SUCCEEDED（create POST恰1），且安全查单/留言审核/送达/全额退款通过；本轮仍整体FAIL，自动停止且数据保留。
- 实际查看七语PNG发现部分首页只含加载占位，原截图函数对零img集合错误放行。该证据不算成功页面；补明确canonical主内容和已发布艺人、图片、市场/政策完成门后再整体验收，不能用该轮图证明视觉完成。
- 首次secrets检查exit2：初期手动IaC初始化留在源码树的约806MB provider二进制超过Node string上限。将本任务生成缓存逐SHA保持后移入既有依赖缓存目录，未改scanner规则或隐藏源码。第二次原secrets命令exit0；离线正式入口本来在独立临时目录运行并清理，不再生成该源码树缓存。

- 第二轮fresh验收：`acceptance-4eb815216d2646dd88c0`，40断言后英文礼物页政策数量检查超时。正文与页脚都使用GiftDetailPolicyLinks，旧选择器合计了两个政策组，却要求总数4；正在按实际DOM逐组验证4种政策。实例自动停止，未进入付款，数据保留；最终不能沿用本轮FAIL为成功证据。

- 第三轮fresh验收：`acceptance-90a4fd436ea943abbdb9`，591断言；七语双端真实PNG已加载并root目视确认，付款原attempt REQUIRES_ACTION→SUCCEEDED、签名provider确认2/inbox2、一次capture、退款成功。第二笔待付款单取消前，返回列表后的搜索未找到行（orders-list HTTP200×2）；PG只读确认未付单存在。按实际请求/响应定向诊断，保留本轮FAIL，未假称取消/重启已通过。

- 第三轮取消定位与GREEN：实际浏览器证明旧detail→back引起列表effect重挂载，过早fill的新UUID被旧query覆盖；API正确按旧UUID返回旧单。脚本改为消费back实际LIST响应后再填写，提交时同时核对真实request.query和canonical response目标UUID。定向`FINAL_OPERATIONS/PARTIAL_PASS`215断言完成原未付款单UI取消、双人七语支付配置两次发布/回退及三类内容snapshot，没有重复付款/退款；随后仍必须完整fresh及重启才能验收。

- 定向真实重启先行：重启后原退款ID/金额和原订单已经canonical读回，随后礼物购买控件等待失败。验收脚本重启URL只带艺人，遗漏首轮明确选择的market/currency；产品正确要求独立市场选择。修复应在首轮保存管理中心价格的canonical市场/币种，在重启沿用该上下文，不能从locale推导或放宽生产条件。

- 重启定向GREEN：原market/currency经管理UI canonical price只读补证31断言(PARTIAL_PASS)，不按语言或硬编码猜测；修复后完整RESTART109断言PASS，退款ID/金额、内容/图片指针、取消单和支付配置均一致。此定向通过不替代最后新实例FULL→RESTART统一入口。

- 最终新实例统一验收GREEN：`acceptance-e143d720dd1a4357a3c3` FULL799/18场景及RESTART109/1场景全部PASS，55PNG/55axe零违规、零incomplete、零pageerror；停止保留且再次只读核对已退款/已取消两单、capture1/refund1/回执2。此前失败与PARTIAL结果保留，不替代本次成功依据。
- 最终截图开发提示：私密订单页Next开发徽标1 Issue，独立诊断确认是React开发版eval调试堆栈探测被正确CSP拒绝的console.error，业务读回已通过；保留原CSP，未隐藏提示或放宽unsafe-eval。0pageerror不表示0console消息；安装的production对应文件无此探测，不据此冒称真实生产浏览器已验收。详见`root/development-csp-note.md`。
