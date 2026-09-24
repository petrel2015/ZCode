import assert from "node:assert/strict";
import test from "node:test";
import { turnHeaderRowSchema } from "../../shared/src/zcode-protocol-v4/rows.js";
import { formatConversationWorkedForLabel } from "../src/v4/conversationWorkDuration.js";
import {
  buildConversationTurnWorkSegments,
  resolveConversationTurnWorkRates,
  resolveSessionAverageTokensPerSecond,
  type ConversationTurnWorkStatus,
} from "../src/v4/conversationTurnWorkSegments.js";

const timing = { modelRequestMs: 600_000, toolExecutionMs: 3_000_000, outputTokens: 36_000 };

// 最小 intl 桩：时长单位翻译为中文单字，其余返回 "id|插值"，足以断言分支与参数。
const stubIntl = {
  formatMessage: ({ id }: { id: string }, values?: Record<string, string>) => {
    if (id === "chat.history.duration.day") return "天";
    if (id === "chat.history.duration.hour") return "时";
    if (id === "chat.history.duration.minute") return "分";
    if (id === "chat.history.duration.second") return "秒";
    return `${id}|${Object.values(values ?? {}).join(",")}`;
  },
} as unknown as Parameters<typeof formatConversationWorkedForLabel>[1];

test("formatConversationWorkedForLabel keeps both rates on the main line", () => {
  const label = formatConversationWorkedForLabel(
    { state: "completed", durationMs: 3_600_000, workTiming: timing },
    stubIntl,
    "zh-CN",
  );
  // 双速率常驻主行（整体 + 思考），不藏悬停。
  assert.equal(label, "chat.history.workedForRates|1 时,10.0,60.0");
});

test("formatConversationWorkedForLabel degrades to single rate or duration only", () => {
  // 仅整体（模型请求时长为 0）：
  const overallOnly = formatConversationWorkedForLabel(
    {
      state: "completed",
      durationMs: 1000,
      workTiming: { modelRequestMs: 0, toolExecutionMs: 0, outputTokens: 100 },
    },
    stubIntl,
    "zh-CN",
  );
  assert.equal(overallOnly, "chat.history.workedForWithRate|1 秒,100.0");
  // 仅思考（activeMs 为 0 → 整体速率缺省；duration 格式化按最小 1 秒展示）：
  const modelOnly = formatConversationWorkedForLabel(
    { state: "completed", durationMs: 0, workTiming: timing },
    stubIntl,
    "zh-CN",
  );
  assert.equal(modelOnly, "chat.history.workedForModelRate|1 秒,60.0");
  // 无 workTiming：退回纯时长文案。
  const durationOnly = formatConversationWorkedForLabel(
    { state: "completed", durationMs: 5000 },
    stubIntl,
    "zh-CN",
  );
  assert.equal(durationOnly, "chat.history.workedFor|5 秒");
  // 无时长事实：返回 null，由调用方回退「已处理」。
  assert.equal(formatConversationWorkedForLabel(undefined, stubIntl, "zh-CN"), null);
});

test("resolveConversationTurnWorkRates derives overall and model-phase rates", () => {
  // 1 小时权威工时产出 36k tokens → 整体 10 token/s；10 分钟模型请求 → 模型期 60 token/s。
  const rates = resolveConversationTurnWorkRates({
    state: "completed",
    durationMs: 3_600_000,
    workTiming: timing,
  });
  assert.equal(rates.overallTokensPerSecond, 10);
  assert.equal(rates.modelTokensPerSecond, 60);
});

test("resolveConversationTurnWorkRates hides rates when facts are missing or zero", () => {
  // 运行中轮没有 workTiming 事实，不显示速率。
  assert.deepEqual(resolveConversationTurnWorkRates({ state: "running", durationMs: 1000 }), {});
  assert.deepEqual(resolveConversationTurnWorkRates(undefined), {});
  assert.deepEqual(resolveConversationTurnWorkRates({ state: "completed", durationMs: 1000 }), {});
  // 缺 outputTokens / 时长为 0：对应速率缺省而不是 0（0 会误导为“零产出”）。
  assert.deepEqual(
    resolveConversationTurnWorkRates({
      state: "completed",
      durationMs: 1000,
      workTiming: { modelRequestMs: 500, toolExecutionMs: 0 },
    }),
    {},
  );
  const overallOnly = resolveConversationTurnWorkRates({
    state: "interrupted",
    durationMs: 1000,
    workTiming: { modelRequestMs: 0, toolExecutionMs: 0, outputTokens: 100 },
  });
  assert.equal(overallOnly.overallTokensPerSecond, 100);
  assert.equal(overallOnly.modelTokensPerSecond, undefined);
});

