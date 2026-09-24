import assert from "node:assert/strict";
import test from "node:test";
import { SessionEventType, type SessionEvent } from "@zcode/contracts";
import { aggregateTurnWorkTiming } from "../src/runtime/methods/usage-observability.js";

// aggregateTurnWorkTiming 只读 type/payload，构造覆盖口径的最小事件即可。
function event(type: SessionEventType, payload: unknown): SessionEvent {
  return {
    id: "evt",
    sessionId: "s1",
    type,
    timestamp: new Date(0),
    traceId: "t1",
    sequenceNumber: 0,
    payload,
  } as unknown as SessionEvent;
}

test("aggregateTurnWorkTiming sums completed request durations", () => {
  const result = aggregateTurnWorkTiming([
    event(SessionEventType.ModelNetworkStatus, { type: "model_request_completed", durationMs: 1200 }),
    event(SessionEventType.ModelNetworkStatus, { type: "model_request_completed", durationMs: 800 }),
  ]);
  assert.deepEqual(result, { modelRequestMs: 2000, toolExecutionMs: 0 });
});

test("aggregateTurnWorkTiming counts failed requests only when duration is present", () => {
  const result = aggregateTurnWorkTiming([
    event(SessionEventType.ModelNetworkStatus, { type: "model_request_failed", durationMs: 500 }),
    // 失败事件 durationMs 可选：缺省不计入，不猜时长。
    event(SessionEventType.ModelNetworkStatus, { type: "model_request_failed", reason: "network" }),
  ]);
  assert.deepEqual(result, { modelRequestMs: 500, toolExecutionMs: 0 });
});

test("aggregateTurnWorkTiming sums tool result durations", () => {
  const result = aggregateTurnWorkTiming([
    event(SessionEventType.ToolCallResult, { toolCallId: "t1", duration: 3000 }),
    event(SessionEventType.ToolCallResult, { toolCallId: "t2", duration: 1500 }),
  ]);
  assert.deepEqual(result, { modelRequestMs: 0, toolExecutionMs: 4500 });
});

test("aggregateTurnWorkTiming skips unrelated network events and invalid durations", () => {
  const result = aggregateTurnWorkTiming([
    event(SessionEventType.ModelNetworkStatus, { type: "model_request_started" }),
    event(SessionEventType.ModelNetworkStatus, { type: "model_retry_scheduled", delayMs: 100 }),
    // 非正数与缺 duration 的结果事件都不计入。
    event(SessionEventType.ModelNetworkStatus, { type: "model_request_completed", durationMs: 0 }),
    event(SessionEventType.ModelNetworkStatus, { type: "model_request_completed" }),
    event(SessionEventType.ToolCallResult, { toolCallId: "t1", duration: -5 }),
    event(SessionEventType.ToolCallResult, { toolCallId: "t2" }),
  ]);
  assert.deepEqual(result, { modelRequestMs: 0, toolExecutionMs: 0 });
});

test("aggregateTurnWorkTiming returns zeros for events without timing facts", () => {
  assert.deepEqual(aggregateTurnWorkTiming([]), { modelRequestMs: 0, toolExecutionMs: 0 });
  assert.deepEqual(aggregateTurnWorkTiming([event(SessionEventType.UserMessage, { content: "hi" })]), {
    modelRequestMs: 0,
    toolExecutionMs: 0,
  });
});
