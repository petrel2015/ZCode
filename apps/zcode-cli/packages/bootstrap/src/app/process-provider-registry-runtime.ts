import {
  MutableAccountProviderConfigSource,
  parseAccountProviderConfigMap,
  type AccountProviderConfigSnapshot,
  type AccountProviderStates,
} from "@zcode/provider";
import {
  isBuiltinModelProviderId,
} from "@zcode/shared";
import {
  NodeModelSelectionConfigRepository,
  NodeProviderRegistryRuntime,
  resolveNodeProviderRuntimePaths,
} from "@zcode/provider-node";
import {
  type SharedZCodeCredentialStore,
} from "@zcode/adapters/auth";
import { readLegacyCliPersonalProviderConfig } from "./legacy-cli-personal-provider-config-importer.js";

export interface ProcessProviderRegistryRuntimeOptions {
  /** Standalone Prompt CLI / TUI 自己拥有账号凭据与旧配置的一次性导入。 */
  readonly standalone?: {
    readonly credentialStore?: SharedZCodeCredentialStore;
    readonly legacyCliUserConfigFilePath?: string;
    readonly onAccountInitializationError?: (error: unknown) => void;
    readonly request?: typeof fetch;
  };
}

export async function startProcessProviderRegistryRuntime(
  env: Readonly<Record<string, string | undefined>>,
  options: ProcessProviderRegistryRuntimeOptions = {},
) {
  const paths = resolveNodeProviderRuntimePaths(env);
  if (!paths) {
    throw new Error("缺少进程 Provider Registry 的 ZCode Built-in / Personal Config 路径");
  }

  const accountSource = new MutableAccountProviderConfigSource();
  const runtime = new NodeProviderRegistryRuntime({
    ...paths,
    accountSource,
    ...(options.standalone
      ? {
          importLegacy: () =>
            readLegacyCliPersonalProviderConfig({
              ...(options.standalone?.legacyCliUserConfigFilePath
                ? { filePath: options.standalone.legacyCliUserConfigFilePath }
                : {}),
            }),
        }
      : {}),
  });
  try {
    await runtime.start();
    const snapshot = runtime.registryService.getSnapshot()!;
    const modelSelectionConfigRepository = new NodeModelSelectionConfigRepository({
      personalRepository: runtime.personalRepository,
    });
    try {
      const configuredDefaultModelSelection = await modelSelectionConfigRepository.read();
      return Object.freeze({
        accountSource,
        providerRuntimeHeadersPort: undefined,
        async syncAccountProviderConfig(next: AccountProviderConfigSnapshot): Promise<boolean> {
          const changed = accountSource.replace(next, "host-account-config");
          // Source 去重只证明收过，不证明上次刷新成功。重交时仍刷新；配套配置未到
          // 则由 Registry 保留完整旧快照，不能把接收确认冒充应用确认。
          await runtime.registryService.refresh("host-account-config");
          return changed;
        },
        dispose() {
          modelSelectionConfigRepository.dispose();
          runtime.dispose();
        },
        runtime,
        snapshot,
        modelSelectionConfigRepository,
        configuredDefaultModelSelection,
      });
    } catch (error) {
      modelSelectionConfigRepository.dispose();
      throw error;
    }
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

/** 把协议信封解析为进程 Registry 使用的第三层 Account Config Overlay。 */
export function parseProcessAccountProviderConfigSnapshot(input: {
  readonly revision: string;
  readonly basedOnZCodeBuiltinRevision: string;
  readonly providers: unknown;
  readonly states?: AccountProviderStates;
}): AccountProviderConfigSnapshot {
  const revision = input.revision.trim();
  if (!revision) throw new Error("Account Config revision 不能为空");
  const basedOnZCodeBuiltinRevision = input.basedOnZCodeBuiltinRevision.trim();
  if (!basedOnZCodeBuiltinRevision) {
    throw new Error("Account Config Built-in revision 不能为空");
  }
  const providers = parseAccountProviderConfigMap(input.providers);
  for (const [providerId, provider] of providers.entries()) {
    // 仅约束托管 Worker 的普通账号信封；独立 CLI、API 和闲时不需要 current。
    if (
      isBuiltinModelProviderId(providerId) &&
      provider.access?.type === "zhipu-account" &&
      provider.access.entitled &&
      typeof input.states?.[providerId]?.current !== "boolean"
    ) {
      throw new Error(`Account State 缺少 current: ${providerId}`);
    }
  }
  return Object.freeze({
    revision,
    basedOnZCodeBuiltinRevision,
    providers,
    // 与 Overlay 属于同一快照；不能只更新 revision 却丢掉当前连接事实。
    ...(input.states ? { states: input.states } : {}),
  });
}
