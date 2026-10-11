/**
 * The connection and host as the login test's browser sees them: only what
 * Settings › Providers calls, every call recorded, and every answer chosen
 * by the test from outside the page. Installed before any renderer module
 * reads `window.nyte` or the connection.
 */
import type { HostView, ModelCatalogView } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { HostBridge } from "../../bridge.ts";
import { installConnection } from "../../sdk.tsx";
import { scriptedConnection, viewStream } from "../../../test/scripted-connection.ts";

/** A login step the host's flow yields. */
export type HarnessStep =
  | { readonly kind: "open"; readonly url: string; readonly code?: string }
  | { readonly kind: "waiting" }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly reason: string };

export type RecordedHostCall =
  | {
      readonly path: "models.login";
      readonly input: { readonly provider: string; readonly method: { readonly kind: string } };
    }
  | { readonly path: "models.login.cancel" }
  | { readonly path: "models.logout"; readonly input: string }
  | {
      readonly path: "host.openExternal";
      readonly input: Parameters<HostBridge["openExternal"]>[0];
    };

export interface HarnessFailures {
  readonly open: boolean;
  readonly clipboard: boolean;
}

/** What the test drives from Node through `page.evaluate`. */
interface LoginHarness {
  readonly calls: readonly RecordedHostCall[];
  readonly clipboard: readonly string[];
  /** Which boundary calls refuse from now on. */
  setFailures(failures: Partial<HarnessFailures>): void;
  /** The catalog `models.list` answers; the host view's generation moves with it. */
  setCatalog(catalog: Omit<ModelCatalogView, "generation">): void;
  /** Yields one step of the running sign-in. */
  step(step: HarnessStep): void;
}

declare global {
  interface Window {
    readonly nyteLoginHarness: LoginHarness;
  }
}

const calls: RecordedHostCall[] = [];

const clipboard: string[] = [];

let failures: HarnessFailures = { open: false, clipboard: false };

let generation = 0;

let catalog: ModelCatalogView = {
  generation: asId<"catalog-generation">("0"),
  default: null,
  providers: [],
};

const hostView = (): HostView => ({
  id: asId<"host">("harness"),
  link: { kind: "connected" },
  name: "Harness",
  platform: "darwin",
  version: "0",
  catalog: catalog.generation,
  plugins: [],
  settings: [],
  authority: new Set(["participant", "owner"]),
  operations: [],
});

const host = viewStream(hostView());

const steps = new Set<(step: HarnessStep) => void>();

/** One sign-in's steps: each step the test yields, until the page drops the iterator, which is recorded. */
function flow(): AsyncIterable<HarnessStep> {
  const queued: HarnessStep[] = [];
  let pull: ((result: IteratorResult<HarnessStep>) => void) | undefined;

  const take = (step: HarnessStep): void => {
    if (pull === undefined) {
      queued.push(step);

      return;
    }

    const resolve = pull;
    pull = undefined;
    resolve({ value: step, done: false });
  };

  steps.add(take);

  return {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        const step = queued.shift();

        return step === undefined
          ? new Promise<IteratorResult<HarnessStep>>((resolve) => {
              pull = resolve;
            })
          : Promise.resolve({ value: step, done: false });
      },
      return: async () => {
        steps.delete(take);
        calls.push({ path: "models.login.cancel" });
        pull?.({ value: undefined, done: true });

        return { value: undefined, done: true };
      },
    }),
  };
}

installConnection(
  scriptedConnection({
    host,
    models: {
      list: async () => catalog,
      login: (input) => {
        calls.push({ path: "models.login", input });

        return { steps: flow, answer: async () => undefined };
      },
      logout: async (provider) => {
        calls.push({ path: "models.logout", input: provider });
      },
    },
  }).connection,
);

const bridgeHost: Pick<HostBridge, "openExternal" | "setThemePreference" | "onEvent"> = {
  openExternal: async (input) => {
    calls.push({ path: "host.openExternal", input });

    if (failures.open) throw new Error("open refused");
  },
  setThemePreference: () => undefined,
  onEvent: () => () => undefined,
};

const harness: LoginHarness = {
  calls,
  clipboard,
  setFailures: (next) => {
    failures = { ...failures, ...next };
  },
  setCatalog: (next) => {
    generation += 1;
    catalog = { ...next, generation: asId<"catalog-generation">(String(generation)) };
    host.push(hostView());
  },
  step: (step) => {
    for (const take of steps) take(step);
  },
};

Object.defineProperty(window, "nyte", { value: { clientSurface: "desktop", host: bridgeHost } });

Object.defineProperty(window, "nyteLoginHarness", { value: harness });

Object.defineProperty(navigator, "clipboard", {
  value: {
    writeText: async (text: string) => {
      if (failures.clipboard) throw new Error("clipboard refused");
      clipboard.push(text);
    },
  },
});
