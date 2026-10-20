import { clientCapabilities } from "../client-actions.ts";
import { nyte } from "../nyte.ts";

export interface SettingsContext {
  readonly hostSettings: boolean;
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
    hostSettings: nyte.host.settings !== undefined,
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
