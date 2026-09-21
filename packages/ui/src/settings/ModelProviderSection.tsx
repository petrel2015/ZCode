import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useModelProviders } from "@/hooks/useModelProviders.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";
import type { SettingsModelProviderTarget } from "@/lib/settingsNavigation.js";
import { InlineEditableProviderCard } from "./model-provider-section/InlineEditableProviderCard.js";
import { ProviderTemplatePicker } from "./model-provider-section/ProviderTemplatePicker.js";
import { ProviderDetailFeedbackBoundary } from "./model-provider-section/ProviderDetailFeedback.js";
import { confirmAndDeleteModelProvider } from "./model-provider-section/modelProviderActions.js";

export {
  fuzzyMatch,
  handleEndpointSuggestionPopoverOpenAutoFocus,
  resolveEndpointSuggestionOpenRequest,
} from "./model-provider-section/utils.js";

/** 模型配置只操作个人 Provider；账号、套餐与平台权益不参与配置或执行。 */
export function ModelProviderSection({
  workspacePath = "",
  connectivityWorkspacePath,
  connectivityWorkspaceRequired = false,
  pendingModelProviderTarget,
}: {
  workspacePath?: string;
  connectivityWorkspacePath?: string;
  connectivityWorkspaceRequired?: boolean;
  pendingModelProviderTarget?: SettingsModelProviderTarget;
  onConsumePendingModelProviderTarget?: () => void;
} = {}) {
  const { intl, locale } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();
  const model = useModelProviders({
    workspacePath,
    connectivityWorkspacePath,
    connectivityWorkspaceRequired,
  });
  const [selectedId, setSelectedId] = useState<string | null>(
    pendingModelProviderTarget?.providerId ?? null,
  );
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const providers = model.modelProviders.filter(
    (provider) => provider.config.access?.type !== "zhipu-account",
  );
  const selected = providers.find((provider) => provider.providerId === selectedId) ?? providers[0];

  const create = async (input: { templateId?: string; providerName?: string }) => {
    setCreating(true);
    try {
      const result = await model.createPersonalProvider({ ...input, locale });
      setSelectedId(result.providerId);
      setAdding(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => void model.refresh()} disabled={model.refreshing}>
          {intl.formatMessage({ id: "common.refresh" })}
        </Button>
        <Button onClick={() => setAdding(true)}>
          {intl.formatMessage({ id: "settings.modelProvider.newProviderName" })}
        </Button>
      </div>
      {model.loadError ? (
        <p role="alert" className="text-ui-base text-destructive">
          {intl.formatMessage({ id: "root.modelSelection.loadFailed" })}
        </p>
      ) : null}
      {model.loading ? (
        <p className="text-ui-base">{intl.formatMessage({ id: "common.loading" })}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
          <nav className="flex flex-wrap gap-1 md:flex-col">
            {providers.map((provider) => (
              <Button
                key={provider.providerId}
                variant={
                  selected?.providerId === provider.providerId && !adding ? "secondary" : "ghost"
                }
                onClick={() => {
                  setSelectedId(provider.providerId);
                  setAdding(false);
                }}
              >
                {getProviderFormLabel(provider)}
              </Button>
            ))}
          </nav>
          <div className="min-w-0 rounded-xl border border-border bg-card p-4">
            <ProviderDetailFeedbackBoundary
              key={adding ? "templates" : (selected?.providerId ?? "empty")}
            >
              {adding || !selected ? (
                <ProviderTemplatePicker
                  templates={model.providerTemplates}
                  creating={creating}
                  onBack={() => setAdding(false)}
                  onCreateFromTemplate={(templateId) => create({ templateId })}
                  onCreateCustom={(providerName) => create({ providerName })}
                />
              ) : (
                <InlineEditableProviderCard
                  provider={selected}
                  onSave={async (provider) => {
                    await model.saveProvider(provider);
                  }}
                  onAddPersonalModel={model.addPersonalModel}
                  onSavePersonalModelDraft={model.savePersonalModelDraft}
                  onSetPersonalModelEnabled={model.setPersonalModelEnabled}
                  onDeletePersonalModel={model.deletePersonalModel}
                  onTestModel={model.testModelConnectivity}
                  onReorderModelIds={(ids) => model.reorderProviderModels(selected.providerId, ids)}
                  onDelete={() =>
                    confirmAndDeleteModelProvider({
                      provider: selected,
                      confirmDialog,
                      intl,
                      deleteProvider: model.deleteProvider,
                    })
                  }
                  readOnlyEndpoints={false}
                  nameEditable
                  settingsRevision={model.providerSettingsView?.revision}
                />
              )}
            </ProviderDetailFeedbackBoundary>
          </div>
        </div>
      )}
    </div>
  );
}
