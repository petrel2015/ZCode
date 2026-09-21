import type { BrowserWindow } from "electron";
import type { ExternalWorkspaceOpenDialogCopy } from "./desktopOAuthDeepLink.js";
import {
  extractOpenWorkspacePathFromArgs,
  extractOpenWorkspacePathFromSingleInstanceData,
} from "./desktopDeepLinkUrl.js";

interface SecondInstanceWorkspaceDeps {
  additionalData: unknown;
  argv: readonly string[];
  handleDeepLink: (
    url: string,
    options: {
      confirmationCopy?: ExternalWorkspaceOpenDialogCopy;
      resolveApplicationWindow?: () => BrowserWindow | null;
    },
  ) => boolean;
  handleOpenWorkspacePath: (
    path: string,
    options?: {
      allowWithoutReadyWindow?: boolean;
      resolveApplicationWindow?: () => BrowserWindow | null;
    },
  ) => boolean;
  logger: { warn: (...args: unknown[]) => void };
  workspaceConfirmationCopy?: ExternalWorkspaceOpenDialogCopy;
  resolveApplicationWindow?: () => BrowserWindow | null;
}

export function handleSecondInstanceWorkspaceRequest(deps: SecondInstanceWorkspaceDeps): boolean {
  const openWorkspacePath =
    extractOpenWorkspacePathFromSingleInstanceData(deps.additionalData) ??
    extractOpenWorkspacePathFromArgs(deps.argv);
  return Boolean(
    openWorkspacePath &&
    deps.handleOpenWorkspacePath(openWorkspacePath, {
      resolveApplicationWindow: deps.resolveApplicationWindow,
    }),
  );
}
