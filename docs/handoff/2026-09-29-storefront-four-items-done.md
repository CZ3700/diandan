# 交接：日常运营体验四项完成 → 下一步继续 L3-10 第 ③ 段

> 日期：2026-09-29
> 执行：Claude（Windows 端）
> 分支：`v2/r1-production`，最新提交见 `git log`；stg 已部署到 2df635af
> 冷启动顺序：AGENTS.md → SPEC §0.3–0.4 → [上线计划](../plan/2026-09-28-flexible-storefront-launch.md) → [当前进度](../progress/launch-progress.md) → 本文件 → [L3-10 设计](../plan/2026-09-29-l3-10-built-in-admin-login.md)
> 上一份交接：[2026-09-29-sync-old-items-and-login-plan.md](2026-09-29-sync-old-items-and-login-plan.md)

## 背景

L3-10（后台内置账号登录）做完第 ② 段时，用户追加了四项需求，要求先处理。四项已全部完成，并在 stg 上用真实数据库验证通过。

## 用户决定（本段新增）

- L3-10 的二维码使用 `qrcode-generator`；后台增加“员工账号”页面。两项都已写入 ADR-021 增补。
- 追加四项需求，先于 L3-10 处理，现已完成：
  - 海报可以删除；
  - 艺人展示框比例要更好看；
  - 艺人和礼物在商城的顺序可以随意调整；
  - 顶部导航做成苹果质感的透明玻璃。

## 已完成

| 条目 | 结果 |
|:--|:--|
| L2-07 顶部导航玻璃质感 | 1a1339e6。半透明主题底色加 `backdrop-filter` 模糊，随配色派生；不支持模糊或用户开启“减少透明度”时退回实色。 |
| L2-08 艺人展示比例 | 1a1339e6。保持 4:5 裁切，卡片约 208px（手机约 42vw），电脑一排约 6 位，手机两张。 |
| L2-09 海报删除 | 78fb6e7c。历史海报由“已被替换”归档为“已归档”，没有新迁移；当前海报由服务端和数据库双重拒绝。stg 端到端：删除后列表少一张，当前海报仍在，首页不变。 |
| L2-10 手动排序 | 2df635af。迁移 0053；商城各列表手动顺序优先；店铺装修新增“展示顺序”标签。stg 端到端：置顶后后台、首页、目录首位一致，恢复默认后回到原顺序。 |
| L3-10 ① ② | 78f0f4d5（凭据原语）、abe32260（合同与迁移 0052），此后暂停。 |
| 0052 修正 | 2df635af 内的迁移 0054。0052 预置的完整权限目录和 16 个真实数据库测试夹具冲突，0054 撤下预置目录和两个未分配的标准角色，只保留 `staff.manage`。完整目录和标准角色改由 L3-10 的服务器命令在创建首个管理员时补齐。 |

## 在途与已知问题

- **既有的真实数据库脚本失败**：三个脚本在 b0270006 上就已失败，不是本段引入，已记在进度表 CI 行，等远端开发者确认：
  - `postgres-delivery-proofs.mjs`：固定迁移到 0040 后调用当前持久层，报 CONFIGURATION_ERROR；
  - `postgres-payment-runtime-parameters.mjs`：PREPARE_27 恢复场景断言失败；
  - `admin-exceptions-postgres.mjs`：收尾时连接被终止（57P01）。
- **CI 三组回归**（quality、catalog、journey/commerce）仍未修，详见上一份交接。
- **stg 访问密码**按用户决定未轮换。

## 下一步：L3-10 第 ③ 段起

范围见 L3-10 设计文档和上线计划 L3-10 一节。按顺序：

- **③ 应用层与 API 路由**：
  - 登录和步骤接口：`/api/v1/admin/local-access/{login,step}`，校验 access key 和 Origin；
  - 账号设置和员工账号：走 `registerPrivateAdminEndpoint`；
  - TOTP 密钥走 KeyManagementPort，用途为 `ADMIN_TOTP_SECRET`；
  - 登录状态机见设计第 3 节，写入 `admin_local_logins`，审计要满足 0052 的触发器。
- **④ 后台登录页与 BFF**，模式为 `LOCAL_ACCOUNT`。
- **⑤ 账号设置**：改密、扫码绑定、恢复码。
- **⑥ 员工账号页面**。
- **⑦ 服务器命令、本地体验与 stg 切换**：
  - 创建首个管理员时幂等补齐权限目录（合同 `adminPermissionKeySchema`）和 `studio:owner` / `studio:operator`；
  - 在 stg 撤掉后台的 Basic Auth，收件箱保留。

要注意：0052 的触发器（审计精确匹配、会话门槛）还没有在真实数据库上逐条验证，第 ③ 段写仓储时要补上。

## 环境注意

- **部署必查**：每次部署后都要抽查动态路由，不能只看首页。
  - 抽查示例：`/en/policies/delivery`、`/en/idols/<handle>`、`/en/gifts/<handle>`。
  - 一旦出现全部 404（`/_not-found`），重启 stg 一次即可恢复。
- **带迁移的部署**：先停机，冷备份实例状态到 `~/backups/stg-pre-<提交>-<日期>`，再构建、启动；回滚版本记在同名 `.revision` 文件。
- **真实数据库验证**：
  - `packages/persistence-postgres/scripts/postgres-integration.mjs --write-catalog` 做迁移往返并生成结构目录；
  - 新增迁移时还要把版本加进 `scripts/notification-rollback-prefix.mjs`，并在它的测试里把“未知版本”样例顺延一位；
  - `test:postgres` 串联执行，前面失败后面就不跑，需要时逐个补跑，记录见 `output/checks/l2-10/remaining-results.txt`。
- **测试夹具**：会直接插入权限键，迁移不要预置其他模块的权限键。
- **排查既有失败**：用临时 git worktree 在旧提交上对照。建在短路径（例如 `C:\Users\admin\wtb`），否则 `node_modules` 路径过长删不掉；用完用 robocopy 清空后再删除。
- **stg 脚本**：
  - 启动器：`output/checks/remote-test/with-stg-creds.mjs`；
  - 本段的端到端脚本：`output/checks/ux-2026-09-29/stg-poster-delete.mjs`、`output/checks/l2-10/stg-display-order.mjs`。
