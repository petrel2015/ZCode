import type {
  AssistantTextRow,
  ConversationRow,
  TurnHeaderRow,
  UserInputRow,
} from "@zcode/shared/zcode-protocol-v4";
import {
  ENABLE_CUA_TOOL_CALL_GROUPING,
  prepareCuaGroupFlowItems,
} from "@/v4/conversationCuaGroups.js";
import { buildConversationFlowItems } from "@/v4/conversationTurnFlowItems.js";
import type { AssistantWorkRow, ConversationTurnFlowItem } from "@/v4/conversationTurnFlowItems.js";

export interface ConversationTurnWorkStatus {
  state: "running" | "completed" | "interrupted";
  durationMs?: number;
  /**
   * 轮级工时拆分（docs/specs/session-token-throughput.md）：整轮口径，只在单段轮
   * （无 guide 切段）透传；多段轮把整轮时长错配到分段会得出错误速率。
   */
  workTiming?: NonNullable<TurnHeaderRow["workTiming"]>;
}

/** 轮级速率派生结果；undefined 字段表示缺事实，UI 不显示（不显示 0）。 */
export interface ConversationTurnWorkRates {
  /** 整体速率 = 轮 outputTokens ÷ 权威工时 activeMs。 */
  overallTokensPerSecond?: number;
  /** 模型期速率 = 轮 outputTokens ÷ Σ 模型请求 wall 时长（含首 token 等待）。 */
  modelTokensPerSecond?: number;
}

export interface ConversationTurnWorkSegment {
  key: string;
  triggerRow?: UserInputRow;
  flowItems: ConversationTurnFlowItem[];
  assistantWorkRows: AssistantWorkRow[];
  assistantHistoryRows: AssistantWorkRow[];
  assistantFollowingRows: AssistantWorkRow[];
  assistantHistoryDefaultOpen: boolean;
  workStatus?: ConversationTurnWorkStatus;
}

