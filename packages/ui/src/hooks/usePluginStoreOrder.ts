import type { PluginStoreOrder } from "@zcode/shared";

// 独立发行版使用本地目录顺序，不再向平台下载商店排序。
const LOCAL_STORE_ORDER = {
  order: null as PluginStoreOrder | null,
  refresh: async (_forceRefresh = false) => {},
};
export function usePluginStoreOrder(_enabled = true) {
  return LOCAL_STORE_ORDER;
}
