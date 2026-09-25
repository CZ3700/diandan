# P4-03 合同、纯领域与端口

作者范围：新增 checkout-preflight 合同（命令、内部事实、公开视图、库存计划）、五方法持久化端口、库存选择/递进预占与公开历史投影，以及三个包的必要导出。没有修改旧 order/cart/payment 根、SQL、PSP 或 UI。

实际验证（Node 24.20.0）：

- `contracts-first-red.log` 6 个有效失败、`contracts-internal-red.log` 3 个、`contracts-public-red.log` 2 个；`contracts-media-binding-red.log` 记录真实 metadata 绑定负例。
- 最终 `contracts-scope-final.log`：3 files / 12 tests PASS。
- `domain-first-red.log`：5 个有效 assertion 失败；`domain-all-bindings-red.log`：到期空计划、历史 receipt/cart、观察时序与保存身份的实际缺口。
- `domain-final-green.log`：完整 domain 23 files / 167 tests PASS。`domain-full-green.log` 名称虽含 green，实际旧导出清单 1 FAIL / 166 PASS，已保留并精确新增四个函数清单后通过。
- contracts/domain/port typecheck 均 PASS；三个包 build 均已 PASS。`domain-first-build.log` 曾因未公开旧 Apply 类型失败，使用原公开 Decision 的 Extract 修正；没有扩大旧 exports。
- 15 个作者文件的 `contracts-domain-format-final.log` / `contracts-domain-lint-final.log` PASS。源码摘要见 `contracts-domain-source-freeze.json`。
- `contracts-full-green.log` 实际为 389 PASS / 3 FAIL，全部属于 root 正在更新的 artifact paths/version-policy/freshness；不得把文件名当通过。最终产物与旧根兼容检查由 root 集成收口。

库存为确定性 largest-first/best-fit：同一 target 的可用量累计，CREATE 使用实际锁定行递进 balance/version，单行绝不跨库位拆分。它不搜索所有组合的装箱最优解；无法找到方案时安全返回库存不足。PROCURE_ON_DEMAND/PREORDER 不造库存或预占。所有金额继续复用原纯函数及 quote 合同。

公开视图显式挑选字段；不暴露联系邮箱、私密留言/署名、intent/profile 标识、对象 key 或密文。每日原文与 legacy approval 分支独立，政策保持请求语。media alt 的 publication witness 是证明它的父内容发布，metadata revision 则必须与 alt revision 完全相同。

S.U.P.E.R：1 单一模块职责、2 单一决策目的、3 单向依赖、4 无新增循环、5 跨模块 Zod、6 JSON 输出、7 无部署值硬编码、8 沿既有 contracts 依赖、9 port 可替换，均在作者范围 PASS。10 为 PARTIAL：作者定向验证通过，集成 artifact/真实 PG/HTTP 尚由 root 与其它代理执行，不能据此宣布 P4-03 DONE。

code-simplifier 只收敛新增结构：库存分配与公共投影分文件；公开字段显式映射；复用既有预占算法与金额模型；未增加通用工作流或装箱求解框架。