export function resolveConversationTurnWorkStatus(
  header: TurnHeaderRow | undefined,
  workRows: readonly AssistantWorkRow[],
  isRunning: boolean,
  durationMs: number | undefined,
  isInterrupted = false,
): ConversationTurnWorkStatus | undefined {
  if (header?.executionKind === "controlOnly") return undefined;
  const hasWork =
    isRunning ||
    workRows.length > 0 ||
    (header?.executionKind === "agent" ? durationMs !== undefined : (durationMs ?? 0) > 0);
  if (!hasWork) return undefined;
  return {
    state: isRunning ? "running" : isInterrupted ? "interrupted" : "completed",
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

export function resolveConversationTurnWorkDurationMs(
  header: TurnHeaderRow | undefined,
  options: { nowMs?: number },
  isRunning: boolean,
): number | undefined {
  if (!header) return undefined;
  if (header.activeMs !== undefined) return header.activeMs;
  if (header.endedAt !== undefined) return Math.max(header.endedAt - header.startedAt, 0);
  // UI 每秒传入 nowMs 只用于运行中“工作中 N 秒”；完成态缺少
  // activeMs/endedAt 时不能继续吃当前时钟，否则历史“已工作”会随时间增长。
  if (isRunning && options.nowMs !== undefined) {
    return Math.max(options.nowMs - header.startedAt, 0);
  }
  return undefined;
}

/**
 * 速率派生（docs/specs/session-token-throughput.md「轮级工时拆分」）：
 * 整体 = outputTokens ÷ activeMs，模型期 = outputTokens ÷ Σ 模型请求 wall 时长。
 * 运行中轮没有 workTiming 事实；任一时长为 0 或缺 tokens 时对应速率缺省——
 * 显示 0 会误导为“零产出”，缺省让 UI 回退现状文案。
 */
export function resolveConversationTurnWorkRates(
  workStatus: ConversationTurnWorkStatus | undefined,
): ConversationTurnWorkRates {
  const timing = workStatus?.workTiming;
  if (!workStatus || !timing || workStatus.state === "running") return {};
  const outputTokens = timing.outputTokens;
  if (outputTokens === undefined || outputTokens <= 0) return {};
  const durationMs = workStatus.durationMs ?? 0;
  return {
    ...(durationMs > 0 ? { overallTokensPerSecond: (outputTokens * 1000) / durationMs } : {}),
    ...(timing.modelRequestMs > 0
      ? { modelTokensPerSecond: (outputTokens * 1000) / timing.modelRequestMs }
      : {}),
  };
}

/**
 * 运行中的会话整体平均（spec 第三版）：会话累计 outputTokens ÷（已完成轮 activeMs
 * 之和 + 当前运行轮已进行时长）。与完成后「整体」同口径（排除用户输入等待），跨轮
 * 累计——「自这个对话开始到现在」的平均。completedActiveMs 只统计 rows 窗口内的
 * 轮头，超长会话的更早轮不在窗口内时为近似值。缺任一事实返回 null（显示 —）。
 */
export function resolveSessionAverageTokensPerSecond(input: {
  cumulativeOutputTokens?: number;
  completedActiveMs?: number;
  runningDurationMs?: number;
}): number | null {
  const tokens = input.cumulativeOutputTokens ?? 0;
  const denominator = (input.completedActiveMs ?? 0) + Math.max(input.runningDurationMs ?? 0, 0);
  if (tokens <= 0 || denominator <= 0) return null;
  return (tokens * 1000) / denominator;
}

interface DraftVisualWorkSegment {
  orderedRows: ConversationRow[];
  triggerRow?: UserInputRow;
}

function isUserInputRow(row: ConversationRow): row is UserInputRow {
  return row.kind === "userInput";
}

function isAssistantTextRow(row: ConversationRow): row is AssistantTextRow {
  return row.kind === "assistantText";
}

function isAssistantWorkRow(row: ConversationRow): row is AssistantWorkRow {
  return row.kind !== "turnHeader" && row.kind !== "userInput";
}

function splitVisualWorkSegments(rows: readonly ConversationRow[]): DraftVisualWorkSegment[] {
  const segments: DraftVisualWorkSegment[] = [];
  let current: DraftVisualWorkSegment = { orderedRows: [] };
  for (const row of rows) {
    if (isUserInputRow(row) && row.guided === true && current.orderedRows.length > 0) {
      segments.push(current);
      current = { orderedRows: [], triggerRow: row };
    }
    current.orderedRows.push(row);
  }
  if (current.orderedRows.length > 0) segments.push(current);
  return segments;
}

function resolveSegmentDurationMs(options: {
  header?: TurnHeaderRow;
  segmentIndex: number;
  triggerRow?: UserInputRow;
  nextTriggerRow?: UserInputRow;
  segmentRunning: boolean;
  segmentCount: number;
  nowMs?: number;
}): number | undefined {
  const fact =
    (options.triggerRow?.entityId
      ? options.header?.workSegments?.find(
          (candidate) => candidate.triggerEntityId === options.triggerRow?.entityId,
        )
      : undefined) ?? options.header?.workSegments?.[options.segmentIndex];
  if (fact?.activeMs !== undefined) return fact.activeMs;
  if (fact?.endedAt !== undefined) return Math.max(0, fact.endedAt - fact.startedAt);
  if (fact && options.segmentRunning && options.nowMs !== undefined) {
    return Math.max(0, options.nowMs - fact.startedAt);
  }
  if (options.segmentCount === 1) {
    return resolveConversationTurnWorkDurationMs(
      options.header,
      { nowMs: options.nowMs },
      options.segmentRunning,
    );
  }
  // 兼容旧 guide snapshot：新 CLI 会下发 workSegments；仅旧数据缺事实时才按
  // guided row 的稳定时间边界恢复，避免刷新后又退回整个 turn 的单一工时。
  const startedAt = options.triggerRow?.createdAt ?? options.header?.startedAt;
  const endedAt = options.nextTriggerRow?.createdAt ?? options.header?.endedAt;
  if (startedAt !== undefined && endedAt !== undefined) return Math.max(0, endedAt - startedAt);
  if (startedAt !== undefined && options.segmentRunning && options.nowMs !== undefined) {
    return Math.max(0, options.nowMs - startedAt);
  }
  return undefined;
}

export function buildConversationTurnWorkSegments(options: {
  key: string;
  header?: TurnHeaderRow;
  orderedRows: readonly ConversationRow[];
  assistantTailRows: readonly AssistantWorkRow[];
  latestAssistantTextRow?: AssistantTextRow;
  isRunning: boolean;
  isLastTurn: boolean;
  isInterrupted: boolean;
  forceOpenHistory: boolean;
  timelineOnly: boolean;
  nowMs?: number;
}): ConversationTurnWorkSegment[] {
  const visualDrafts = splitVisualWorkSegments(options.orderedRows);
  const tailRowIds = new Set(options.assistantTailRows.map((row) => row.rowId));
  return visualDrafts.map((segment, segmentIndex) => {
    const segmentAssistantRows = segment.orderedRows.filter(isAssistantWorkRow);
    const segmentTailRows = segmentAssistantRows.filter((row) => tailRowIds.has(row.rowId));
    const segmentFlowRows = segmentAssistantRows.filter((row) => !tailRowIds.has(row.rowId));
    const lastSegmentFlowRow = segmentFlowRows.at(-1);
    const segmentCompleted = segmentIndex < visualDrafts.length - 1 || !options.isRunning;
    const productLatestAssistantTextRow = options.latestAssistantTextRow
      ? segmentFlowRows.find((row) => row.rowId === options.latestAssistantTextRow?.rowId)
      : undefined;
    const visibleAssistantTextRow =
      productLatestAssistantTextRow && isAssistantTextRow(productLatestAssistantTextRow)
        ? productLatestAssistantTextRow
        : segmentCompleted && lastSegmentFlowRow && isAssistantTextRow(lastSegmentFlowRow)
          ? lastSegmentFlowRow
          : undefined;
    const visibleAssistantIndex = visibleAssistantTextRow
      ? segmentFlowRows.findIndex((row) => row.rowId === visibleAssistantTextRow.rowId)
      : -1;
    const segmentHistoryRows = options.timelineOnly
      ? []
      : visibleAssistantIndex < 0
        ? segmentFlowRows
        : segmentFlowRows.slice(0, visibleAssistantIndex);
    const segmentFollowingRows =
      visibleAssistantIndex < 0 ? [] : segmentFlowRows.slice(visibleAssistantIndex + 1);
    const segmentRunning = segmentIndex === visualDrafts.length - 1 && options.isRunning;
    const segmentDurationMs = resolveSegmentDurationMs({
      header: options.header,
      segmentIndex,
      triggerRow: segment.triggerRow,
      nextTriggerRow: visualDrafts[segmentIndex + 1]?.triggerRow,
      segmentRunning,
      segmentCount: visualDrafts.length,
      nowMs: options.nowMs,
    });
    const segmentWorkStatusBase = resolveConversationTurnWorkStatus(
      options.header,
      segmentFlowRows,
      segmentRunning,
      segmentDurationMs,
      options.isInterrupted && segmentIndex === visualDrafts.length - 1,
    );
    // workTiming 是整轮口径：只有单段轮（无 guide 切段）才透传给视觉段；
    // 多段轮的分段时长配整轮拆分会得出错误速率，宁可缺省回退现状文案。
    const segmentWorkStatus =
      segmentWorkStatusBase && visualDrafts.length === 1 && options.header?.workTiming
        ? { ...segmentWorkStatusBase, workTiming: options.header.workTiming }
        : segmentWorkStatusBase;
    const segmentKey =
      segmentIndex === 0
        ? options.key
        : `${options.key}:guide:${segment.triggerRow?.entityId ?? segment.triggerRow?.rowId ?? segmentIndex}`;
    const flowItems = buildConversationFlowItems({
      orderedRows: segment.orderedRows,
      assistantHistoryRows: segmentHistoryRows,
      assistantFollowingRows: segmentFollowingRows,
      assistantTailRows: segmentTailRows,
      ...(visibleAssistantTextRow ? { visibleAssistantTextRow } : {}),
      ...(options.latestAssistantTextRow
        ? { latestAssistantTextRow: options.latestAssistantTextRow }
        : {}),
      timelineOnly: options.timelineOnly,
    });
    return {
      key: segmentKey,
      ...(segment.triggerRow ? { triggerRow: segment.triggerRow } : {}),
      flowItems: prepareCuaGroupFlowItems(flowItems, {
        enabled: ENABLE_CUA_TOOL_CALL_GROUPING,
        stageTailIsRunning: segmentRunning,
      }),
      assistantWorkRows: segmentAssistantRows,
      assistantHistoryRows: segmentHistoryRows,
      assistantFollowingRows: segmentFollowingRows,
      assistantHistoryDefaultOpen:
        !options.timelineOnly &&
        (options.forceOpenHistory ||
          (options.isLastTurn && segmentWorkStatus?.state === "running") ||
          (visualDrafts.length === 1 &&
            visibleAssistantTextRow === undefined &&
            segmentFlowRows.length > 0)),
      ...(segmentWorkStatus ? { workStatus: segmentWorkStatus } : {}),
    };
  });
}
