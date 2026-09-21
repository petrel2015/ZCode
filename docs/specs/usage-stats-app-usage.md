# Usage stats: App usage settings page

Status: restored in the standalone runtime. Approved scope: re-introduce the settings "使用统计" (Usage stats) section showing only 应用用量 (App usage), aggregated from the local session database. The Coding Plan usage tab stays removed with the platform account system.

## Product contract

- The settings sidebar exposes a "使用统计" section (`usage`). It renders the App usage panel: lifetime summary, activity heatmap, per-range (7d/30d) daily model trend and model share charts, plus a manual refresh.
- Data is local only. The panel reads usage recorded by the agent into the global session database. It never calls `zcode.z.ai`, the retired monitor API, or any entitlement/quota endpoint.
- No Coding Plan tab, account source switcher, quota banner or purchase entry is rendered. Usage-section navigation intents (`usageTab`) that name `codingPlan` fall back to the App usage panel because it is the only content.

## Ownership and boundaries

```text
AppUsagePanel (settings/usage-stats) ── useAppUsageStats (hooks)
  → zcodeAgentService.getAppUsageStats (packages/services)
  → v4 protocol usage/stats (zcode-protocol)
  → CLI getUsageStats (bootstrap/server-operations)
  → UsageStorePort.queryAppUsage (sqlite session store, fact source)
```

- The CLI usage store is the single owner of usage facts (model/turn/tool usage tables in the global session DB). The UI holds one in-memory snapshot per hook instance; it is a projection with a latest-request-wins version guard, not a second authority. No persistence, no cross-tab cache.
- Event order: mount → one query per active range (plus one `all` lifetime query) → snapshot replaces state atomically; a newer request always wins; failure keeps the previous snapshot and surfaces an inline error notice. Refresh re-runs the same queries.

## Acceptance cases

- Settings sidebar shows "使用统计"; opening it renders the lifetime strip and heatmap from local history, with 7d/30d range tabs and charts.
- With no local history the panel shows the empty state, not an error.
- The standalone surface check (`scripts/check-standalone-surface.mjs`) passes: no retired platform domains are introduced by the restored files.
- Architecture check reports no new violations; the UI accesses data only through the existing service/protocol path (no new service, no direct store access).
