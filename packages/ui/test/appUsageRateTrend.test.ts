import assert from "node:assert/strict";
import test from "node:test";
import { appUsageSnapshotSchema } from "../../shared/src/usage-stats.js";
import type { AppUsageQueryResult } from "../../../apps/zcode-cli/packages/contracts/src/interfaces/session-store.port.js";
import { buildAppUsageSnapshot } from "../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/usage-stats-builder.js";
import {
  buildAppUsageRateTrendRows,
  resolveDefaultHourlyDate,
} from "../src/settings/usage-stats/AppUsageRateTrendChart.js";
import type { AppUsageSnapshot } from "@zcode/shared";

const DAY_MS = 86_400_000;

function emptyQueryResult(rateDays: AppUsageQueryResult["rateDays"]): AppUsageQueryResult {
  return {
    totals: {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      modelRequestCount: 0,
      modelErrorCount: 0,
      avgTimeToFirstTokenMs: null,
    },
    turnTotals: {
      totalSessions: 0,
      totalTurns: 0,
      avgTurnDurationMs: null,
      longestSessionMs: 0,
    },
    toolTotals: { toolCallCount: 0, toolErrorCount: 0 },
    models: [],
    tools: [],
    days: [],
    dayModels: [],
    rateDays,
  };
}

test("buildAppUsageSnapshot assembles rateTrend with N/A for inactive days", () => {
  const until = 3 * DAY_MS - 1; // dayIndex 0..2（since=0, tz=0 → 3 个本地日）
  const snapshot = buildAppUsageSnapshot(
    emptyQueryResult([
      {
        dayIndex: 0,
        outputTokens: 100,
        generationMs: 10_000,
        modelRequestMs: 12_000,
        toolExecutionMs: 5_000,
      },
      // dayIndex 1 只有工具执行：无生成时段 → 速率必须是 null（N/A），不是 0。
      {
        dayIndex: 1,
        outputTokens: 0,
        generationMs: 0,
        modelRequestMs: 0,
        toolExecutionMs: 9_000,
      },
    ]),
    { range: "7d", timeZone: "UTC", tzOffsetMs: 0, generatedAt: until, since: 0, until },
  );

  assert.ok(snapshot.rateTrend);
  const daily = snapshot.rateTrend.daily;
  assert.equal(daily.length, 3);
  assert.equal(daily[0]?.avgTokensPerSecond, 10); // 100 tokens / 10s
  assert.equal(daily[1]?.avgTokensPerSecond, null); // 纯工具日 → N/A
  assert.equal(daily[1]?.toolExecutionMs, 9_000);
  assert.equal(daily[2]?.avgTokensPerSecond, null); // 空日 → N/A
  assert.equal(daily[2]?.outputTokens, 0);

  // 月度 = 天级 token 加权：day0 之外全空 → 月速率仍 10。
  const monthly = snapshot.rateTrend.monthly;
  assert.equal(monthly.length, 1);
  assert.equal(monthly[0]?.avgTokensPerSecond, 10);
  assert.equal(monthly[0]?.modelRequestMs, 12_000);

  assert.equal(snapshot.rateTrend.hourly, null); // 未请求 hourlyDate
});

test("buildAppUsageSnapshot aggregates monthly rate token-weighted across days", () => {
  const until = 30 * DAY_MS - 1;
  const snapshot = buildAppUsageSnapshot(
    emptyQueryResult([
      {
        dayIndex: 0,
        outputTokens: 100,
        generationMs: 10_000,
        modelRequestMs: 10_000,
        toolExecutionMs: 0,
      },
      {
        dayIndex: 1,
        outputTokens: 300,
        generationMs: 10_000,
        modelRequestMs: 15_000,
        toolExecutionMs: 40_000,
      },
    ]),
    { range: "all", timeZone: "UTC", tzOffsetMs: 0, generatedAt: until, since: 0, until },
  );
  const monthly = snapshot.rateTrend?.monthly ?? [];
  // (100 + 300) tokens ÷ (10s + 10s) = 20 token/s，不是两天速率的算术平均。
  assert.equal(monthly[0]?.avgTokensPerSecond, 20);
  assert.equal(monthly[0]?.toolExecutionMs, 40_000);
  assert.equal(monthly[0]?.modelRequestMs, 25_000);
});

