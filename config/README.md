# 内置配置

`default.json` 保留空对象，供旧配置加载接口兼容使用。独立版本不再读取远端 client/configs，也不提供工单、社群或官方文档入口。

`provider/zcode-builtin.json` 提供随客户端发布的本地模型模板。用户在模型设置中保存 Base URL、API Key 和模型 ID；个人配置仍由 Provider 服务持久化。运行时不下载或恢复远端平台模型配置。

验收命令：`node scripts/check-standalone-surface.mjs`（从仓库根目录运行）。
