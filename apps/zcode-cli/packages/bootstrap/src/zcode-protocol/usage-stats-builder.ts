import type { AppUsageQueryResult } from "@zcode/contracts";
import type {
  AppUsageHeatmap,
  AppUsageHeatmapCell,
  AppUsageHeatmapWeek,
  AppUsageRange,
  AppUsageSnapshot,
} from "@zcode/shared";

const DAY_MS = 86_400_000;

interface BuildAppUsageOptions {
  range: AppUsageRange;
  timeZone: string;
  tzOffsetMs: number;
  generatedAt: number;
  since: number;
  until: number;
  /** 可选：同时产出该本地日的 24 小时速率桶。 */
  hourlyDate?: string;
}

/** 用 Intl 计算 timeZone 在 atMs 时刻相对 UTC 的偏移（ms）。无法解析时回退 0。 */
export function resolveTzOffsetMs(timeZone: string, atMs: number): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(new Date(atMs));
    const lookup = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(
      lookup("year"),
      lookup("month") - 1,
      lookup("day"),
      lookup("hour"),
      lookup("minute"),
      lookup("second"),
    );
    return asUtc - Math.trunc(atMs / 1000) * 1000;
  } catch {
    return 0;
  }
}

function dayIndexToDate(dayIndex: number): string {
  // dayIndex*DAY 是「本地午夜当作 UTC」的时刻，取其 UTC 日历分量即本地日期。
  return new Date(dayIndex * DAY_MS).toISOString().slice(0, 10);
}

