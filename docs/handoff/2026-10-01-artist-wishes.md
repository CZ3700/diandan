# 艺人心愿与心愿展馆交接

本项行为权威为 SPEC §0.8 / ADR-023；当前验收状态以 `docs/progress/launch-progress.md` 为准。它不能与先前已部署的海报功能合并理解为已上线。

## 业务行为

后台创建 WISH 必须绑定一位已发布、可收礼的艺人，固定一份资格。艺人详情展示自己的心愿；购买页显示固定收礼人。付款通过既有可信支付链确认且库存成功提交后，一次性记录支持并停售。界面使用 “Wish supported”，准备和送达沿既有履约链独立发生。

买家默认不公开；可主动选匿名或独立公开署名。购物车仍可修改选择；付款后可从安全查单页撤回公开展示。公开署名不取自私密留言/完整署名。展馆保留购买时的商品/艺人/媒体快照及各自来源语言。整行成功退款和拒付 LOST 隐藏公开记录；部分退款和 OPEN/WON 沿已有凭证语义。撤回、退款或恢复内容不重新出售心愿。

## 数据库整合门

- 已合并 Windows L3-12 的 0059（3ddc960e），保留其艺人账本功能；本项0060绑定、0061展馆已纳入连续manifest。
- 早期候选专项只用于独立业务验证，证据保留在output。正式源码已移除未注册迁移旁路，专项严格要求注册头0061。生产服务不含绕过缺表的静默降级。
- 连续manifest/catalog已生成；61迁移、236表的真实PG空库往返，以及108项回退前缀保护检查通过。knownHeads和空库保护表包含心愿7表，未知0062拒绝。最后整链结果以进度和output报告为准。
- 已有绑定或心愿历史时，0060/0061 down 会拒绝有损回退。不要用删表或删历史规避；回滚优先前滚修复并保留订单事实。
- 旧未绑定心愿暂不可买。只有尚未使用、单一TRACKED规格且库存一的旧礼物能安全补绑；旧历史或不可变库存策略不符合条件时，正常新建心愿，保留旧订单，不猜测艺人或追溯公开。

## 复验入口

使用仓库固定 Node24 / pnpm。无真实资金操作；PSP测试是本地签名TEST provider。

```sh
pnpm --filter @fan-support/persistence-postgres migrations:manifest
pnpm --filter @fan-support/persistence-postgres migrations:catalog
pnpm --filter @fan-support/persistence-postgres test:postgres
pnpm --filter @fan-support/persistence-postgres test:postgres:wishes
pnpm check:dev
pnpm check:contracts
```

正式专项包含注册链往返、锁顺序并发和正常后台/付款/展馆HTTP；具体本机启动方式与证据见 `output/wish-gifts-2026-10-01/`。输出目录被忽略，不包含在Git交付中。不要把候选迁移结果、组件浏览器夹具或mock PSP当作公开TEST验收。

## 公开TEST复核

完整链验证、提交推送后，由有TEST部署连接的一端在同版本部署数据库/API/worker/admin/storefront。通过正常后台新建一个测试心愿，验证艺人展示、错误收礼人不能买、正常付款后停售与展馆、隐私三态和撤回。未经授权不动真实资金或正式生产内容。当前Mac没有远程TEST部署连接。

Mac原有Next实例未重启；另一分工曾在主目录执行Next build，原监听仍在但只读HTTP超时，不能声明旧实例健康。此后全仓构建改用独立副本。
