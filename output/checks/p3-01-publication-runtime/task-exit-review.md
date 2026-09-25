# P3-01 退出条件复核

状态：ACCEPT。最终全仓 `pnpm check` exit 0，18迁移/141表、真实PG/HTTP/S3与浏览器门禁全部通过；独立规范/质量复核 ACCEPT。P3-01 由 IN_PROGRESS 经 REVIEW 转为 DONE，Phase 3 保持 ACTIVE。P3-02/03/04的任务依赖全部完成且Lane空闲，现为READY；全局18 DONE / 3 READY / 28 PENDING，总计49。

| 退出条件 | 实现与证据入口 |
| --- | --- |
| locale-aware 内容与目录查询 | 2A 真实120项目录/分页/anchor/cursor；本轮五类单对象七语言 HTTP |
| 艺人别名、礼物结构化详情 | 2B/3A/3B持久稿件与独立审核；本轮发布manifest、公开扩展DTO和名字/别名投影 |
| 横竖原图与角色构图 | 2B真实Sharp/EXIF/派生图；4B授权登记/版权；本轮TLS S3→处理→metadata发布→衍生图字节核验 |
| 当前授权、审计、幂等、并发 | 3A/4A/4B基础链路；本轮每次重放重新授权，两个发布命令一成功一冲突，审计失败完整回滚 |
| 七语言不可变发布与回退 | 0018真实manifest/当前源记录/审核/媒体/receipt hash/head/outbox原子证明；历史回退追加事件 |
| preview no-store、撤销和期限 | 已验收4A五类受控preview；本轮旧HTTP回归随全仓check重跑 |
| locale cache隔离、可查失败与重试 | 正常worker调度驱动真实loopback HTTP缓存；SUBMITTED与COMPLETED区分，七语言FAILED→授权新代重试、重启恢复 |
| 本地发布≤60秒可见 | 本轮真实HTTP缓存和默认worker调度通过固定60秒期限；check中10,464断言/1,335请求，详见validation.json；云CDN延迟留给部署门 |
| 验证与独立评审 | validation.json / independent-review.md / transport-review.md；最终全仓check和浏览器报告 |

本任务完成不等于Phase3退出。后台业务页面及相应艺人/商品/价格/库存管理由P3-02/03完成，真实前台和目录交互由P3-04/05接入，SEO/七语言页面/运营计时与性能门由P3-06验收。正式登录发行、生产CDN、正式素材、PSP和staging不在本轮本地验收结论中。
