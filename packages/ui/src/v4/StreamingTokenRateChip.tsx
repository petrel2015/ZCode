import { TID_V4_STREAM_RATE } from "@zcode/shared";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { formatTokenRateReadings } from "@/v4/streamingTokenRate.js";
import { useStreamingTokenRate } from "@/v4/useStreamingTokenRate.js";

/**
 * 双表盘速率 chip（会话视图常驻）：实时 = 流式估算（停滞/输出结束显示 0，不隐藏），
 * 平均 = snapshot.usage.throughput 的会话权威值（首轮完成前显示 —）。
 * 草稿态（snapshot 为 null）不渲染。
 */
export function StreamingTokenRateChip({ snapshot }: { snapshot: ConversationSnapshot | null }) {
  const { intl } = useZCodeIntl();
  const liveRate = useStreamingTokenRate(snapshot);
  if (!snapshot) return null;
  const readings = formatTokenRateReadings(
    liveRate,
    snapshot.usage.throughput?.avgTokensPerSecond ?? null,
  );
  return (
    <span
      data-testid={TID_V4_STREAM_RATE}
      title={intl.formatMessage({ id: "chat.streamRate.description" })}
      className="shrink-0 font-mono text-ui-xs text-foreground-subtle tabular-nums"
    >
      {intl.formatMessage({ id: "chat.streamRate.title" }, readings)}
    </span>
  );
}
