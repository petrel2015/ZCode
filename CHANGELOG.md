# Changelog

English | [简体中文](CHANGELOG.zh.md)

This log covers the personal branch only; upstream history remains in Git. The application version remains defined by the root `package.json`. No tag or release is created by this change.

## [Unreleased] — Standalone GLM runtime

### Changed

- Start the desktop app without a platform login. Connect to GLM or another provider using a locally configured protocol, base URL, API key and model ID.
- Ship model templates with the app and persist personal provider settings locally instead of downloading platform configuration.
- Preserve conversations, tools, history, manually saved workflows, plugins and third-party MCP authentication.
- Keep crash dumps local with no telemetry upload. Remote runtime assets must be prepared or self-hosted.

### Removed

- Platform accounts, OAuth login/refresh, billing, subscription entitlements, quotas, resets and purchase flows.
- Scheduled/off-peak task management, execution services, Agent tools and desktop scheduler processes.
- Manual/automatic/forced updates, tickets, platform sharing and official documentation/download/community entrypoints.
- Platform client configuration, default official CDN endpoints and remote telemetry dependencies.

### Regression protection and compatibility

- Application transports reject `zcode.z.ai`, `cdn-zcode.z.ai` and their subdomains, checking redirect destinations at each hop.
- Preserve historical conversations, credentials, personal providers and retired task records. Old scheduled/off-peak tasks are not resumed.
- Add a static surface check and local provider, transport and provisioning tests.
- See [validation results and known failures](docs/standalone-validation.md). No paid live GLM call was made; verification does not cover all platforms or imply that every check passes.
