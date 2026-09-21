# P5-04 应用与组合独立复核

Reviewer：`/root/health_storage`（非本轮 application/contracts/API composition 作者；本人持久层不在此独立结论范围）。只读源码复核，未重复运行全包测试。实际85 PG、26受影响持久测试与5个最终timeout helper tests是本人实现验证，不能冒充本报告对应用的非作者执行。

## 当前结论

**ACCEPT：所复核的冻结本地功能范围没有剩余阻断缺陷。** 两项已证实的阻塞问题已完成修复和针对性补证。root 最终组合 build/check/真实协议仍须通过，本报告不代替发布验收。

## 核对结果

- `payment-runtime-health.ts` 的 `record` 自行处理策略/仓储错误，只返回健康准入结果；`observe` 保留调用原response，调用抛错仍抛原异常。`payment-runtime-execution.ts` create/reconcile/get-action 继续沿原account/attempt/幂等key解析、入账或UNKNOWN/reconcile，不会由健康结果制造金融成功/明确未扣款或换路。
- 新能力读取先初始化策略，再读取provider；监测失败会封闭新准入。已有payment恢复不以健康状态为新选路输入。纯规则/最终PG创建检查负责资金准入，健康probe完全不创建attempt或改变资金状态。
- 分类先严格解析PaymentPortResponse并校验command关联。有效空capabilities记SUCCESS但业务可选列表仍空；停售/金额不适用返回BUSINESS_OUTCOME；拒付/取消/配置故障不计技术故障；实际技术码为冻结五项，无自由错误原文。
- probe只调用GET_CAPABILITIES；超时只生成技术健康结果，不能产生支付/退款；完成前PG持有完整fence并保留永久PROBE证据。应用计时器限制等待；真实已部署网关仍有自己的网络超时，不宣称Promise.race可以取消任意第三方adapter的网络工作。
- production composition要求policy与初始注册账户身份集合精确匹配；缺失/重复/非法策略 fail-closed；TEST老夹具可保持无health兼容。生产optional composition未配置支付时仍不启用真实支付。
- 静态/动态provider重复在旧directory边界即拒绝，历史绑定不得换写/删除；本轮没有恢复已废弃的动态上传adapter代码。

## 已证实的阻塞项与修复状态

1. **健康持久I/O无默认超时**：实际连接配置connectionTimeoutMillis=0且未设置statement/query timeout；观测被await在原mutation settle前，会拖住处理与stop。本人在root授权后补独立健康总budget wrapper及PG LOCAL期限，实际锁阻塞RED→85PG GREEN，迟到连接/永不settle query/COMMIT UNKNOWN和幂等释放有单测；root已独立读helper主路径，25P04亦实际PG验证并修复。该修复不改变普通财务pool超时策略。
2. **每sweep串行初始化最多100个policy**：即使每事务限定默认3秒，故障时单次probeNext最坏约300秒，拖住后继恢复/stop。已只读复核root修复：每sweep至多初始化一个已注册候选账户并轮转，成功初始化的既有账户继续一起交给PG按due公平claim；正常能力读取仍按需初始化。已读取专项测试源码及root记录的 `bootstrap-red.log`（两个用例均证明旧实现一次初始化3个账户）和 `bootstrap-health-green.log`（3文件30项通过）；两个新增用例分别覆盖故障轮转和ready集合逐步积累/缓存。本复核未重复执行这些应用测试。

## 清晰保留的后继边界

- 当前policy是构造期配置且初始化只bootstrap、不可隐式版本漂移。目录热新增account如果没有对应policy会拒绝新准入。P5-05须把policy版本/新增账户与deployed directory的发布广播协调，不能把本检查点描述为已实现完整商户策略热发布。
- 全部停售的有效能力列表分类为BUSINESS_OUTCOME，既OPEN账户保持OPEN，直到成功probe满足当前恢复规则；不增加故障计数。这是当前冻结的保守恢复行为，不是把普通拒付/停售误计为整个PSP不可用。若以后调整通信可用性定义，应独立更改恢复策略与测试。
- 真实商户/sandbox协议、供应商幂等期限、正式生产阈值、真实小额/灰度仍无本轮证据。
