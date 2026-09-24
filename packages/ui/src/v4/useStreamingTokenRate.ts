import { useEffect, useRef, useState } from "react";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import {
  STREAMING_RATE_SAMPLE_INTERVAL_MS,
  StreamingRateEstimator,
  type StreamingRowSample,
} from "@/v4/streamingTokenRate.js";

function collectStreamingRows(rows: readonly ConversationRow[]): StreamingRowSample[] {
  const samples: StreamingRowSample[] = [];
  for (const row of rows) {
    if ((row.kind === "assistantText" || row.kind === "reasoning") && row.state === "streaming") {
      samples.push({ rowId: row.rowId, text: row.text });
    }
  }
  return samples;
}

/**
 * 流式中实时输出速率（≈ token/s，1 位小数）；无增长或停滞时为 null。
 * 瞬时态：只读传入的行集合，估算窗口由本 hook 独有，不入 store、不持久化。
 * rows 任意子集（如单个运行中轮的行）皆可，采样按 rowId 维持基线。
 */
export function useStreamingRowTokenRate(rows: readonly ConversationRow[]): number | null {
  const [rate, setRate] = useState<number | null>(null);
  const estimatorRef = useRef<StreamingRateEstimator | null>(null);
  if (estimatorRef.current === null) estimatorRef.current = new StreamingRateEstimator();
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    const estimator = estimatorRef.current;
    if (!estimator) return;
    const timer = setInterval(() => {
      setRate(estimator.observe(collectStreamingRows(rowsRef.current), Date.now()));
    }, STREAMING_RATE_SAMPLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return rate;
}

/**
 * 会话窗口级实时速率（composer 双表盘 chip 用）：等价于对 snapshot 全部流式行采样。
 */
export function useStreamingTokenRate(snapshot: ConversationSnapshot | null): number | null {
  // 行数组按 ref 读取，snapshot 变化不重建采样器；与行级 hook 共用同一实现。
  const rows = snapshot?.rows.window ?? [];
  return useStreamingRowTokenRate(rows);
}
