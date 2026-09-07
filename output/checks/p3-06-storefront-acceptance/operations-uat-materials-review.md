# UAT materials presentation review

2026-09-07，非作者 storefront_directory 只读复审：**ACCEPT**。范围为 `storefront-operations-uat-page.mjs`、新 `storefront-operations-uat-material-view.mjs` 及对应测试，并核对既有 materials、准备文件 hash、controller、recorder 和 translation binder 接线。没有修改源码。

- 新展示按“替换素材”“艺人英文”“礼物英文与规格／价格”三组组织；字段名与策略使用中文，英文源字段、资源名称、唯一规格、实际 TEST 市场／币种／10.00 仍直接来自本轮准备材料。艺人和礼物 HTML 正文字段按原始文本呈现，可原样复制。
- 完整材料在没有 `open` 属性的原生 `details` 中，默认关闭；全部七语、资源 ID、版本和审核字段仍通过原始 JSON 与下载入口保留。
- 动态标题、说明、字段值、原始 JSON 均用 `textContent`，没有把材料拼进 HTML。复制使用与显示一致的 `String(value)`。独立 VM probe 运行实际 client，以含标签和事件属性的字符串验证只写文本、复制精确一致、没有 `innerHTML` 写入；该 probe 不代表真实浏览器视觉验收。
- 展示 helper 是纯投影，调用前后的材料序列化与 hash 不变。准备文件仍为 `JSON.stringify(materials, null, 2) + "\n"`，`materialsSha256` 仍计算这些磁盘原始字节。下载入口沿既有 controller 返回等价的紧凑 JSON；不能把其字节 hash 宣称为磁盘准备文件 hash。
- 初始 client 只 GET `/state` 和 `/materials.json`；展示与复制不会 START、FINISH、调用业务写操作或暂停计时。开始／结束仍须真人点击，结果仍等待独立人工复核。binder 继续严格校验真实导出的目标、七语顺序、英文源和唯一实际规格，仅替换 entries，保留 revision、source hash 与导出凭据；实际 Admin 导入、审核和发布仍必需。

独立执行：

`mise exec node@24.20.0 -- node --test apps/api/scripts/storefront-operations-uat-material-view.test.mjs apps/api/scripts/storefront-operations-uat.test.mjs apps/api/scripts/storefront-operations-uat-control.test.mjs apps/api/scripts/storefront-operations-uat-fixtures.test.mjs`

结果 9/9 PASS，exit 0，见 `operations-uat-materials-independent-tests.log`。实际 client 的有界 VM probe 也 exit 0，见 `operations-uat-materials-client-probe.log`；其初始请求只有两项 GET，展示／复制测试没有提交计时命令。Controller 单测仅启动临时 loopback HTTP 服务。

未启动 PostgreSQL、Next、Admin、重建或真实浏览器。root/E2E 重新准备后的实际材料页面检查，以及非开发运营人员真实计时验收，仍是后续独立证据；本文不宣称它们通过。源码与本文冻结。
