import type { Locale } from "@zcode/shared";
import type { IntlInstance } from "@/i18n/IntlProvider.js";
import {
  resolveConversationTurnWorkRates,
  type ConversationTurnWorkStatus,
} from "@/v4/conversationTurnWorkSegments.js";

function formatDurationUnit(
  value: number,
  messageId: string,
  intl: IntlInstance,
  locale: Locale,
): string {
  const unit = intl.formatMessage({ id: messageId });
  // 中文时长单位需要空格；英文单位本身已带缩写，不额外插入空格。
  return `${value}${locale === "zh-CN" ? " " : ""}${unit}`;
}

/** Desktop 与 Share 共用的工作时长文案，避免同一轮在两个 surface 显示不同单位。 */
export function formatConversationWorkDuration(
  durationMs: number | undefined,
  intl: IntlInstance,
  locale: Locale,
): string | null {
  if (durationMs === undefined) return null;

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (days > 0) parts.push(formatDurationUnit(days, "chat.history.duration.day", intl, locale));
  if (hours > 0) parts.push(formatDurationUnit(hours, "chat.history.duration.hour", intl, locale));
  if (minutes > 0)
    parts.push(formatDurationUnit(minutes, "chat.history.duration.minute", intl, locale));
  if (seconds > 0 || parts.length === 0) {
    parts.push(formatDurationUnit(seconds, "chat.history.duration.second", intl, locale));
  }

  return parts.slice(0, 2).join(" ");
}

// 拆分明细里的 0 必须如实显示为「0 秒」；formatConversationWorkDuration 会把 0
// 取整成 1 秒（它服务于“已工作”观感），直接复用会把空侧误报成有耗时。
function formatTimingDuration(durationMs: number, intl: IntlInstance, locale: Locale): string {
  if (durationMs > 0) return formatConversationWorkDuration(durationMs, intl, locale) ?? "";
  return formatDurationUnit(0, "chat.history.duration.second", intl, locale);
}

/**
 * 完成态轮历史的完整主行文案：已工作 {duration} · 整体 {r1} · 思考 {r2} token/s。
 * 双速率直接常驻主行（用户要求不藏悬停）；任一速率缺事实时降级为单速率/纯时长。
 * 运行中与无时长（null）由调用方另行处理，不在此分支。
 */
export function formatConversationWorkedForLabel(
  workStatus: ConversationTurnWorkStatus | undefined,
  intl: IntlInstance,
  locale: Locale,
): string | null {
  const duration = formatConversationWorkDuration(workStatus?.durationMs, intl, locale);
  if (!workStatus || !duration) return null;
  const rates = resolveConversationTurnWorkRates(workStatus);
  const overall = rates.overallTokensPerSecond?.toFixed(1);
  const model = rates.modelTokensPerSecond?.toFixed(1);
  if (overall !== undefined && model !== undefined) {
    return intl.formatMessage({ id: "chat.history.workedForRates" }, { duration, overall, model });
  }
  if (overall !== undefined) {
    return intl.formatMessage(
      { id: "chat.history.workedForWithRate" },
      { duration, rate: overall },
    );
  }
  if (model !== undefined) {
    return intl.formatMessage({ id: "chat.history.workedForModelRate" }, { duration, rate: model });
  }
  return intl.formatMessage({ id: "chat.history.workedFor" }, { duration });
}

/**
 * 轮级工时拆分明细文案（docs/specs/session-token-throughput.md「轮级工时拆分」）：
 * 本地执行 / 模型请求时长 + 思考期速率。无 workTiming 或两侧都缺事实时返回 null，
 * UI 回退现状文案。Desktop 悬停 title、展开区常显行与 Share 只读时间线共用。
 */
export function formatConversationWorkTimingDetail(
  workStatus: ConversationTurnWorkStatus | undefined,
  intl: IntlInstance,
  locale: Locale,
): string | null {
  const timing = workStatus?.workTiming;
  if (!timing) return null;
  const rates = resolveConversationTurnWorkRates(workStatus);
  const local = formatTimingDuration(timing.toolExecutionMs, intl, locale);
  const model = formatTimingDuration(timing.modelRequestMs, intl, locale);
  if (rates.modelTokensPerSecond !== undefined) {
    return intl.formatMessage(
      { id: "chat.history.workTimingDetail" },
      { local, model, modelRate: rates.modelTokensPerSecond.toFixed(1) },
    );
  }
  return intl.formatMessage({ id: "chat.history.workTimingBreakdown" }, { local, model });
}
