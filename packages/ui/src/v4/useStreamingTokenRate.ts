import { useEffect, useRef, useState } from "react";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import {
  STREAMING_RATE_SAMPLE_INTERVAL_MS,
  StreamingRateEstimator,
  type StreamingRowSample,
} from "@/v4/streamingTokenRate.js";

function collectStreamingRows(snapshot: ConversationSnapshot | null): StreamingRowSample[] {
  const rows: StreamingRowSample[] = [];
  for (const row of snapshot?.rows.window ?? []) {
    if ((row.kind === "assistantText" || row.kind === "reasoning") && row.state === "streaming") {
      rows.push({ rowId: row.rowId, text: row.text });
    }
  }
  return rows;
}

/**
 * 流式中实时输出速率（≈ token/s，1 位小数）；无增长或停滞时为 null。
 * 瞬时态：只读 v4 投影 snapshot，估算窗口由本 hook 独有，不入 store、不持久化。
 */
export function useStreamingTokenRate(snapshot: ConversationSnapshot | null): number | null {
  const [rate, setRate] = useState<number | null>(null);
  const estimatorRef = useRef<StreamingRateEstimator | null>(null);
  if (estimatorRef.current === null) estimatorRef.current = new StreamingRateEstimator();
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    const estimator = estimatorRef.current;
    if (!estimator) return;
    const timer = setInterval(() => {
      setRate(estimator.observe(collectStreamingRows(snapshotRef.current), Date.now()));
    }, STREAMING_RATE_SAMPLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return rate;
}