test("buildAppUsageSnapshot maps hourly buckets when hourlyDate requested", () => {
  const until = DAY_MS - 1;
  const snapshot = buildAppUsageSnapshot(
    {
      ...emptyQueryResult([]),
      rateHours: [
        {
          hour: 9,
          outputTokens: 36,
          generationMs: 4_000,
          modelRequestMs: 5_000,
          toolExecutionMs: 1_000,
        },
        { hour: 14, outputTokens: 0, generationMs: 0, modelRequestMs: 0, toolExecutionMs: 7_000 },
      ],
    },
    {
      range: "7d",
      timeZone: "UTC",
      tzOffsetMs: 0,
      generatedAt: until,
      since: 0,
      until,
      hourlyDate: "1970-01-01",
    },
  );
  assert.equal(snapshot.rateTrend?.hourly?.date, "1970-01-01");
  const hours = snapshot.rateTrend?.hourly?.hours ?? [];
  assert.equal(hours[9]?.avgTokensPerSecond, 9); // 36 tokens / 4s
  assert.equal(hours[14]?.avgTokensPerSecond, null); // 纯工具小时 → N/A
  assert.equal(hours[0]?.avgTokensPerSecond, null); // 无用量小时 → N/A
});

test("appUsageSnapshotSchema keeps rateTrend optional for old CLI payloads", () => {
  const legacy = appUsageSnapshotSchema.parse({
    range: "7d",
    generatedAt: 1,
    timeZone: "UTC",
    source: "agent-db",
    summary: {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cacheHitRate: 0,
      totalSessions: 0,
      totalTurns: 0,
      toolCallCount: 0,
      toolErrorRate: 0,
      modelErrorRate: 0,
      avgTimeToFirstTokenMs: null,
      avgTurnDurationMs: null,
      activeDays: 0,
      currentStreakDays: 0,
      longestSessionMs: 0,
      longestStreakDays: 0,
      peakDayTokens: 0,
      favoriteModel: null,
    },
    heatmap: { startDate: null, endDate: null, maxTokens: 0, weeks: [] },
    dailyModelUsage: [],
    models: [],
    tools: [],
  });
  assert.equal(legacy.rateTrend, undefined);
});

test("buildAppUsageRateTrendRows maps snapshot points with N/A preserved", () => {
  const snapshot = {
    rateTrend: {
      daily: [
        {
          key: "2026-09-23",
          avgTokensPerSecond: 42.3,
          outputTokens: 4230,
          generationMs: 100_000,
          modelRequestMs: 120_000,
          toolExecutionMs: 60_000,
        },
        {
          key: "2026-09-24",
          avgTokensPerSecond: null,
          outputTokens: 0,
          generationMs: 0,
          modelRequestMs: 0,
          toolExecutionMs: 30_000,
        },
      ],
      monthly: [],
      hourly: {
        date: "2026-09-24",
        hours: [
          {
            hour: 14,
            avgTokensPerSecond: 36.5,
            outputTokens: 365,
            generationMs: 10_000,
            modelRequestMs: 11_000,
            toolExecutionMs: 2_000,
          },
        ],
      },
    },
  } as unknown as AppUsageSnapshot;

  const dailyRows = buildAppUsageRateTrendRows({ granularity: "day", snapshot, locale: "zh-CN" });
  assert.equal(dailyRows.length, 2);
  assert.equal(dailyRows[0]?.rate, 42.3);
  assert.equal(dailyRows[0]?.anchor, 42.3);
  assert.equal(dailyRows[1]?.rate, null);
  assert.equal(dailyRows[1]?.anchor, 0); // 空档锚点贴 0 基线

  const hourRows = buildAppUsageRateTrendRows({ granularity: "hour", snapshot, locale: "zh-CN" });
  assert.equal(hourRows[0]?.label, "14:00");
  assert.equal(hourRows[0]?.rate, 36.5);

  assert.deepEqual(
    buildAppUsageRateTrendRows({ granularity: "day", snapshot: null, locale: "zh-CN" }),
    [],
  );
});

test("resolveDefaultHourlyDate picks the latest active day", () => {
  assert.equal(
    resolveDefaultHourlyDate([{ key: "2026-09-23" }, { key: "2026-09-24" }]),
    "2026-09-24",
  );
  // 无历史时回退今天（本地日期），保证首开「时」粒度不空白报错。
  const today = resolveDefaultHourlyDate(undefined);
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});
