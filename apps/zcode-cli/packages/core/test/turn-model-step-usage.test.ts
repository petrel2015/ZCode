import assert from "node:assert/strict";
import test from "node:test";
import { SessionEventType, type SessionEvent } from "@zcode/contracts";
import type { ModelUsage } from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import { recordMainTurnThroughput } from "../src/runtime/methods/turn-model-step-usage.js";

// 最小事件集：首 token 扫描只读 type/payload/timestamp，构造足以覆盖该口径的事件即可。
function streamingEvent(delta: string, at: number, kind = "text_delta"): SessionEvent {
  return {
    id: "evt",
    sessionId: "s1",
    type: SessionEventType.ModelStreaming,
    timestamp: new Date(at),
    traceId: "t1",
    sequenceNumber: 0,
    payload: { delta, kind },
  } as unknown as SessionEvent;
}

function networkEvent(at: number): SessionEvent {
  return {
    id: "evt-net",
    sessionId: "s1",
    type: SessionEventType.ModelNetworkStatus,
    timestamp: new Date(at),
    traceId: "t1",
    sequenceNumber: 0,
    payload: { type: "model_request_started" },
  } as unknown as SessionEvent;
}

function stubRuntime(): AgentRuntimeInternal {
  // recordMainTurnThroughput 只读写 mainTurnThroughputAggregate，其余 runtime 状态无关。
  return {
    mainTurnThroughputAggregate: { countedRounds: 0, totalOutputTokens: 0, totalGenerationMs: 0 },
  } as unknown as AgentRuntimeInternal;
}

function usageWith(outputTokens: number | undefined): ModelUsage | undefined {
  return outputTokens === undefined ? undefined : ({ outputTokens } as ModelUsage);
}

test("recordMainTurnThroughput skips rounds without a first content token", () => {
  const runtime = stubRuntime();
  // 无任何 streaming delta（如纯工具轮/空响应）：整轮跳过，不污染累计。
  const noDelta = recordMainTurnThroughput(
    runtime,
    {
      startedAt: 0,
      events: [networkEvent(0), streamingEvent("", 1000)],
      networkEventStartIndex: 1,
      usage: usageWith(100),
    },
    10_000,
  );
  assert.equal(noDelta, undefined);
  assert.deepEqual(runtime.mainTurnThroughputAggregate, {
    countedRounds: 0,
    totalOutputTokens: 0,
    totalGenerationMs: 0,
  });
});

test("recordMainTurnThroughput skips rounds lacking output tokens or valid duration", () => {
  const missingTokens = stubRuntime();
  assert.equal(
    recordMainTurnThroughput(
      missingTokens,
      {
        startedAt: 0,
        events: [streamingEvent("你好", 1000)],
        networkEventStartIndex: 0,
        usage: usageWith(undefined),
      },
      2000,
    ),
    undefined,
  );
  assert.deepEqual(missingTokens.mainTurnThroughputAggregate, {
    countedRounds: 0,
    totalOutputTokens: 0,
    totalGenerationMs: 0,
  });

  // 生成时长 <= 0（now 不晚于首 token）同样整轮跳过。
  const zeroDuration = stubRuntime();
  assert.equal(
    recordMainTurnThroughput(
      zeroDuration,
      {
        startedAt: 0,
        events: [streamingEvent("hi", 1000)],
        networkEventStartIndex: 0,
        usage: usageWith(100),
      },
      1000,
    ),
    undefined,
  );

  // 首 token 早于请求开始：事件序可疑（startIndex 错位），防御性跳过。
  const beforeStart = stubRuntime();
  assert.equal(
    recordMainTurnThroughput(
      beforeStart,
      {
        startedAt: 5000,
        events: [streamingEvent("hi", 1000)],
        networkEventStartIndex: 0,
        usage: usageWith(100),
      },
      6000,
    ),
    undefined,
  );
});

test("recordMainTurnThroughput accumulates token-weighted average and last round tps", () => {
  const runtime = stubRuntime();
  // 轮 1：首 token t=1000，t=2000 完成 → 100 token / 1000ms = 100 token/s。
  const round1 = recordMainTurnThroughput(
    runtime,
    {
      startedAt: 0,
      events: [networkEvent(0), streamingEvent("h", 1000), streamingEvent("i", 1500)],
      networkEventStartIndex: 1,
      usage: usageWith(100),
    },
    2000,
  );
  assert.deepEqual(round1, {
    countedRounds: 1,
    avgTokensPerSecond: 100,
    lastTokensPerSecond: 100,
  });

  // 轮 2：首 token t=6000，t=9000 完成 → 300 token / 3000ms = 100 token/s。
  const round2 = recordMainTurnThroughput(
    runtime,
    {
      startedAt: 4000,
      events: [streamingEvent("h", 6000), streamingEvent("i", 7000)],
      networkEventStartIndex: 0,
      usage: usageWith(300),
    },
    9000,
  );
  assert.deepEqual(round2, {
    countedRounds: 2,
    avgTokensPerSecond: 100,
    lastTokensPerSecond: 100,
  });

  // 轮 3：900 token / 3000ms = 300 token/s。加权平均 Σ1300 token / 7s ≈ 185.7，
  // 不同于三轮速率的算术平均 (100+100+300)/3 ≈ 166.7，验证 token 加权口径。
  const round3 = recordMainTurnThroughput(
    runtime,
    {
      startedAt: 10_000,
      events: [streamingEvent("h", 11_000)],
      networkEventStartIndex: 0,
      usage: usageWith(900),
    },
    14_000,
  );
  assert.equal(round3?.countedRounds, 3);
  assert.equal(round3?.avgTokensPerSecond, (1300 * 1000) / 7000);
  assert.equal(round3?.lastTokensPerSecond, 300);
  assert.deepEqual(runtime.mainTurnThroughputAggregate, {
    countedRounds: 3,
    totalOutputTokens: 1300,
    totalGenerationMs: 7000,
  });
});

test("recordMainTurnThroughput takes the first non-empty text or reasoning delta", () => {
  const runtime = stubRuntime();
  // 空 delta 不算首 token；首个非空 reasoning_delta 决定生成时长起点。
  const result = recordMainTurnThroughput(
    runtime,
    {
      startedAt: 0,
      events: [
        streamingEvent("", 1000),
        streamingEvent("思考", 2000, "reasoning_delta"),
        streamingEvent("正文", 4000, "text_delta"),
      ],
      networkEventStartIndex: 0,
      usage: usageWith(150),
    },
    3500,
  );
  assert.equal(result?.countedRounds, 1);
  // 生成时长 = 3500 - 2000 = 1500ms → 150 token / 1.5s = 100 token/s。
  assert.equal(result?.lastTokensPerSecond, 100);
  assert.equal(result?.avgTokensPerSecond, 100);
});
