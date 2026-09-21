import { z } from "zod";

export const SESSION_DEBUG_LIMITS = { rounds: 200, network: 100, dedupe: 2000 } as const;
export const sessionDebugParamsSchema = z.object({ sessionId: z.string().min(1) }).strict();
const count = z.number().finite().nonnegative();
const debugUsageSchema = z
  .object({
    inputTokens: count.optional(),
    outputTokens: count.optional(),
    totalTokens: count.optional(),
    reasoningTokens: count.optional(),
    cachedInputTokens: count.optional(),
    cachedWriteInputTokens: count.optional(),
  })
  .strict();
export const sessionDebugRoundSchema = z
  .object({
    eventKey: z.string(),
    requestId: z.string(),
    requestIndex: count,
    recordedAt: count,
    usage: debugUsageSchema,
    hitRate: count.nullable(),
    generationDurationMs: count.nullable(),
    tokensPerSecond: count.nullable(),
  })
  .strict();
// 会话级吞吐汇总：权威 TPS 事实由本旁路唯一累积，rounds 数组有截断上限，汇总不得从它二次推导。
export const sessionDebugThroughputSchema = z
  .object({
    countedRounds: count,
    totalOutputTokens: count,
    totalGenerationMs: count,
    avgTokensPerSecond: count.nullable(),
    lastTokensPerSecond: count.nullable(),
  })
  .strict();
export type SessionDebugThroughput = z.infer<typeof sessionDebugThroughputSchema>;
export const sessionDebugNetworkEntrySchema = z
  .object({
    eventKey: z.string(),
    traceId: z.string(),
    recordedAt: count,
    statusType: z.enum([
      "model_request_started",
      "model_request_completed",
      "model_request_failed",
      "model_retry_scheduled",
      "model_stream_stalled",
    ]),
    requestId: z.string().optional(),
    providerId: z.string().optional(),
    modelId: z.string().optional(),
    providerKind: z.string().optional(),
    transport: z.string().optional(),
    baseURL: z.string().optional(),
    querySource: z.string().optional(),
    queryId: z.string().optional(),
    timestamp: z.string().optional(),
    attempt: count.optional(),
    maxAttempts: count.optional(),
    nextAttempt: count.optional(),
    retryable: z.boolean().optional(),
    statusCode: count.optional(),
    durationMs: count.optional(),
    delayMs: count.optional(),
    idleMs: count.optional(),
    timeoutMs: count.optional(),
    reason: z.string().optional(),
    message: z.string().optional(),
    requestHeaders: z.record(z.string(), z.string()),
    responseHeaders: z.record(z.string(), z.string()),
    requestHeaderCount: count,
    responseHeaderCount: count,
  })
  .strict();
export const sessionDebugSnapshotSchema = z
  .object({
    sessionId: z.string(),
    rounds: z.array(sessionDebugRoundSchema).max(SESSION_DEBUG_LIMITS.rounds),
    networkEntries: z.array(sessionDebugNetworkEntrySchema).max(SESSION_DEBUG_LIMITS.network),
    cache: z
      .object({
        hitRateRequestCount: count,
        totalInputTokens: count,
        totalCacheReadTokens: count,
        hitRate: count.nullable(),
      })
      .strict()
      .nullable(),
    // additive + optional：旧 CLI 响应缺该字段时仍可解析，UI 按缺数据显示 "-"。
    throughput: sessionDebugThroughputSchema.optional(),
  })
  .strict();
export type SessionDebugSnapshot = z.infer<typeof sessionDebugSnapshotSchema>;
export type SessionDebugNetworkEntry = z.infer<typeof sessionDebugNetworkEntrySchema>;

/** 输出 token 与首输出到请求结束的同源时间；未知值不能用请求总耗时替代。 */
export function calculateOutputTps(
  outputTokens: number | undefined,
  generationDurationMs: number | null,
): number | null {
  if (
    outputTokens === undefined ||
    !Number.isFinite(outputTokens) ||
    outputTokens < 0 ||
    generationDurationMs === null ||
    !Number.isFinite(generationDurationMs) ||
    generationDurationMs <= 0
  )
    return null;
  const tps = (outputTokens * 1000) / generationDurationMs;
  return Number.isFinite(tps) ? tps : null;
}

export function emptySessionThroughput(): SessionDebugThroughput {
  return {
    countedRounds: 0,
    totalOutputTokens: 0,
    totalGenerationMs: 0,
    avgTokensPerSecond: null,
    lastTokensPerSecond: null,
  };
}

/**
 * 会话吞吐按完成轮累积（token 加权平均）。只有同时具备权威 outputTokens 与同源
 * generationDurationMs 的轮才计入：缺生成时长的轮整轮跳过，避免把排队或首 token
 * 延迟摊进速率，也避免出现只加分母不加分子的不对称累计。
 */
export function accumulateSessionThroughput(
  previous: SessionDebugThroughput | null,
  outputTokens: number | undefined,
  generationDurationMs: number | null,
): SessionDebugThroughput {
  const roundTps = calculateOutputTps(outputTokens, generationDurationMs);
  if (roundTps === null || outputTokens === undefined) {
    return previous ?? emptySessionThroughput();
  }
  const totalOutputTokens = (previous?.totalOutputTokens ?? 0) + outputTokens;
  const totalGenerationMs = (previous?.totalGenerationMs ?? 0) + (generationDurationMs ?? 0);
  return {
    countedRounds: (previous?.countedRounds ?? 0) + 1,
    totalOutputTokens,
    totalGenerationMs,
    avgTokensPerSecond:
      totalGenerationMs > 0 ? (totalOutputTokens * 1000) / totalGenerationMs : null,
    lastTokensPerSecond: roundTps,
  };
}
