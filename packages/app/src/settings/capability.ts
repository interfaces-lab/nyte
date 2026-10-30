import { clientCapabilities } from "../client-actions.ts";
import { nyte } from "../nyte.ts";

export interface SettingsContext {
  /** Runs in the desktop app, so the Mac's own notifications, Dock and sharing are here. */
  readonly desktop: boolean;
  readonly mac: boolean;
  readonly browser: boolean;
  readonly providers: boolean;
  readonly account: boolean;
  readonly usage: boolean;
}

export type Capability = keyof SettingsContext;

export function settingsContext(): SettingsContext {
  const ownEnvironment = nyte.clientSurface === "desktop";
  const { browser } = clientCapabilities(nyte.host);

  return {
    desktop: ownEnvironment,
    mac: nyte.platform === "darwin",
    browser,
    providers: ownEnvironment,
    account: ownEnvironment,
    usage: nyte.host.usage !== undefined,
  };
}

export function available(needs: readonly Capability[], context = settingsContext()): boolean {
  return needs.every((need) => context[need]);
}
