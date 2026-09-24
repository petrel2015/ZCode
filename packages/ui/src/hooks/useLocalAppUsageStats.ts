import { useCallback, useEffect, useRef, useState } from "react";
import type { AppUsageRange, AppUsageSnapshot } from "@zcode/shared";
import { logger } from "@/logger.js";
import { useServices } from "@/hooks/useServices.js";

interface LocalAppUsageStatsState {
  snapshot: AppUsageSnapshot | null;
  loading: boolean;
  error: string | null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || String(error);
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return String(error);
}

// 增强分支并存改造（issue #16）：官方 useAppUsageStats 走 usageStatsService
// （内部同样转发 agent usage store），但签名不含 hourlyDate；速率趋势图的
// 24 小时桶查询走本 hook——直接经 zcodeAgentService → v4 usage/stats →
// CLI usage store，不经过任何平台 monitor API，与官方 hook 并存互不影响。
export function useLocalAppUsageStats(range: AppUsageRange, hourlyDate?: string) {
  const { zcodeAgentService } = useServices();
  const [state, setState] = useState<LocalAppUsageStatsState>({
    snapshot: null,
    loading: false,
    error: null,
  });
  const requestVersionRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setState((current) => ({
      snapshot: current.snapshot,
      loading: true,
      error: null,
    }));
    try {
      // App Usage 只聚合本地 session 库的真实统计，经 zcodeAgentService →
      // v4 usage/stats → CLI usage store 读取；不经过任何平台 monitor API。
      // hourlyDate 仅请求该日的 24 小时速率桶（docs/specs/usage-stats-app-usage.md）。
      const snapshot = await zcodeAgentService.getAppUsageStats({
        range,
        timeZone,
        ...(hourlyDate ? { hourlyDate } : {}),
      });
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      setState({ snapshot, loading: false, error: null });
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      const message = getErrorMessage(error);
      logger.warn("[useLocalAppUsageStats] 读取本地使用统计失败", {
        range,
        timeZone,
        error: message,
      });
      setState((current) => ({
        snapshot: current.snapshot,
        loading: false,
        error: message,
      }));
    }
  }, [range, hourlyDate, zcodeAgentService]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
