import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { AppUsageSnapshot } from "@zcode/shared";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart.js";
import { Button } from "@/components/ui/button.js";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useAppUsageStats } from "@/hooks/useUsageStats.js";
import { formatAppUsageDuration } from "@/settings/usage-stats/AppUsagePanel.js";
import { APP_USAGE_TREND_CHART_MARGIN } from "@/settings/usage-stats/AppUsageDailyModelTrendChart.js";
import { getAppUsageModelChartColor } from "@/settings/usage-stats/appUsageChartPalette.js";
import {
  USAGE_STATS_TABS_LIST_CLASS,
  USAGE_STATS_TABS_TRIGGER_CLASS,
  UsageEmptyState,
  formatDay,
  formatFullDay,
  formatMonth,
  resolveModelLabel,
} from "@/settings/usage-stats/usageStatsUiParts.js";

export type AppUsageRateGranularity = "day" | "month" | "hour";

/** 图例里的一个模型序列（整体线之外）；按区间 token 总量排序取 Top N。 */
export type AppUsageRateModelSeries = {
  /** chart dataKey（m0、m1…），行上同名列为该模型速率（null = 该桶该模型无请求）。 */
  key: string;
  providerId: string;
  modelId: string;
  label: string;
  color: string;
  outputTokens: number;
};

export type AppUsageRateTrendRow = {
  /** 桶身份：day/month 为日期 key，hour 为 "HH"。 */
  key: string;
  label: string;
  tooltipLabel: string;
  /** 无有效生成时段时为 null（N/A，不是 0）。 */
  rate: number | null;
  outputTokens: number;
  generationMs: number;
  modelRequestMs: number;
  toolExecutionMs: number;
  /** 隐形 hover 锚点序列：给空档桶也提供 tooltip 命中点。 */
  anchor: number;
  /** 每个模型序列在该桶的速率（dataKey → rate|null）。 */
  modelRates: Record<string, number | null>;
};

/** 模型序列 Top N 上限：防止模型过多时图例与折线爆炸。 */
export const RATE_TREND_MAX_MODEL_SERIES = 5;

type UsageIntl = ReturnType<typeof useZCodeIntl>["intl"];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function bucketHasActivity(row: {
  outputTokens: number;
  generationMs: number;
  modelRequestMs: number;
  toolExecutionMs: number;
}): boolean {
  return (
    row.outputTokens > 0 ||
    row.generationMs > 0 ||
    row.modelRequestMs > 0 ||
    row.toolExecutionMs > 0
  );
}

function toRow(
  row: Omit<AppUsageRateTrendRow, "anchor" | "modelRates"> & {
    modelRates?: Record<string, number | null>;
  },
): AppUsageRateTrendRow {
  return { ...row, modelRates: row.modelRates ?? {}, anchor: row.rate ?? 0 };
}

/** 「时」粒度默认定位到最近一个有数据的日子；没有历史时回退今天。 */
export function resolveDefaultHourlyDate(daily: readonly { key: string }[] | undefined): string {
  const latest = daily?.[daily.length - 1]?.key;
  return latest ?? localDateKey(new Date());
}

type RateTrendPoint = {
  key?: string;
  hour?: number;
  avgTokensPerSecond: number | null;
  outputTokens: number;
  generationMs: number;
  modelRequestMs: number;
  toolExecutionMs: number;
  models?: readonly {
    providerId: string;
    modelId: string;
    avgTokensPerSecond: number | null;
    outputTokens: number;
    generationMs: number;
    modelRequestMs: number;
  }[];
};

function pointModelMap(point: RateTrendPoint): Map<string, AppUsageRateModelSeriesShape> {
  return new Map((point.models ?? []).map((m) => [`${m.providerId}\u0000${m.modelId}`, m]));
}

interface AppUsageRateModelSeriesShape {
  providerId: string;
  modelId: string;
  avgTokensPerSecond: number | null;
  outputTokens: number;
  generationMs: number;
  modelRequestMs: number;
}

