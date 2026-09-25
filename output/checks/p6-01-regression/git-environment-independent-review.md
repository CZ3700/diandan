# P6-01 Git ambient 环境隔离独立复核

Reviewer `/root/regression_readiness`，2026-09-23；作者root。**源码与轻量验证限定ACCEPT，无剩余明确P1/P2；不是fullGate验收。** 本review仅运行自有临时repo的轻量测试，不启动PG/浏览器/应用服务，不改作者源码。

## 入口布线

统一`regression-environment.mjs`移除所有键名前缀`GIT_*`及既有`FAN_SUPPORT_*`，只对journey恢复原FAN_SUPPORT_LOCAL_POSTGRES_BIN；PATH、DISPLAY、GITHUB_ACTIONS、ADMIN_FINANCE_TEST_POSTGRES_BIN等主机工具输入继续保留。原runner re-export保持兼容，没有改低层runRegressionCommand显式env的调用语义。

逐处查验全部执行路径：

- `readRegressionInventory`的两次git ls-files使用source环境边界；不会因GIT_DIR/WORK_TREE/INDEX等误枚举另一工作树。
- CLI sourceHead的git rev-parse使用相同source环境边界。
- initialize/index/commit/frozen-install四个preparation步骤显式传入preparation清理环境，防止owned commit/add被重定向到用户repo。
- 每个suite的每条命令在runRegressionSteps中重新应用对应suite环境；内部pnpm和已有collectGit子进程继承已隔离环境。

本review指出过另一个直接测试入口遗漏：旧workspace删除/复制用例的git init/add未显式env，直接在受污染shell运行时仍可能指向别的repo。作者已对这两处加入文件级cleanGitEnvironment；重查测试内其他git调用也都显式使用独立去GIT环境。没有放松GIT隔离或通过隐藏测试规避此项。

## 独立实际验证

以Node24执行`node --test scripts/regression-runner.test.mjs scripts/regression-workspace.test.mjs`，reviewer启动环境先排除外来GIT_*（各反例在其自有子进程中显式注入），最终 **10/10 PASS**：`git-environment-independent-final.txt`。其中实际创建两个独立临时repo，向被测runner注入control的GIT_DIR/WORK_TREE/COMMON_DIR/INDEX_FILE；证明control HEAD/index字节/未提交worktree内容保持，owned新commit只有owned文件。另一个真实子进程以外部repo Git环境调用source inventory，仍只返回source文件。未触碰用户repo提交/index。

作者报告的原3RED/7PASS、10GREEN及全scripts20PASS分别保留于`git-environment-red.txt`、`git-environment-green.txt`、`git-environment-final-tools.txt`；本review只认领上述独立10测试与源码布线。没有运行完整verify:regression或声称其通过。

## 最终hash

- environment `39e0fcc5e141fe80eb45bebca759bc52ba1dbe8dd0991700de90d383b8bee05d`
- runner `49e9bcd986f718ca1fa3dff8cc4a02b2e79866626eb8df33169c514c1610897a`
- runner test `bda5872aa1e43eabd2f79ffc5e5c1cc9c0255ced626129e802e8fbfb494f6a34`
- workspace `74cbdb1c0aa0d8e424521ac1a34799399b2647133d72f145125a3ac934ef17f6`
- workspace test（含旧两调用修复）`a579c00db7e32fe3716fab20c823a0d82b1f5a5ad6c68185ef33aa36118b4027`
- CLI `cfdf307d7705a0a81c81b6b38870286d8752375e0cf27cdec0f973aef26ee79c`

范围为回归测试入口环境隔离；不宣称通用沙箱、全局Git配置审计或任意调用方自动安全。公共合同/迁移/业务语义未变；最终五组/17命令/14要求和S.U.P.E.R10仍PENDING。
