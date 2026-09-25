# PostgreSQL publication preflight：整仓失败只读复核

结论：**自然失败未复现，原因尚未确定；没有修复声明，也没有修改产品、正式夹具、工具或断言。** Root 可保持源冻结，从头重新运行完整检查并保留此前失败。

## 已有失败能够证明什么

原始全仓记录为 `full-check-attempt-2.log` / `.json`，仍由 root 原样保留。其安全定位信息是：

- stage：`NORMAL_TRIGGER_FIXTURES`
- check：`NONE`
- assertions：`0`
- 外层 code：`ASSERTION`

这里 `ASSERTION` 是主脚本对缺少 `error.code` 的错误所设的默认标签，**并不证明发生了 `AssertionError`**。`packages/persistence-postgres/scripts/postgres-publication-preflight.mjs:64` 设置该阶段后调用整条 seed；第一条主脚本 `equal()` 在 seed 返回之后。因此只能确定主脚本首条断言尚未执行，不能把失败归到后面的 canonical 五类检查或政策准备度断言。

该阶段覆盖以下实际链：

1. `seedPublicationPreflightFixtures` → `seedResourceManagementFixtures` → `seedContentAuthoringFixtures` → `seedAdminContentFixtures` → catalog seed；保持普通约束与触发器。
2. 通过真实 authoring repository 读取并 COPY 五类内容。
3. 通过真实 base review 读取/提交/批准七语；随后读取新快照并处理 alias/detail 扩展审批。

最外层 `withEphemeralPostgres` 的源文件 `src/testing/ephemeral-postgres.ts:211` 对非 `EphemeralPostgresError` 创建新的通用错误。其构造器 `:26` 只接受 message，不传 cause；编译后的 `dist/testing/ephemeral-postgres.js` 相同。因此原失败的 SQLSTATE、结构化返回码、原始堆栈与内部 seed 步骤未保存在可安全取出的 cause 中。外围 catch 无法从该旧错误恢复根因。

主脚本的 Pool query 包装在 SQL 执行失败时可记录安全 SQLSTATE，但直接 seed Client 不走该 Pool 包装；而 repository 返回 FAILURE 或纯校验抛错也不必产生 SQLSTATE。原记录没有足够信息区分这些分支。

## 时序与既有模式核对

- 本脚本只迁移至 `0017`，不执行这轮较新的 `0022`。未见本次迁移 head 兼容假设引起该阶段的直接必败条件。
- session 夹具默认有效期为 3600 秒，当前调用未覆盖该值；不是此前 1–3 秒短会话正例夹具。
- 基础 authoring 夹具使用固定历史审批时间；新 authoring/review 仍走现有真实事务方法。
- policy COPY 从 PostgreSQL 当前时间加 2 秒取得未来 effectiveAt；COPY 后以 PG 实际时间检查生效，并检查 createdAt 不晚于 effectiveAt，使用单调时钟 6 秒截止。这些步骤均在当前粗粒度 seed 阶段内部，但现有失败没有定位到其中任何一步，不能据此推断时钟、调度或政策缺陷。
- 已读 `output/checks/p3-01-publication-preflight/README.md` 的旧政策因果时间修正与微秒保留记录；没有将其旧根因套用到本次自然失败。
- 脚本、其四层相关 fixture 与 ephemeral wrapper 六个实际文件均逐字匹配 `7db722b4`；从 `fd19144d` 到该提交的 PostgreSQL `src` / `scripts` 没有变更。

## 实际独立复跑

在 implementation 工作区运行原命令，不构建、不改源、未加诊断插桩：

```sh
mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/postgres-publication-preflight.mjs
```

结果：退出 0，**166 assertions PASS**，墙钟 5.856 秒。日志：`full-check-preflight-isolated-1.log`；起止时间、退出码、输出 SHA256 及安全过滤规则：`full-check-preflight-isolated-1-meta.json`。本轮 stdout 没有被过滤掉的行。预检程序正常返回，执行完自身 persistence/client 关闭与 ephemeral 容器 finally 清理。

该一次通过仅缩小“稳定必败”的范围，**不能消除原全仓失败，也不能称作修复**。没有再次盲目复跑、没有用重试掩盖失败，也没有更改超时、权限或任何业务规则。

## 后续若再失败

本次不增加插桩或运行第二次 PG。若完整检查再次出现同一失败，可在临时 ignored Node 加载层、进入通用 wrapper 之前记录固定 seed 步骤枚举、结构化 FAILURE code、SQLSTATE 与本仓库文件行号，随后仍抛原错误。不得记录 error.message、SQL/参数、内容、session 摘要、令牌或密钥，不改生产 catch/授权/时间门，也不能先推断应当放宽的条件。