/** 组装多序列 ViewModel：整体行序列 + Top N 模型线（图例、配色、每行 per-model 速率）。 */
export function buildAppUsageRateTrendViewModel({
  granularity,
  snapshot,
  locale,
  resolveModelLabel,
}: {
  granularity: AppUsageRateGranularity;
  snapshot: AppUsageSnapshot | null;
  locale: string;
  /** 模型显示名（与模型饼图一致）；provider 不在 modelId 内时加 provider 前缀。 */
  resolveModelLabel: (modelId: string | null) => string;
}): { rows: AppUsageRateTrendRow[]; modelSeries: AppUsageRateModelSeries[] } {
  const trend = snapshot?.rateTrend;
  if (!trend) return { rows: [], modelSeries: [] };
  const points: RateTrendPoint[] =
    granularity === "day"
      ? trend.daily
      : granularity === "month"
        ? trend.monthly
        : (trend.hourly?.hours ?? []);

  // Top N 模型：按区间累计 outputTokens 排序。
  const totals = new Map<string, { providerId: string; modelId: string; outputTokens: number }>();
  for (const point of points) {
    for (const m of point.models ?? []) {
      const key = `${m.providerId}\u0000${m.modelId}`;
      const existing = totals.get(key);
      if (existing) existing.outputTokens += m.outputTokens;
      else
        totals.set(key, {
          providerId: m.providerId,
          modelId: m.modelId,
          outputTokens: m.outputTokens,
        });
    }
  }
  const modelSeries: AppUsageRateModelSeries[] = [...totals.values()]
    .sort((a, b) => b.outputTokens - a.outputTokens)
    .slice(0, RATE_TREND_MAX_MODEL_SERIES)
    .map((entry, index) => {
      const modelLabel = resolveModelLabel(entry.modelId);
      const label = entry.modelId.includes(entry.providerId)
        ? modelLabel
        : `${entry.providerId} / ${modelLabel}`;
      return {
        key: `m${index}`,
        providerId: entry.providerId,
        modelId: entry.modelId,
        label,
        color: getAppUsageModelChartColor(index + 1),
        outputTokens: entry.outputTokens,
      };
    });

  const rows = points.map((point) => {
    const rate = point.avgTokensPerSecond;
    const modelRates: Record<string, number | null> = {};
    const pointModels = pointModelMap(point);
    for (const series of modelSeries) {
      const key = `${series.providerId}\u0000${series.modelId}`;
      const m = pointModels.get(key);
      modelRates[series.key] = m ? m.avgTokensPerSecond : null;
    }
    const pointKey = point.key ?? "";
    const base = {
      key: granularity === "hour" ? pad2((point as { hour: number }).hour) : pointKey,
      label:
        granularity === "month"
          ? formatMonth(locale, pointKey)
          : granularity === "hour"
            ? `${pad2((point as { hour: number }).hour)}:00`
            : formatDay(locale, pointKey),
      tooltipLabel:
        granularity === "month"
          ? formatMonth(locale, pointKey)
          : granularity === "hour"
            ? `${pad2((point as { hour: number }).hour)}:00`
            : formatFullDay(locale, pointKey),
      rate,
      outputTokens: point.outputTokens,
      generationMs: point.generationMs,
      modelRequestMs: point.modelRequestMs,
      toolExecutionMs: point.toolExecutionMs,
      modelRates,
    };
    return toRow(base);
  });
  return { rows, modelSeries };
}

/** 单序列旧行为（测试与既有消费者用）：只返回整体行。 */
export function buildAppUsageRateTrendRows({
  granularity,
  snapshot,
  locale,
}: {
  granularity: AppUsageRateGranularity;
  snapshot: AppUsageSnapshot | null;
  locale: string;
}): AppUsageRateTrendRow[] {
  return buildAppUsageRateTrendViewModel({
    granularity,
    snapshot,
    locale,
    resolveModelLabel: (modelId) => modelId ?? "",
  }).rows;
}

/** 悬停明细的第二行：模型请求 / 本地执行时长（累计口径）。 */
export function formatRateTrendTimingDetail(
  row: Pick<AppUsageRateTrendRow, "modelRequestMs" | "toolExecutionMs">,
  intl: UsageIntl,
): string {
  return intl.formatMessage(
    { id: "settings.usage.rateTrend.timingDetail" },
    {
      model: formatAppUsageDuration(row.modelRequestMs, intl),
      local: formatAppUsageDuration(row.toolExecutionMs, intl),
    },
  );
}

function shouldShowRateAxisLabel(index: number, total: number): boolean {
  if (total <= 14) return true;
  const step = total > 45 ? 7 : 5;
  return index === 0 || index === total - 1 || index % step === 0;
}

