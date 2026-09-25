# TEST 网关逐跳响应头独立复核

结论：**当前窄范围 ACCEPT，无阻塞发现。** 修复了已证实的 TEST 网关错误透传上游连接生命期／逐跳头；不能据此宣称旧中文首页和日文艺人页自然失败已定位或已修复。

## 源码与行为

审查 `apps/api/scripts/gift-storefront-next.mjs` 的实际 diff：仅增加 `forwardedResponseHeaders`，并用于原 `writeHead`；没有修改 GET、30 秒上游超时、fault 注入、observer capture、body 读取、状态、catch、close 或任何生产文件。

- 对标准连接／分帧字段采用小写集合过滤；`Connection` 指名字段按逗号拆分、trim、小写后同样删除，兼容大小写和多个 token。过滤后的对象新建，不改 fetch 的 Headers。
- 不把上游 `Connection`／`Keep-Alive` 绑定到另一个独立 socket；下游 Node 可按自己的规则生成这两个头和分帧。测试正确允许下游重新生成 `Transfer-Encoding`，而非错误要求所有连接头在最终响应完全不存在。
- 公共端到端字段仍透传；真实 HTTP 覆盖 status 200/503、JSON bytes、Content-Type、Cache-Control、ETag、Request-ID、Content-Length。该公共夹具不是通用认证代理；未扩大至其它网关、代理认证或 Cookie 转发语义。
- 注入故障仍是空 503，且不调用 upstream；observer 抛错仍不改变业务响应。既有迟到 observer 阶段隔离也通过原真实延迟 HTTP 测试。
- 此修复没有新增重试、延长 keep-alive、改变 timeout 或校验／内容证明；因此不会用宽松请求策略掩盖潜在 canonical 失败。

## 独立实际验证

本人执行：

```sh
mise exec node@24.20.0 -- node --test apps/api/scripts/gift-storefront-gateway.test.mjs apps/api/scripts/storefront-acceptance-diagnostics.test.mjs
```

exit 0，17/17 PASS（3 个新 gateway tests + 14 个原 diagnostics tests），Node 报告 duration 202.948458 ms。真实本地 Node HTTP server／native fetch，未启动 Chrome、数据库或 build。原 RED 由作者提供并保留：3 测试中 2 FAIL，分别是 upstream72 秒 lifetime 透传和 Connection 指定头透传；本人未为再次造 RED 回滚共享工作区。

独立读取作者 `gateway-headers-result.json`，其修改后两个文件 SHA 与本次核对一致。format/lint 通过为作者所留证据，本人不将它们称为独立重跑。

## 证明边界与既有未覆盖项

- `gateway-keepalive-actual-close.json` 显示原 gateway 声明 timeout=72，而约 6003 ms 结束 idle socket，证明协议声明错误。
- `gateway-keepalive-boundary-probe.json` 41 个自然边界 fetch 全成功，证明尚未复现旧自然页面错误；旧两轮 formal 的错误页不能删去或改为 PASS。
- 新测试第二例期望 timeout=5，适用于项目固定 Node 24.20.0 的默认值；不是跨任意 Node 版本的承诺。第一例同时读取实际默认值，独立验证不应宣称上游72秒。
- 原实现先 writeHead 再完整读取 body、以及 fetch 解码后的 Content-Encoding／Content-Length 对齐问题均不由此次 diff 引入，也未声称已验证所有压缩／截断／stream 响应。当前真实 API 公共 JSON 夹具与新明确问题足以支持本次窄修；不应扩张为通用代理安全认证。
- `read-chain-review.md` 记录的 PG canonical 二次分类问题仍为独立未修改项，不应因 gateway 17 PASS 宣称消失。

## S.U.P.E.R

1–2：helper 只负责当前 TEST response 的逐跳头过滤；server 继续原职责。3–4：无反向／循环依赖。5–6：标准 Headers → 普通头对象，无新跨业务合同、私密状态或非序列化业务 I/O。7：无新增站点／密钥／部署参数；测试 localhost 与72秒值仅构造反例。8：只用既有 Node 内置依赖。9：局部 helper 可替换，不涉及内容、事务或生产 BFF。10：本次定向 17 tests PASS；全仓检查、正式 P3-06 performance 与人工门由 root 继续，本报告不替代。

## 本次读取的 SHA256

```json
{
  "apps/api/scripts/gift-storefront-next.mjs": "b97afc205a0b5466aafa491c8d1f9b6818798d505dfc908883fc0e655cfae2df",
  "apps/api/scripts/gift-storefront-gateway.test.mjs": "b911dfa68ce4ad0d910c27475590e6371a1dcb8dd3f082f42590e919e717d334",
  "apps/api/scripts/storefront-acceptance-diagnostics.test.mjs": "4e39e93a147fe76baef22a8c992da0801c49e656d1fde3bd789ce2b79dc22f80"
}
```
