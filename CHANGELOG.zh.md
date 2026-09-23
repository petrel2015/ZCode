# 变更记录

[English](CHANGELOG.md) | 简体中文

仅记录本个人分支的改动；上游历史见 Git 提交记录。当前应用版本仍以根目录 `package.json` 为准，本次没有创建 Tag 或 Release。

## [未发布] — 恢复本地定时任务（Automations/cron）

### 新增

- 定时任务以纯本地能力回归：`CronCreate/CronList/CronUpdate/CronDelete` Agent 工具、`automation/*` RPC 服务与 `tasks-index.sqlite` 本地持久化。
- 恢复桌面端 cron scheduler 常驻进程（认领/派发状态机：misfire 跳过、single-flight 认领、失败退避重试）与 Host 派发链路（`CronRun` → createTask/resumeTask + sendPrompt），支持「立即运行」手动派发与终态回写。
- 恢复设置页 Automations 分区与「automations」主视图，页内自带「自动化 / 工作流」页级 Tab；已保存工作流以工作流 Tab 形式保留。

### 未恢复（设计上依赖平台）

- 闲时任务（off-peak）管理、coding-plan 转化入口、远端 client-scenes 模板目录（保留手动创建）与定时编辑器内的 start-plan 模型推荐。
- `scripts/check-standalone-surface.mjs` 放开 `src/scheduler/` 构建入口，继续拒绝 coding-plan webview。

## [未发布] — 独立 GLM 运行

### 调整

- 无需登录即可启动桌面应用。模型通过本地 Provider 设置中的协议、Base URL、API Key 和模型 ID 直连，支持 GLM 及其他可替换供应商。
- 内置模型模板随应用分发，不再下载平台模型配置；用户的个人模型设置继续在本地持久化。
- 保留普通对话、工具执行、历史会话、手动保存的工作流、插件与第三方 MCP 认证。
- 崩溃转储仅保存在本地，不上传遥测。远程运行时资源需自行准备或托管。

### 移除

- 平台账户、OAuth 登录/刷新、账单、订阅权益、配额、重置与购买流程。
- 定时任务、闲时任务的管理界面、执行服务、Agent 工具及桌面后台调度进程。
- 检查更新、自动更新、强制升级、工单、平台分享、官方文档/下载/社群入口。
- 平台客户端配置、官方 CDN 默认地址及远端遥测发送依赖。

### 防回归与兼容

- 应用传输拒绝 `zcode.z.ai`、`cdn-zcode.z.ai` 及其子域，逐跳验证重定向。
- 不删除历史会话、账户凭据、个人模型设置或旧任务记录；旧定时/闲时任务不再恢复执行。
- 添加静态边界检查及本地 Provider、传输和配置同步测试。
- 详细结果与已知失败见[验收记录](docs/standalone-validation.md)。没有执行真实付费 GLM 调用，未宣称所有平台和全部检查通过。
