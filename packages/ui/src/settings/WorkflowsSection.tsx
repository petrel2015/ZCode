import type { ComponentProps } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SavedWorkflowsSection } from "./saved-workflows/SavedWorkflowsSection.js";

export const WORKFLOWS_TOAST_ANCHOR_ID = "workflows-main-toast-anchor";

/** 只保留用户手动创建/运行的工作流；没有定时或闲时标签及后台执行入口。 */
export function WorkflowsSection(props: ComponentProps<typeof SavedWorkflowsSection>) {
  const { intl } = useZCodeIntl();
  return (
    <SavedWorkflowsSection
      {...props}
      header={
        <div className="space-y-2">
          <h1 className="text-ui-xl font-semibold">
            {intl.formatMessage({ id: "workflows.hub.sectionTitle" })}
          </h1>
          <p className="text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "workflows.hub.description" })}
          </p>
        </div>
      }
    />
  );
}