test("buildConversationTurnWorkSegments attaches workTiming only to single-segment turns", () => {
  const header = turnHeaderRowSchema.parse({
    rowId: 1,
    turnId: "t1",
    kind: "turnHeader",
    origin: "userInput",
    state: "completedSuccess",
    startedAt: 0,
    createdAt: 0,
    createdAtSeq: 0,
    activeMs: 3000,
    workTiming: timing,
  });
  const workRows = [
    {
      kind: "assistantText",
      rowId: 2,
      turnId: "t1",
      createdAt: 1,
      createdAtSeq: 0,
      text: "done",
      state: "complete",
    },
  ];
  const single = buildConversationTurnWorkSegments({
    key: "k",
    header,
    orderedRows: workRows as never,
    assistantTailRows: [],
    isRunning: false,
    isLastTurn: true,
    isInterrupted: false,
    forceOpenHistory: false,
    timelineOnly: false,
  });
  assert.equal(single.length, 1);
  assert.deepEqual(single[0]?.workStatus?.workTiming, timing);
  // 无 guide 行时是单段；workTiming 只在单段轮透传（guide 多段整轮口径不细分）。
  assert.equal(single[0]?.workStatus?.state, "completed");
});

test("turnHeaderRowSchema keeps workTiming optional for legacy snapshots", () => {
  const legacy = turnHeaderRowSchema.parse({
    rowId: 1,
    turnId: "t1",
    kind: "turnHeader",
    origin: "userInput",
    state: "completedSuccess",
    startedAt: 0,
    createdAt: 0,
    createdAtSeq: 0,
    activeMs: 100,
  });
  assert.equal(legacy.workTiming, undefined);
  const withTiming = turnHeaderRowSchema.parse({
    rowId: 2,
    turnId: "t2",
    kind: "turnHeader",
    origin: "userInput",
    state: "completedInterrupted",
    startedAt: 0,
    createdAt: 0,
    createdAtSeq: 0,
    workTiming: { modelRequestMs: 10, toolExecutionMs: 20 },
  });
  assert.deepEqual(withTiming.workTiming, { modelRequestMs: 10, toolExecutionMs: 20 });
});

test("rates integration from a parsed header through workStatus", () => {
  // 端到端派生：schema 解析 → workSegments 装配 → 速率计算。
  const header = turnHeaderRowSchema.parse({
    rowId: 3,
    turnId: "t3",
    kind: "turnHeader",
    origin: "userInput",
    state: "completedSuccess",
    startedAt: 0,
    createdAt: 0,
    createdAtSeq: 0,
    activeMs: 61_000,
    workTiming: { modelRequestMs: 10_000, toolExecutionMs: 50_000, outputTokens: 27_600 },
  });
  const segments = buildConversationTurnWorkSegments({
    key: "k",
    header,
    orderedRows: [
      {
        kind: "assistantText",
        rowId: 4,
        turnId: "t3",
        createdAt: 1,
        createdAtSeq: 0,
        text: "done",
        state: "complete",
      },
    ] as never,
    assistantTailRows: [],
    isRunning: false,
    isLastTurn: true,
    isInterrupted: false,
    forceOpenHistory: false,
    timelineOnly: false,
  });
  const status: ConversationTurnWorkStatus | undefined = segments[0]?.workStatus;
  const rates = resolveConversationTurnWorkRates(status);
  // 27600 tokens / 61s ≈ 452.5；/ 10s = 2760。
  assert.ok(Math.abs((rates.overallTokensPerSecond ?? 0) - 452.46) < 0.1);
  assert.equal(rates.modelTokensPerSecond, 2760);
});

test("resolveSessionAverageTokensPerSecond spans conversation active time", () => {
  // 「自会话开始到现在」：已完成轮 activeMs 之和 + 当前运行轮已进行时长。
  // 27k tokens ÷ (50s 已完成 + 40s 运行中) = 300 token/s。
  assert.equal(
    resolveSessionAverageTokensPerSecond({
      cumulativeOutputTokens: 27_000,
      completedActiveMs: 50_000,
      runningDurationMs: 40_000,
    }),
    300,
  );
  // 首轮（无已完成轮、运行刚开始）或缺任一事实 → null（显示 —，不是 0）。
  assert.equal(
    resolveSessionAverageTokensPerSecond({
      cumulativeOutputTokens: 0,
      completedActiveMs: 0,
      runningDurationMs: 5_000,
    }),
    null,
  );
  assert.equal(
    resolveSessionAverageTokensPerSecond({
      cumulativeOutputTokens: 1_000,
      completedActiveMs: 0,
      runningDurationMs: 0,
    }),
    null,
  );
  assert.equal(resolveSessionAverageTokensPerSecond({}), null);
  // 运行时长为负（时钟回拨防护）按 0 处理，不产生负分母。
  assert.equal(
    resolveSessionAverageTokensPerSecond({
      cumulativeOutputTokens: 1_000,
      completedActiveMs: 10_000,
      runningDurationMs: -3_000,
    }),
    100,
  );
});
