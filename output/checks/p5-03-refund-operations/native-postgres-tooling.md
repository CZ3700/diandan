# 本机原生 PostgreSQL 测试工具

Docker/Colima guest 的实际 CLOCK_REALTIME 在同一 SQL 内曾回退约214毫秒；CPU0加长实测仍回退，guest CLOCK_MONOTONIC/RAW 和 Mac 主机采样没有回退。因此保留生产时间校验，改用与 Docker 相同版本的原生 PostgreSQL 18.6 做独立临时集成验收。具体 guest 校时进程尚未归因；没有重启、改时或重配用户虚拟机。

本机没有原生 PostgreSQL。`brew install postgresql@18` 下载并校验了官方 Homebrew bottles，但在已存在的 ca-certificates 链接处停止，未强制覆盖链接或修复/升级整套 Homebrew，也没有启动 brew services。原安装失败日志保留。

已校验的五个 bottles 只解压到本任务 `native-runtime/dist/`（被既有 dist 忽略规则排除出 Git）。依赖安装名只在这些副本的105个 Mach-O文件内做绝对路径重定位，并重新本地 ad-hoc 签名；系统 dylib 未修改。两个原先不存在的工具资源链接 `/opt/homebrew/share/postgresql@18` 与 `/opt/homebrew/lib/postgresql@18` 指向本任务的 share/postgresql 与 lib/postgresql，精确目标见 `native-postgres-owned-links.json`。现有数据库和服务配置未修改。

四工具 `--version` 和完整 `initdb` 实际通过。`native-postgres-init-probe.json` / `native-postgres-init-relocated.json` 保留此前动态库/资源路径失败，`native-postgres-init-ready.json` 为最终初始化成功证据。三个探测仅使用各自新建目录，密码为临时随机值，不进入输出，目录均在探测后删除。bin 路径见 `native-postgres-environment.json`；最终无需 DYLD 环境变量。

此目录保存工具准备证据，不替代实际金融HTTP、浏览器或临时cluster生命周期的验收。普通开发环境可直接使用其正常安装的 PostgreSQL18 bin目录；不需要复制本机的安装处理。未来移除这份本地工具前，先核对上述两个链接仍精确指向清单目标，且没有其运行中的临时数据库，再仅移除本任务链接和工具目录。不要删除或覆盖后来由用户更改的路径。
