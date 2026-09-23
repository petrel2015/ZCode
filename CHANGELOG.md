# Changelog

English | [简体中文](CHANGELOG.zh.md)

This log covers the personal branch only; upstream history remains in Git. The application version remains defined by the root `package.json`. No tag or release is created by this change.

## [Unreleased] — Restore local scheduled tasks (Automations/cron)

### Added

- Restore scheduled tasks as a fully local capability: `CronCreate/CronList/CronUpdate/CronDelete` Agent tools, the `automation/*` RPC service, and on-device persistence in `tasks-index.sqlite`.
- Restore the desktop cron scheduler utility process (claim/dispatch state machine with misfire skip, single-flight claims and retry backoff) and Host dispatch via `CronRun` → createTask/resumeTask + sendPrompt, with manual "run now" dispatch and outcome tracking.
- Restore the Automations settings section and the "automations" main view with the in-page「自动化 / 工作流」tab switch; saved workflows render as the workflow tab.

### Not restored (platform-dependent by design)

- Off-peak (idle-time) task management, coding-plan funnel surfaces, remote client-scenes template catalog (creation stays manual) and start-plan model recommendation in the automation editor.
- `scripts/check-standalone-surface.mjs` now allows the `src/scheduler/` build entry while still rejecting the coding-plan webview.

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
