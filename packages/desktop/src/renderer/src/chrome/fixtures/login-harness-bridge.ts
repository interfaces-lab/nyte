/**
 * The host bridge as the login test's browser sees it: only what Settings ›
 * Models calls, every call recorded, and every answer chosen by the test from
 * outside the page. Installed before any renderer module reads `window.nyte`.
 */
import type {
  DesktopCatalog,
  HostBridge,
  HostEvent,
  LoginOutcome,
} from "../../../../shared/ipc.ts";

export type RecordedHostCall =
  | { readonly path: "host.login"; readonly input: Parameters<HostBridge["login"]>[0] }
  | { readonly path: "host.cancelLogin"; readonly input: Parameters<HostBridge["cancelLogin"]>[0] }
  | {
      readonly path: "host.openExternal";
      readonly input: Parameters<HostBridge["openExternal"]>[0];
    }
  | { readonly path: "host.logout"; readonly input: Parameters<HostBridge["logout"]>[0] };

export interface HarnessFailures {
  readonly cancel: boolean;
  readonly open: boolean;
  readonly clipboard: boolean;
}

/** What the test drives from Node through `page.evaluate`. */
interface LoginHarness {
  readonly calls: readonly RecordedHostCall[];
  readonly clipboard: readonly string[];
  /** Which boundary calls refuse from now on. */
  setFailures(failures: Partial<HarnessFailures>): void;
  setCatalog(catalog: DesktopCatalog): void;
  emit(event: HostEvent): void;
  resolveLogin(outcome: LoginOutcome): void;
  rejectLogin(): void;
}

declare global {
  interface Window {
    readonly nyteLoginHarness: LoginHarness;
  }
}

type SettingsHost = Pick<
  HostBridge,
  "catalog" | "login" | "cancelLogin" | "logout" | "openExternal" | "onEvent" | "setPreference"
>;

const calls: RecordedHostCall[] = [];
const clipboard: string[] = [];
const listeners = new Set<(event: HostEvent) => void>();
// Reassigned, never mutated: a bundler may otherwise fold the reads to false.
let failures: HarnessFailures = { cancel: false, open: false, clipboard: false };
let catalog: DesktopCatalog = {
  source: "local",
  providers: [],
  models: [],
  defaults: { model: { provider: "", id: "" }, thinkingLevel: "off" },
};
let pendingLogin: { resolve(outcome: LoginOutcome): void; reject(error: Error): void } | undefined;

const host: SettingsHost = {
  catalog: async () => catalog,
  login: (input) => {
    calls.push({ path: "host.login", input });
    return new Promise<LoginOutcome>((resolve, reject) => {
      pendingLogin = { resolve, reject };
    });
  },
  cancelLogin: async (input) => {
    calls.push({ path: "host.cancelLogin", input });
    if (failures.cancel) throw new Error("cancel refused");
  },
  logout: async (input) => {
    calls.push({ path: "host.logout", input });
  },
  openExternal: async (input) => {
    calls.push({ path: "host.openExternal", input });
    if (failures.open) throw new Error("open refused");
  },
  setPreference: async () => catalog,
  onEvent: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

const harness: LoginHarness = {
  calls,
  clipboard,
  setFailures: (next) => {
    failures = { ...failures, ...next };
  },
  setCatalog: (next) => {
    catalog = next;
  },
  emit: (event) => {
    for (const listener of listeners) listener(event);
  },
  resolveLogin: (outcome) => {
    pendingLogin?.resolve(outcome);
    pendingLogin = undefined;
  },
  rejectLogin: () => {
    pendingLogin?.reject(new Error("sign-in failed"));
    pendingLogin = undefined;
  },
};

// The renderer's bridge is a readonly global; the harness owns it here.
Object.defineProperty(window, "nyte", { value: { host } });
Object.defineProperty(window, "nyteLoginHarness", { value: harness });
// A test never writes the user's clipboard.
Object.defineProperty(navigator, "clipboard", {
  value: {
    writeText: async (text: string) => {
      if (failures.clipboard) throw new Error("clipboard refused");
      clipboard.push(text);
    },
  },
});
