import { TID_V4_STREAM_RATE } from "@zcode/shared";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useStreamingTokenRate } from "@/v4/useStreamingTokenRate.js";

/** 流式生成中的实时速率 chip；估算无读数时整颗隐藏，不给 0 假象。 */
export function StreamingTokenRateChip({ snapshot }: { snapshot: ConversationSnapshot | null }) {
  const { intl } = useZCodeIntl();
  const rate = useStreamingTokenRate(snapshot);
  if (rate === null) return null;
  return (
    <span
      data-testid={TID_V4_STREAM_RATE}
      title={intl.formatMessage({ id: "chat.streamRate.description" })}
      className="shrink-0 font-mono text-ui-xs text-foreground-subtle tabular-nums"
    >
      {intl.formatMessage({ id: "chat.streamRate.title" }, { rate: rate.toFixed(1) })}
    </span>
  );
}
