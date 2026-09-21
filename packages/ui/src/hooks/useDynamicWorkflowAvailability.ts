import { createDynamicWorkflowClientConfig } from "@zcode/shared";
const localAvailability = {
  status: "ready" as const,
  enabled: true,
  config: createDynamicWorkflowClientConfig("alwaysOn", "default"),
};
/** 独立版本的工作流由本地产品配置提供，不查询平台灰度。 */
export function useDynamicWorkflowAvailability() {
  return localAvailability;
}
