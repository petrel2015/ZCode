# Usage stats: App usage settings page

Status: restored in the standalone runtime. Approved scope: re-introduce the settings "使用统计" (Usage stats) section showing only 应用用量 (App usage), aggregated from the local session database. The Coding Plan usage tab stays removed with the platform account system. Second revision: token rate trend charts (day/month/hour-of-day) backed by a permanent hourly rollup.

## Product contract

- The settings sidebar exposes a "使用统计" section (`usage`). It renders the App usage panel: lifetime summary, activity heatmap, per-range (7d/30d) daily model trend and model share charts, the token rate trend chart (day / month / hour-of-day granularities), plus a manual refresh.
- Data is local only. The panel reads usage recorded by the agent into the global session database. It never calls `zcode.z.ai`, the retired monitor API, or any entitlement/quota endpoint.
- No Coding Plan tab, account source switcher, quota banner or purchase entry is rendered. Usage-section navigation intents (`usageTab`) that name `codingPlan` fall back to the App usage panel because it is the only content.

## Token rate trend charts（第二版新增）

### 口径（与 `docs/specs/session-token-throughput.md` 的会话平均一致）

- **桶速率** = 桶内 Σ `model_usage.output_tokens` ÷ Σ 生成时长（`completed_at − first_token_at`，首 token → 请求完成；不含工具执行与轮间等待）。
- 桶内无有效模型请求（Σ 生成时长为 0 或无请求）→ 速率为 **null**：图上断点（`connectNulls=false`）+ 悬停显示 **N/A**（不是 0）。
- 悬停明细附带时长拆分：模型请求 wall 总时长（Σ `duration_ms`）与本地执行总时长（Σ `tool_usage.duration_ms`），**累计口径**（并行/流式重叠重复计入），tooltip 注明。
- 三个粒度：按天（跟随页面 7d/30d 范围）、按月（全部 rollup 历史）、按所选日逐小时（24 点，0–23 本地小时；默认最近有数据的一天，仅可在有数据的日期间前后切换）。

### 永久小时 rollup（`usage_rollup_hourly`）

- 明细三表保留 30 天（现状不变），趋势所需的长期历史由小时粒度 rollup 承载：`hour_index = floor((started_at + tzOffsetMs) / 3600000)`（沿用现有固定偏移口径，DST 最多 1 小时误差）。
- **读取路径单一化：`queryAppUsage` 读取日/月/小时趋势前，先把自上次 watermark 之后（及尚未聚合的小时）的明细幂等合并进 rollup（受影响小时 delete+insert），再从 rollup 读趋势**；明细表只作 rollup 的写入源。`pruneUsage` 不清理 rollup。
- 建表时从现有明细一次性回填；回填只覆盖 30 天内的明细，更早日期如实缺省（速率为 N/A）。
- 时区：rollup 的 hour_index 以查询传入的 `tzOffsetMs` 归桶。**首次写入固定基准偏移**（如实现时发现跨时区查询会重复归桶，采用「rollup 只按 UTC 小时存、查询侧再按 tzOffsetMs 二次归桶」的口径，避免同一天多时区双计——以实现注释记录最终选择）。

### 协议与 schema（全部 additive）

- `v4UsageStatsParamsSchema` 加 optional `hourlyDate?: string`（本地日期 `yyyy-mm-dd`，请求该日 24 小时桶）。
- `appUsageSnapshotSchema` 加 optional `rateTrend: { daily: […], monthly: […], hourly?: { date, hours: [24 × { hour, avgTokensPerSecond: number|null, modelRequestMs, toolExecutionMs, outputTokens }] } }`；旧快照缺字段解析为缺席，UI 不渲染速率区。
- 不新增 range 枚举：月度视图固定由 `range: "all"` 的数据派生。

### 验收场景

- 使用统计页渲染速率趋势图：默认「天」粒度悬停显示 `2026-09-24 · 42.3 token/s`（空日 N/A、图上断开）；「月」粒度显示全部历史月份；「时」粒度显示所选日 24 点曲线，悬停显示 `14:00 · 36.5 token/s`，无请求小时为 N/A 断点。
- 悬停次行显示「模型请求 X 分 · 本地执行 Y 分（并行累计）」。
- 跨 30 天边界：30 天前的日期趋势仍可读（来自 rollup），明细已被 prune 不影响趋势；rollup 上线前的日期显示 N/A。
- 旧快照（无 rateTrend）解析通过，UI 不渲染速率区不报错。
- `scripts/check-standalone-surface.mjs` 与架构检查保持通过。

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
