import assert from "node:assert/strict";
import test from "node:test";
import {
  accumulateSessionThroughput,
  calculateOutputTps,
  emptySessionThroughput,
  sessionDebugSnapshotSchema,
} from "../../shared/src/session-debug.js";
import {
  STREAMING_RATE_STALL_MS,
  STREAMING_RATE_WINDOW_MS,
  StreamingRateEstimator,
  estimateStreamedTokens,
} from "../src/v4/streamingTokenRate.js";

test("calculateOutputTps uses output tokens over generation-only duration", () => {
  assert.equal(calculateOutputTps(120, 600), 200);
  assert.equal(calculateOutputTps(undefined, 600), null);
  assert.equal(calculateOutputTps(120, null), null);
  assert.equal(calculateOutputTps(120, 0), null);
});

test("session throughput accumulates token-weighted average across rounds", () => {
  let state = accumulateSessionThroughput(null, 100, 1000);
  state = accumulateSessionThroughput(state, 300, 3000);
  assert.equal(state.countedRounds, 2);
  assert.equal(state.totalOutputTokens, 400);
  assert.equal(state.totalGenerationMs, 4000);
  // (100 + 300) / (1s + 3s) = 100 token/s，不是两轮速率的算术平均 (100+100)/2。
  assert.equal(state.avgTokensPerSecond, 100);
  assert.equal(state.lastTokensPerSecond, 100);
});

test("session throughput skips rounds lacking tokens or generation duration", () => {
  let state = accumulateSessionThroughput(null, 100, 1000);
  // 缺 outputTokens 或缺生成时长的轮整轮跳过，last 保留上一轮有效值。
  state = accumulateSessionThroughput(state, undefined, 5000);
  state = accumulateSessionThroughput(state, 50, null);
  assert.equal(state.countedRounds, 1);
  assert.equal(state.totalOutputTokens, 100);
  assert.equal(state.totalGenerationMs, 1000);
  assert.equal(state.lastTokensPerSecond, 100);
});

test("session throughput starts from an empty accumulator", () => {
  const state = accumulateSessionThroughput(null, undefined, null);
  assert.deepEqual(state, emptySessionThroughput());
  assert.equal(state.avgTokensPerSecond, null);
});

test("session debug snapshot schema accepts legacy payload without throughput", () => {
  const legacy = sessionDebugSnapshotSchema.parse({
    sessionId: "s1",
    rounds: [],
    networkEntries: [],
    cache: null,
  });
  assert.equal(legacy.throughput, undefined);
  const current = sessionDebugSnapshotSchema.parse({
    sessionId: "s1",
    rounds: [],
    networkEntries: [],
    cache: null,
    throughput: emptySessionThroughput(),
  });
  assert.equal(current.throughput?.countedRounds, 0);
});

test("streamed token estimate weights CJK as full tokens and latin as quarters", () => {
  assert.equal(estimateStreamedTokens("你好世界"), 4);
  assert.equal(estimateStreamedTokens("abcdefgh"), 2);
  assert.equal(estimateStreamedTokens("你好ab"), 2.5);
  assert.equal(estimateStreamedTokens(""), 0);
});

test("streaming rate estimator measures observed growth inside the window", () => {
  const estimator = new StreamingRateEstimator();
  // 首拍只建基线，历史文本不计增速。
  assert.equal(estimator.observe([{ rowId: 1, text: "abcdefgh" }], 0), null);
  // 4s 窗口内追加 40 个拉丁字符 = 10 token / 4s = 2.5 token/s。
  assert.equal(estimator.observe([{ rowId: 1, text: "a".repeat(8 + 40) }], 4000), 2.5);
});

test("streaming rate estimator hides the reading on stall or idle", () => {
  const estimator = new StreamingRateEstimator();
  estimator.observe([{ rowId: 1, text: "abcd" }], 0);
  // 1s 内 +2 个拉丁字符 = 0.5 token/s。
  assert.equal(estimator.observe([{ rowId: 1, text: "abcdef" }], 1000), 0.5);
  assert.ok(estimator.observe([{ rowId: 1, text: "a".repeat(40) }], 2000));
  // 停滞超过 STALL_MS 后读数隐藏，而不是显示 0。
  const stalled = estimator.observe(
    [{ rowId: 1, text: "a".repeat(40) }],
    2000 + STREAMING_RATE_STALL_MS + 1,
  );
  assert.equal(stalled, null);
  // 行离开流式集合（轮完成）后同样无读数。
  assert.equal(estimator.observe([], 2000 + STREAMING_RATE_STALL_MS + 1000), null);
});

test("streaming rate estimator ignores text regression and new-row history", () => {
  const estimator = new StreamingRateEstimator();
  estimator.observe([{ rowId: 1, text: "a".repeat(100) }], 0);
  assert.ok(estimator.observe([{ rowId: 1, text: "a".repeat(200) }], 1000));
  // recovery/snapshot 替换导致文本回退：清空观察窗口，宁可无读数也不显示旧增速。
  assert.equal(estimator.observe([{ rowId: 1, text: "a".repeat(10) }], 2000), null);
  // 新出现的流式行只建基线，已有历史不计增速；窗口内只有 row1 重放后的 +10 字符增量。
  assert.equal(
    estimator.observe(
      [
        { rowId: 1, text: "a".repeat(20) },
        { rowId: 2, text: "b".repeat(500) },
      ],
      3000,
    ),
    2.5,
  );
});

test("streaming rate estimator prunes samples beyond the window", () => {
  const estimator = new StreamingRateEstimator();
  estimator.observe([{ rowId: 1, text: "a" }], 0);
  estimator.observe([{ rowId: 1, text: "aa" }], 1000);
  // t=1000 的样本被窗口剪掉后只剩当前拍一个样本，不足以出读数。
  const rate = estimator.observe(
    [{ rowId: 1, text: "a".repeat(4 * 20) }],
    STREAMING_RATE_WINDOW_MS + 1000 + 100,
  );
  assert.equal(rate, null);
});
