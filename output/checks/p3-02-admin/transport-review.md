# P3-02 传输收敛与独立复核记录

状态：传输定向验证、默认协议（957 断言）和完整 UI（1003 断言）均通过；两模式各 306 次 setup API 请求。源码/文件清单已冻结；全仓门禁待总报告收口。

## 作者自查

范围：新增 admin-session 合同/port/Application/PostgreSQL、session/workspace API routes/compositions、Next BFF 固定 operation/server client、TEST 配置与真实 HTTP/浏览器 fixture。

- 浏览器正文不能携带 actor/session/请求时间；session 与 CSRF 由固定 cookie/header 信封注入，数据库是当前授权真相源。
- BFF operation 固定注册，不能构造任意内部 URL；严格 action-specific 请求/响应，保留原有 route 独立授权。预览仍采用独立 token-body 边界。
- 只有显式 TEST 组合安装新私有 routes；管理 BFF 默认禁用，仅 development loopback 配置能开启。既有 production composition 不自动开放 TEST 后台。
- 错误、解析失败、超限、未知路径均保留私有响应头；日志与诊断不输出凭证、签名 URL、正文或 SQL 参数。
- session 观察不缓存权限；真实 HTTP 已覆盖同一 session 的 locale 和 permission 撤销后立即改变响应、拒绝后续目录操作。
- 组合只关闭自己持有的池，借入存储不关闭。独立评审发现的构造失败泄漏有确定 RED → GREEN，已补严格类型和 close-once。
- code-simplifier 收敛限于固定分支、帮助函数与格式；未更改旧公共合同或授权语义。实际浏览器测试避免瞬时通知文字，使用 HTTP 成功、重新读取的字段和状态验证持久结果。

## 非作者复核

Carver (`/root/content_review_audit`) 只读检查 session/API composition 与 BFF/预览清理边界，提出构造配置强制字符串与池释放问题；修复后再审 ACCEPT。具体 RED/GREEN 路径见相邻 transport-README。预览问题经真实接口诊断定位为临时派生桶 CORS，3 AVAILABLE 的后端结果未被改写或放宽。

Root 独立查看中文桌面与泰语手机截图，层级排版可接受；完整交互及最终检查结果以总报告为准。作者自查不替代独立审查，也不代表整个项目生产上线。