function levelFor(tokens: number, max: number): AppUsageHeatmapCell["level"] {
  if (tokens <= 0 || max <= 0) return 0;
  const ratio = tokens / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

// 速率 = Σ outputTokens ÷ Σ 生成时长（首 token → 请求完成）。桶内无有效生成时段时
// 返回 null（UI 显示 N/A 而不是 0——0 会误读为“零产出”）。
function bucketRate(sums: Pick<RateBucketSums, "outputTokens" | "generationMs">): number | null {
  return sums.generationMs > 0 && sums.outputTokens > 0
    ? (sums.outputTokens * 1000) / sums.generationMs
    : null;
}

interface RateBucketSums {
  outputTokens: number;
  generationMs: number;
  modelRequestMs: number;
  toolExecutionMs: number;
}

function resolveUsageStartDayIndex(
  result: AppUsageQueryResult,
  opts: BuildAppUsageOptions,
  endDayIndex: number,
): number {
  if (opts.range !== "all") {
    return Math.floor((opts.since + opts.tzOffsetMs) / DAY_MS);
  }

  // rollup 是永久表：它的最早 dayIndex 可能早于 30 天明细，必须一并参与
  // 起点推导，否则长期闲置后重新使用会把趋势起点错误地折叠到最后一天。
  const dayIndexes = [
    ...result.days.map((day) => day.dayIndex),
    ...result.dayModels.map((dayModel) => dayModel.dayIndex),
    ...result.rateDays.map((day) => day.dayIndex),
  ];
  if (dayIndexes.length === 0) {
    return endDayIndex;
  }
  return Math.min(...dayIndexes);
}

export function buildAppUsageSnapshot(
  result: AppUsageQueryResult,
  opts: BuildAppUsageOptions,
): AppUsageSnapshot {
  const { totals, turnTotals, toolTotals } = result;

  // 用量库的 inputTokens 已是 total input，cache 字段只是 breakdown。
  // 命中率分母不能再加 cacheRead/cacheCreation，否则会把命中率压低。
  const cacheDenom =
    totals.inputTokens > 0
      ? totals.inputTokens
      : totals.cacheCreationTokens + totals.cacheReadTokens;
  const cacheHitRate = cacheDenom > 0 ? totals.cacheReadTokens / cacheDenom : 0;
  const modelErrorRate =
    totals.modelRequestCount > 0 ? totals.modelErrorCount / totals.modelRequestCount : 0;
  const toolErrorRate =
    toolTotals.toolCallCount > 0 ? toolTotals.toolErrorCount / toolTotals.toolCallCount : 0;

  // 按日 token 映射，用于 activeDays / streak / heatmap
  const dayTokenMap = new Map<
    number,
    { totalTokens: number; turnCount: number; toolCallCount: number }
  >();
  for (const d of result.days) {
    dayTokenMap.set(d.dayIndex, {
      totalTokens: d.totalTokens,
      turnCount: d.turnCount,
      toolCallCount: d.toolCallCount,
    });
  }

  const endDayIndex = Math.floor((opts.until + opts.tzOffsetMs) / DAY_MS);
  const startDayIndex = resolveUsageStartDayIndex(result, opts, endDayIndex);

  let activeDays = 0;
  let currentStreakDays = 0;
  let longestStreakDays = 0;
  let runningStreakDays = 0;
  let streakBroken = false;
  for (let di = endDayIndex; di >= startDayIndex; di--) {
    const tokens = dayTokenMap.get(di)?.totalTokens ?? 0;
    if (tokens > 0) {
      activeDays++;
      runningStreakDays++;
      longestStreakDays = Math.max(longestStreakDays, runningStreakDays);
      if (!streakBroken) currentStreakDays++;
    } else if (!streakBroken) {
      streakBroken = true;
      runningStreakDays = 0;
    } else {
      runningStreakDays = 0;
    }
  }

  const maxTokens = result.days.reduce((m, d) => Math.max(m, d.totalTokens), 0);

  // heatmap：从 startDayIndex 到 endDayIndex，按 7 天一周切片（与现有 GitHub 式一致）
  const weeks: AppUsageHeatmapWeek[] = [];
  let week: Array<AppUsageHeatmapCell | null> = [];
  for (let di = startDayIndex; di <= endDayIndex; di++) {
    const day = dayTokenMap.get(di);
    week.push({
      date: dayIndexToDate(di),
      level: levelFor(day?.totalTokens ?? 0, maxTokens),
      totalTokens: day?.totalTokens ?? 0,
      turnCount: day?.turnCount ?? 0,
      toolCallCount: day?.toolCallCount ?? 0,
    });
    if (week.length === 7) {
      weeks.push({ weekIndex: weeks.length, days: week });
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push({ weekIndex: weeks.length, days: week });
  }

  const heatmap: AppUsageHeatmap = {
    startDate: dayIndexToDate(startDayIndex),
    endDate: dayIndexToDate(endDayIndex),
    maxTokens,
    weeks,
  };

  // trend：按日聚合 dayModels
  const dailyMap = new Map<number, Map<string | null, number>>();
  for (const dm of result.dayModels) {
    const inner = dailyMap.get(dm.dayIndex) ?? new Map<string | null, number>();
    inner.set(dm.modelId, (inner.get(dm.modelId) ?? 0) + dm.totalTokens);
    dailyMap.set(dm.dayIndex, inner);
  }
  const dailyModelUsage: AppUsageSnapshot["dailyModelUsage"] = [];
  for (let di = startDayIndex; di <= endDayIndex; di++) {
    const inner = dailyMap.get(di);
    dailyModelUsage.push({
      date: dayIndexToDate(di),
      models: inner
        ? [...inner.entries()].map(([modelId, totalTokens]) => ({ modelId, totalTokens }))
        : [],
    });
  }

  // 模型排行 + favorite
  const totalModelTokens = result.models.reduce((s, m) => s + m.totalTokens, 0);
  const models = result.models.map((m) => ({
    modelId: m.modelId,
    totalTokens: m.totalTokens,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    requestCount: m.requestCount,
    share: totalModelTokens > 0 ? m.totalTokens / totalModelTokens : 0,
  }));
  const favoriteModel =
    models.length > 0
      ? { modelId: models[0].modelId, totalTokens: models[0].totalTokens, share: models[0].share }
      : null;

  const tools = result.tools.map((t) => ({
    toolName: t.toolName,
    callCount: t.callCount,
    errorCount: t.errorCount,
    errorRate: t.callCount > 0 ? t.errorCount / t.callCount : 0,
    avgDurationMs: t.avgDurationMs,
  }));

  // 速率趋势（docs/specs/usage-stats-app-usage.md）：按天连续补齐（空日 null），
  // 按月由天序列聚合；rateHours 是请求指定日的 24 桶（缺省为 null 整体）。
  const rateDayMap = new Map<number, RateBucketSums>();
  for (const d of result.rateDays) {
    rateDayMap.set(d.dayIndex, {
      outputTokens: d.outputTokens,
      generationMs: d.generationMs,
      modelRequestMs: d.modelRequestMs,
      toolExecutionMs: d.toolExecutionMs,
    });
  }
  const daily = [];
  const monthlyMap = new Map<string, RateBucketSums>();
  for (let di = startDayIndex; di <= endDayIndex; di += 1) {
    const sums = rateDayMap.get(di) ?? {
      outputTokens: 0,
      generationMs: 0,
      modelRequestMs: 0,
      toolExecutionMs: 0,
    };
    const date = dayIndexToDate(di);
    daily.push({ key: date, avgTokensPerSecond: bucketRate(sums), ...sums });
    const monthKey = date.slice(0, 7);
    const month = monthlyMap.get(monthKey) ?? {
      outputTokens: 0,
      generationMs: 0,
      modelRequestMs: 0,
      toolExecutionMs: 0,
    };
    month.outputTokens += sums.outputTokens;
    month.generationMs += sums.generationMs;
    month.modelRequestMs += sums.modelRequestMs;
    month.toolExecutionMs += sums.toolExecutionMs;
    monthlyMap.set(monthKey, month);
  }
  const monthly = [...monthlyMap.entries()].map(([key, sums]) => ({
    key,
    avgTokensPerSecond: bucketRate(sums),
    ...sums,
  }));
  const rateTrend: AppUsageSnapshot["rateTrend"] = {
    daily,
    monthly,
    hourly: opts.hourlyDate
      ? {
          date: opts.hourlyDate,
          // 密集化为 24 桶：仓库层保证稠密，这里兜底稀疏输入，UI 无需补齐逻辑。
          hours: (() => {
            const buckets = Array.from({ length: 24 }, (_, hour) => ({
              hour,
              outputTokens: 0,
              generationMs: 0,
              modelRequestMs: 0,
              toolExecutionMs: 0,
            }));
            for (const h of result.rateHours ?? []) {
              if (h.hour >= 0 && h.hour < 24) {
                const bucket = buckets[h.hour];
                if (bucket) {
                  bucket.outputTokens = h.outputTokens;
                  bucket.generationMs = h.generationMs;
                  bucket.modelRequestMs = h.modelRequestMs;
                  bucket.toolExecutionMs = h.toolExecutionMs;
                }
              }
            }
            return buckets.map((bucket) => ({
              hour: bucket.hour,
              avgTokensPerSecond: bucketRate(bucket),
              outputTokens: bucket.outputTokens,
              generationMs: bucket.generationMs,
              modelRequestMs: bucket.modelRequestMs,
              toolExecutionMs: bucket.toolExecutionMs,
            }));
          })(),
        }
      : null,
  };

  return {
    range: opts.range,
    generatedAt: opts.generatedAt,
    timeZone: opts.timeZone,
    source: "agent-db",
    summary: {
      totalTokens: totals.totalTokens,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      reasoningTokens: totals.reasoningTokens,
      cacheCreationTokens: totals.cacheCreationTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheHitRate,
      totalSessions: turnTotals.totalSessions,
      totalTurns: turnTotals.totalTurns,
      toolCallCount: toolTotals.toolCallCount,
      toolErrorRate,
      modelErrorRate,
      avgTimeToFirstTokenMs: totals.avgTimeToFirstTokenMs,
      avgTurnDurationMs: turnTotals.avgTurnDurationMs,
      activeDays,
      currentStreakDays,
      longestSessionMs: turnTotals.longestSessionMs,
      longestStreakDays,
      peakDayTokens: maxTokens,
      favoriteModel,
    },
    heatmap,
    dailyModelUsage,
    models,
    tools,
    rateTrend,
  };
}
