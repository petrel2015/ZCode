// 会话流式输出的实时速率估算（≈ token/s）。
// 口径见 docs/specs/session-token-throughput.md：这是流式中的估算值，与 session-debug
// 旁路在轮完成后的权威 TPS 互补；本模块保持纯逻辑，采样节拍由 useStreamingTokenRate 驱动。

/** 采样节拍；与 elapsed 时钟 hook 同款的心跳模式，显示层 2Hz 足够。 */
export const STREAMING_RATE_SAMPLE_INTERVAL_MS = 500;
/** 速率滚动窗口。 */
export const STREAMING_RATE_WINDOW_MS = 4000;
/** 窗口内最近一次增长超过该时长即视为停滞（工具调用/思考间隙），读数隐藏而不是显示 0。 */
export const STREAMING_RATE_STALL_MS = 2000;

// CJK 假名/表意/兼容表意/谚文按 1 token/字折算，其余字符按 1/4 token/字符折算。
// 双语输出下的粗估：给出量级正确的读数，精确值以轮完成后的权威 TPS 为准。
const CJK_CHAR_PATTERN = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;

export function estimateStreamedTokens(text: string): number {
  let cjkChars = 0;
  for (const char of text) {
    if (CJK_CHAR_PATTERN.test(char)) cjkChars += 1;
  }
  return cjkChars + (text.length - cjkChars) / 4;
}

export interface StreamingRowSample {
  rowId: number;
  text: string;
}

interface RowBaseline {
  textLength: number;
}

export class StreamingRateEstimator {
  private rowBaselines = new Map<number, RowBaseline>();
  private producedTokens = 0;
  private samples: Array<{ at: number; produced: number }> = [];
  private lastGrowthAt: number | null = null;

  /**
   * 每个采样节拍喂一次当前流式行集合；返回窗口期估算 token/s（1 位小数），
   * 无增长、样本不足或已停滞时返回 null。
   */
  observe(rows: StreamingRowSample[], now: number): number | null {
    const seenRowIds = new Set<number>();
    for (const row of rows) {
      seenRowIds.add(row.rowId);
      const baseline = this.rowBaselines.get(row.rowId);
      if (!baseline) {
        // 新行只建基线：历史文本不计入增速，读数只反映观察窗口内的增长。
        this.rowBaselines.set(row.rowId, { textLength: row.text.length });
        continue;
      }
      if (row.text.length < baseline.textLength) {
        // 文本回退＝snapshot 整体替换/recovery 重放：重置基线并清空观察窗口——
        // 窗口内残留的增长对应可能已被替换的正文，按 spec 宁可短暂无读数也不显示错误速率。
        baseline.textLength = row.text.length;
        this.samples = [];
        this.lastGrowthAt = null;
        continue;
      }
      const appendedChars = row.text.length - baseline.textLength;
      if (appendedChars > 0) {
        baseline.textLength = row.text.length;
        this.producedTokens += estimateStreamedTokens(row.text.slice(-appendedChars));
        this.lastGrowthAt = now;
      }
    }
    for (const rowId of this.rowBaselines.keys()) {
      if (!seenRowIds.has(rowId)) this.rowBaselines.delete(rowId);
    }

    this.samples.push({ at: now, produced: this.producedTokens });
    const windowStart = now - STREAMING_RATE_WINDOW_MS;
    this.samples = this.samples.filter((sample) => sample.at >= windowStart);
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (!first || !last || last === first) return null;
    const grewTokens = last.produced - first.produced;
    const spanMs = last.at - first.at;
    if (grewTokens <= 0 || spanMs <= 0) return null;
    if (this.lastGrowthAt === null || now - this.lastGrowthAt > STREAMING_RATE_STALL_MS) {
      return null;
    }
    return Math.round((grewTokens / spanMs) * 1000 * 10) / 10;
  }
}
