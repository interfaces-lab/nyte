/**
 * The renderer's handle on the SDK. `window.nyte` is the preload's bridge: the
 * SDK interfaces verbatim, `watch` as a push subscription, plus the host
 * namespace. This client keeps no state beyond query caches and cursors.
 */
import type { NyteBridge } from "../../shared/ipc.ts";

declare global {
  interface Window {
    readonly nyte: NyteBridge;
  }
}

export const nyte: NyteBridge = window.nyte;

export type {
  DesktopCatalog,
  DesktopModelOption,
  DesktopVcsSnapshot,
  GitHubAccount,
  GitHubProviderState,
  GitHubPullRequest,
  GitHubPullRequestContext,
  GitHubRepository,
  HostEvent,
  HostState,
  LocalFontCatalog,
  OpenWorkspaceOutcome,
  PreferenceChange,
  ProviderStatus,
  SignInMethod,
  ThemePreference,
  UsageEntry,
  UsageReport,
  UsageSession,
  UsageSource,
  UsageSubject,
  UsageTotals,
  UsageWindow,
  WatchInput,
} from "../../shared/ipc.ts";
