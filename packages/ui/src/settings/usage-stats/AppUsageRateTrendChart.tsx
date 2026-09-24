import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { AppUsageSnapshot } from "@zcode/shared";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart.js";
import { Button } from "@/components/ui/button.js";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useLocalAppUsageStats } from "@/hooks/useLocalAppUsageStats.js";
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
} from "@/settings/usage-stats/usageStatsUiParts.js";

export type AppUsageRateGranularity = "day" | "month" | "hour";

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
};

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

function toRow(row: Omit<AppUsageRateTrendRow, "anchor">): AppUsageRateTrendRow {
  return { ...row, anchor: row.rate ?? 0 };
}

/** 「时」粒度默认定位到最近一个有数据的日子；没有历史时回退今天。 */
export function resolveDefaultHourlyDate(daily: readonly { key: string }[] | undefined): string {
  const latest = daily?.[daily.length - 1]?.key;
  return latest ?? localDateKey(new Date());
}

export function buildAppUsageRateTrendRows({
  granularity,
  snapshot,
  locale,
}: {
  granularity: AppUsageRateGranularity;
  snapshot: AppUsageSnapshot | null;
  locale: string;
}): AppUsageRateTrendRow[] {
  const trend = snapshot?.rateTrend;
  if (!trend) return [];
  if (granularity === "day") {
    return trend.daily.map((point) =>
      toRow({
        key: point.key,
        label: formatDay(locale, point.key),
        tooltipLabel: formatFullDay(locale, point.key),
        rate: point.avgTokensPerSecond,
        outputTokens: point.outputTokens,
        generationMs: point.generationMs,
        modelRequestMs: point.modelRequestMs,
        toolExecutionMs: point.toolExecutionMs,
      }),
    );
  }
  if (granularity === "month") {
    return trend.monthly.map((point) =>
      toRow({
        key: point.key,
        label: formatMonth(locale, point.key),
        tooltipLabel: formatMonth(locale, point.key),
        rate: point.avgTokensPerSecond,
        outputTokens: point.outputTokens,
        generationMs: point.generationMs,
        modelRequestMs: point.modelRequestMs,
        toolExecutionMs: point.toolExecutionMs,
      }),
    );
  }
  return (trend.hourly?.hours ?? []).map((point) =>
    toRow({
      key: pad2(point.hour),
      label: `${pad2(point.hour)}:00`,
      tooltipLabel: `${pad2(point.hour)}:00`,
      rate: point.avgTokensPerSecond,
      outputTokens: point.outputTokens,
      generationMs: point.generationMs,
      modelRequestMs: point.modelRequestMs,
      toolExecutionMs: point.toolExecutionMs,
    }),
  );
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
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const { intl } = useZCodeIntl();
  const row = payload?.[0]?.payload as AppUsageRateTrendRow | undefined;
  if (!active || !row) return null;
  const rateLabel =
    row.rate === null
      ? intl.formatMessage({ id: "settings.usage.rateTrend.notAvailable" })
      : `${row.rate.toFixed(1)} ${intl.formatMessage({ id: "settings.usage.rateTrend.rateUnit" })}`;
  return (
    <div className="min-w-40 rounded-lg border border-border bg-popover px-3 py-2 text-ui-base shadow-md">
      <div className="font-medium text-foreground">
        {row.tooltipLabel} · {rateLabel}
      </div>
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
  const hourly = useLocalAppUsageStats("all", hourlyQueryDate);

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
  const rows = useMemo(
    () => buildAppUsageRateTrendRows({ granularity, snapshot: rowsSource, locale }),
    [granularity, rowsSource, locale],
  );
  const maxRate = useMemo(
    () => rows.reduce((max, row) => (row.rate !== null ? Math.max(max, row.rate) : max), 0),
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
          <ChartContainer
            config={{
              rate: {
                label: intl.formatMessage({ id: "settings.usage.rateTrend.title" }),
                color: getAppUsageModelChartColor(0),
              },
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
              <ChartTooltip cursor={false} content={<RateTrendTooltipContent />} />
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
                stroke="var(--color-rate)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
              />
            </LineChart>
          </ChartContainer>
        </div>
      )}
    </section>
  );
}