function RateTrendTooltipContent({
  active,
  payload,
  modelSeries,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  modelSeries: readonly AppUsageRateModelSeries[];
}) {
  const { intl } = useZCodeIntl();
  const row = payload?.[0]?.payload as AppUsageRateTrendRow | undefined;
  if (!active || !row) return null;
  const formatRate = (rate: number | null): string =>
    rate === null
      ? intl.formatMessage({ id: "settings.usage.rateTrend.notAvailable" })
      : `${rate.toFixed(1)} ${intl.formatMessage({ id: "settings.usage.rateTrend.rateUnit" })}`;
  const modelRows = modelSeries
    .filter(
      (series) => row.modelRates[series.key] !== null && row.modelRates[series.key] !== undefined,
    )
    .map((series) => ({ series, rate: row.modelRates[series.key] as number }));
  return (
    <div className="min-w-40 rounded-lg border border-border bg-popover px-3 py-2 text-ui-base shadow-md">
      <div className="font-medium text-foreground">
        {row.tooltipLabel} · {formatRate(row.rate)}
      </div>
      {modelRows.length > 0 ? (
        <div className="mt-1 space-y-0.5 text-ui-sm">
          {modelRows.map(({ series, rate }) => (
            <div key={series.key} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5 text-foreground-subtle">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: series.color }}
                />
                <span className="truncate">{series.label}</span>
              </span>
              <span className="font-mono tabular-nums text-foreground">{formatRate(rate)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-1 text-ui-sm text-foreground-subtle">
        {formatRateTrendTimingDetail(row, intl)}
      </div>
    </div>
  );
}

export function AppUsageRateTrendChart({
  snapshot,
  lifetimeSnapshot,
  refreshToken,
}: {
  /** 当前范围（7d/30d）快照：「天」粒度数据源。 */
  snapshot: AppUsageSnapshot;
  /** range=all 快照：「月」粒度数据源与「时」粒度的可选日期导航。 */
  lifetimeSnapshot: AppUsageSnapshot | null;
  /** 父面板刷新令牌：递增时联动刷新「时」粒度的内部查询。 */
  refreshToken?: number;
}) {
  const { intl, locale } = useZCodeIntl();
  const [granularity, setGranularity] = useState<AppUsageRateGranularity>("day");

  const activeDailyKeys = useMemo(
    () =>
      (lifetimeSnapshot?.rateTrend?.daily ?? snapshot.rateTrend?.daily ?? []).filter((point) =>
        bucketHasActivity(point),
      ),
    [lifetimeSnapshot, snapshot],
  );
  const [hourlyDate, setHourlyDate] = useState<string>(() =>
    resolveDefaultHourlyDate(activeDailyKeys),
  );
  // lifetime 快照晚到时，若用户还没手动选过日期，把默认值对齐到最近有数据的日子。
  const hourlyDateTouchedRef = useRef(false);
  useEffect(() => {
    if (hourlyDateTouchedRef.current) return;
    setHourlyDate(resolveDefaultHourlyDate(activeDailyKeys));
  }, [activeDailyKeys]);

  // 「时」粒度自带一条查询（带 hourlyDate）；非「时」粒度不查询该日的桶。
  const hourlyQueryDate = granularity === "hour" ? hourlyDate : undefined;
  const hourly = useAppUsageStats("all", hourlyQueryDate);

  const refreshTokenRef = useRef(refreshToken);
  useEffect(() => {
    if (refreshTokenRef.current === refreshToken) return;
    refreshTokenRef.current = refreshToken;
    void hourly.refresh();
  }, [refreshToken, hourly]);

  const rowsSource =
    granularity === "hour"
      ? hourly.snapshot
      : granularity === "month"
        ? lifetimeSnapshot
        : snapshot;
  const { rows, modelSeries } = useMemo(
    () =>
      buildAppUsageRateTrendViewModel({
        granularity,
        snapshot: rowsSource,
        locale,
        resolveModelLabel: (modelId) => resolveModelLabel(intl, modelId),
      }),
    [granularity, rowsSource, locale, intl],
  );
  const maxRate = useMemo(
    () =>
      rows.reduce(
        (max, row) =>
          Math.max(max, row.rate ?? 0, ...Object.values(row.modelRates).map((value) => value ?? 0)),
        0,
      ),
    [rows],
  );

  const hourlyIndex = activeDailyKeys.findIndex((point) => point.key === hourlyDate);
  const prevDailyKey = hourlyIndex > 0 ? activeDailyKeys[hourlyIndex - 1]?.key : undefined;
  const nextDailyKey =
    hourlyIndex >= 0 && hourlyIndex < activeDailyKeys.length - 1
      ? activeDailyKeys[hourlyIndex + 1]?.key
      : undefined;
  const handlePickHourlyDate = useCallback((key: string) => {
    hourlyDateTouchedRef.current = true;
    setHourlyDate(key);
  }, []);

  const formatAxisLabel = useCallback(
    (value: string, index: number) => (shouldShowRateAxisLabel(index, rows.length) ? value : ""),
    [rows.length],
  );

  const hasAnyData = rows.some((row) => bucketHasActivity(row)) || maxRate > 0;

  return (
    <section className="space-y-3 rounded-xl bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "settings.usage.rateTrend.title" })}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {granularity === "hour" ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 w-7 bg-background p-0"
                disabled={!prevDailyKey}
                aria-label={intl.formatMessage({ id: "settings.usage.rateTrend.prevDay" })}
                onClick={() => {
                  if (prevDailyKey) handlePickHourlyDate(prevDailyKey);
                }}
              >
                <ChevronLeftIcon className="size-3.5" />
              </Button>
              <span className="min-w-24 text-center text-ui-sm text-foreground-subtle">
                {formatFullDay(locale, hourlyDate)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 w-7 bg-background p-0"
                disabled={!nextDailyKey}
                aria-label={intl.formatMessage({ id: "settings.usage.rateTrend.nextDay" })}
                onClick={() => {
                  if (nextDailyKey) handlePickHourlyDate(nextDailyKey);
                }}
              >
                <ChevronRightIcon className="size-3.5" />
              </Button>
            </div>
          ) : null}
          <Tabs
            value={granularity}
            onValueChange={(value) => setGranularity(value as AppUsageRateGranularity)}
            className="shrink-0"
          >
            <TabsList className={USAGE_STATS_TABS_LIST_CLASS}>
              {(["day", "month", "hour"] as const).map((option) => (
                <TabsTrigger key={option} value={option} className={USAGE_STATS_TABS_TRIGGER_CLASS}>
                  {intl.formatMessage({ id: `settings.usage.rateTrend.granularity.${option}` })}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>
      {!hasAnyData ? (
        <UsageEmptyState
          title={intl.formatMessage({ id: "settings.usage.emptyTitle" })}
          description={intl.formatMessage({ id: "settings.usage.emptyDescription" })}
        />
      ) : (
        <div className="px-3 py-3">
          {modelSeries.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2" role="list">
              <div className="flex min-w-0 items-center gap-2 text-ui-sm" role="listitem">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: getAppUsageModelChartColor(0) }}
                />
                <span className="truncate text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.usage.rateTrend.overallLegend" })}
                </span>
              </div>
              {modelSeries.map((series) => (
                <div
                  key={series.key}
                  className="flex min-w-0 items-center gap-2 text-ui-sm"
                  role="listitem"
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: series.color }}
                  />
                  <span className="truncate text-foreground-subtle">{series.label}</span>
                </div>
              ))}
            </div>
          ) : null}
          <ChartContainer
            config={{
              rate: {
                label: intl.formatMessage({ id: "settings.usage.rateTrend.title" }),
                color: getAppUsageModelChartColor(0),
              },
              ...Object.fromEntries(
                modelSeries.map((series) => [
                  series.key,
                  { label: series.label, color: series.color },
                ]),
              ),
            }}
            className="h-60 w-full"
          >
            <LineChart accessibilityLayer data={rows} margin={APP_USAGE_TREND_CHART_MARGIN}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                interval={0}
                minTickGap={0}
                tickMargin={8}
                tickFormatter={formatAxisLabel}
              />
              <YAxis hide domain={[0, Math.max(maxRate, 1)]} />
              <ChartTooltip
                cursor={false}
                content={<RateTrendTooltipContent modelSeries={modelSeries} />}
              />
              {/* 隐形锚点序列：空档桶（rate=null 断点）也提供 hover 命中，悬停显示 N/A。 */}
              <Line
                dataKey="anchor"
                stroke="transparent"
                strokeWidth={1}
                dot={false}
                activeDot={{ r: 3, fill: "transparent", stroke: "transparent" }}
                isAnimationActive={false}
                legendType="none"
              />
              <Line
                dataKey="rate"
                type="monotone"
                stroke={`var(--color-rate, ${getAppUsageModelChartColor(0)})`}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
              />
              {modelSeries.map((series) => (
                <Line
                  key={series.key}
                  dataKey={series.key}
                  type="monotone"
                  stroke={series.color}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  activeDot={{ r: 3 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
        </div>
      )}
    </section>
  );
}
