# Run 2 精确差异扫描与独立复核

本报告更新当前验收范围为：**原2535文件完整SAST＋1个修改文件的精确差异SAST**。原始完整扫描及全部历史JSON/日志/报告不覆盖、不删除；`scan-final-report.md`和`final-scan-summary.json`仍是run1时点记录，当前范围以本补充及`final-scan-summary-run2.json`为准。

## 输入及结果

run1/source.json和run2/source.json均为2921文件。逐路径SHA比较确认只有`apps/api/scripts/rum-browser.mjs`变化，无新增或删除，见`delta-run2-source-comparison.json`。新完整快照sourceHash为`0d523ce1fd33903d1ca1a01c6cc47f8b91099229ab92d8cbd081798faa15313b`；差异扫描前后该文件与run2 SHA一致。

固定Semgrep OSS1.157.0、同一官方规则commit与494规则配置（SHA在`semgrep-delta-run2-source.json`），metrics/version check关闭、无源码上传/云登录。仅显式传入这一文件：实际168条适用规则、1个目标、0发现、0解析错误、无跳过目标，exit0。没有重扫其他未变化源码，也没有将0目标当成通过。完整证据：`semgrep-delta-run2.json`、SARIF、command/coverage、log.txt。

该文件在原完整扫描中也无发现或解析诊断。因此以差异文件结果替换其旧结果后，当前覆盖仍是2535技术源、130原始候选、11个既有部分解析诊断；既有15处行级人工解释和Low防御缺口继续有效。这是精确增量覆盖结论，不冒称重新完成了整仓扫描。

## 非作者独立差异复核

比较原扫描快照与当前文件，改动仅位于浏览器dashboard断言：

- 原`.notice`匹配在新增integrity notice后不唯一；现在按原有instrumentation说明文本过滤，仍保留“missing INP is never filled with zero”的断言。没有删除或放宽该说明的验证；若再次匹配多元素，Playwright严格断言仍失败。
- 新增实际`#integrity`文字断言，要求42条本地观测页面显示CLEAN/42 retained，空窗口显示CLEAN/0 retained。原42行、数据值比对、local/automated、空窗口INSUFFICIENT与过滤器验证保持。
- 无应用功能、合同、聚合算法、依赖或权限边界变化；没有合成/修改被测指标，没有跳过真实浏览器步骤或把field结论改为PASS。

独立Node24.20语法检查exit0，见`delta-run2-syntax-check.json`。未发现阻断性差异问题；本reviewer没有运行或代签浏览器。父任务的实际run2浏览器验收仍是独立必要证据。

## 其他扫描的时间边界

依赖manifest/lock未变化，原最终audit与官方Next公告核验继续对应同一输入，不重复执行。原秘密扫描结果发生在本次harness修改之前，不能写成覆盖已暂存的最终树；由父任务按原规则在最终暂存后执行。全站CSP/Permissions-Policy、严格nonce/hash策略不完整等Low残余，以及云端/正式composition/staging门保持开放，见原报告。
