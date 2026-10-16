/**
 * What this host can back, in a leaf module: rows and pages both ask it, and
 * the page table imports every page, so the question can't live there.
 */
import { clientCapabilities } from "../client-actions.ts";
import { nyte } from "../nyte.ts";
import { macPlatform } from "../platform.ts";

/** What this host can back. A row or page shows only where everything it needs holds. */
export interface SettingsContext {
  /** ~/.nyte/settings.json is reachable: the desktop, not the web app or mobile. */
  readonly hostSettings: boolean;
  readonly mac: boolean;
  /** The built-in browser panel exists. */
  readonly browser: boolean;
  /** Sign-ins and model defaults change here: the desktop, or a server environment not reached over the relay. */
  readonly providers: boolean;
  readonly account: boolean;
  readonly usage: boolean;
}

export type Capability = keyof SettingsContext;

/**
 * Computed per call: the installed bridge decides, and tests install different
 * ones. Tests resolve pages under node, where there is no document to ask.
 */
export function settingsContext(): SettingsContext {
  const ownEnvironment = nyte.clientSurface === "desktop";
  const { browser } = clientCapabilities(nyte.host);

  return {
    hostSettings: nyte.host.settings !== undefined,
    mac: typeof document !== "undefined" && macPlatform(undefined),
    browser,
    providers: ownEnvironment,
    account: ownEnvironment,
    usage: nyte.host.usage !== undefined,
  };
}

export function available(needs: readonly Capability[], context = settingsContext()): boolean {
  return needs.every((need) => context[need]);
}
