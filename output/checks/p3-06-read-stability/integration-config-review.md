# Next 诊断配置兼容修复独立复核

结论：**配置兼容窄修 ACCEPT，实际 Next 复验仍待 root。** 本人独立执行新8tests全部通过；没有放宽生产配置白名单。旧诊断 ACCEPT 报告和失败 fixture 原样保留。

## 旧结论的遗漏与新 RED

此前 `fetch-diagnostics-independent-review.md` 的24个测试证明了原生传输观察、安全字段、默认关闭与preload能力；它们没有把新诊断环境交给应用真实配置解析器。审查也漏掉了这个边界，不能用原 ACCEPT 声称诊断候选已经能在实际 Next 启动。

实际候选 `run-2026-09-16T09-55-50-938Z` build成功而健康检查500。源码明确链路：healthz/route.ts:11–12先调用loadStorefrontRuntimeConfig；server/runtime-config.ts:9–12默认process.env；server-config.ts:558–561调用resolveConfigLayers；config-layers.ts:137–150和180–184拒绝所有不在允许列表内的 `FAN_SUPPORT_*` 键。原两个测试私有键正是未知键；安全 instrumentation 只输出INTERNAL_ERROR，且无匹配业务请求，所以没有fetch诊断事件。

读取作者 `next-fetch-config-red.log`：真实 `@fan-support/config/server` 的 `resolveServerRuntimeConfig` 抛 **ConfigValidationError: Runtime configuration is invalid: environment**，新兼容测试FAIL，原7tests PASS。不是mock或仅源码文本断言。该失败与实际健康门共同否定旧候选的整合可用性；旧证据不删除、不改为成功。

## 修复与范围

只将两测试私有变量改为 `STOREFRONT_TEST_FETCH_DIAGNOSTICS`／`STOREFRONT_TEST_FETCH_DIAGNOSTICS_ORIGIN`，仍要求 `FAN_SUPPORT_DEPLOYMENT_ENV=test` 和显式1。它们由原配置层按ambient环境键忽略，没有加进生产业务键白名单。

`gift-storefront-next.mjs` 的base environment还显式剔除这两个宿主残留键，再仅在已启用TEST start分支重建它们。这个补充必要：改名后原 `!key.startsWith("FAN_SUPPORT_")` 过滤不再自动删除它们，若不补会把宿主诊断参数带入build/default-off环境。原build env、default false、start-only import和loopback目标验证继续保持。

搜索 apps/packages/scripts 未发现旧两个 `FAN_SUPPORT_TEST_FETCH_DIAGNOSTICS*` 名称残留。`git diff --numstat -- packages/config apps/storefront/src`为空；对第一候选2206清单逐文件复算，只发现下列3个预期文件与旧SHA不同，其余旧候选输入保持：

- `apps/api/scripts/gift-storefront-next.mjs`
- `apps/api/scripts/storefront-test-fetch-diagnostics.mjs`
- `apps/api/scripts/storefront-test-fetch-diagnostics.test.mjs`

新测试直接导入真实config包，解析与子进程同种形状的完整TEST环境；校验无异常且deployment=test。并未删除配置校验、过滤process.env后再伪造通过或改变业务请求行为。

## 独立实际测试

```sh
mise exec node@24.20.0 -- node --test apps/api/scripts/storefront-test-fetch-diagnostics.test.mjs
```

本人本次执行 exit0，**8/8 PASS，0fail/skip/cancel，duration168.003459ms**。包含新增真实配置兼容和原7个真实HTTP／preload／安全投影／界限测试。作者另留合并25/25 PASS及format/lint证据于 `next-fetch-config-result.json`；这是作者执行结果，本人未重跑那17个未修改回归。

未启动Next build/server、PG、浏览器或变更源码。实际完整Next fixture与新source freeze仍由root完成；现有 `candidate-source.json` 是修复前第一候选，不能继续当这3个更新后文件的最终SHA。

## 保留限制与复验重点

- 新测试调用真实配置解析器，但没有启动编译Next；待root确认实际health200且匹配home/idol请求输出CREATE/HEADERS/COMPLETE／ERROR，再认定接线闭合。
- 这个修复处理**新诊断引入的健康500**，不是旧中文首页／日文艺人偶发CONTENT_UNAVAILABLE的根因。
- 256匹配请求／768记录后的TRUNCATED、诊断观察成本、COMPLETE不等于schema成功、没有严格跨层traceID等原限制继续有效。
- S.U.P.E.R1–9维持局部TEST职责／单向接线／有界versioned JSON／无新依赖；第10只接受本次8定向tests，不扩大成完整check或P3-06验收。

## 本次SHA256

```json
{
  "apps/api/scripts/storefront-test-fetch-diagnostics.mjs": "8e02cea9b20731445a032d3c6b82b9fa51a9cda17b1685f296315de0a0e032af",
  "apps/api/scripts/storefront-test-fetch-diagnostics.test.mjs": "9371d0cc435c6b673772ffceffa51d091c3f03449ae67896ca1ee00a57088274",
  "apps/api/scripts/gift-storefront-next.mjs": "02a1801b8a6f44308833bf47d78965dac23096171374717d1f4658d55e6787d9"
}
```
