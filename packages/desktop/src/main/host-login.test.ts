import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore } from "@nyte-ai/ai";
import type {
  Credential,
  CredentialStore,
  MutableModels,
  OAuthCredential,
  ProviderAuthInteraction,
} from "@nyte-ai/ai";
import type { Api, Model } from "@nyte-ai/schema";
import type { DesktopCatalog, HostEvent, LoginOutcome } from "../shared/ipc.ts";
import { DesktopHost } from "./host.ts";

interface RecordedRefresh {
  readonly allowNetwork: boolean;
  readonly force: boolean | undefined;
}

interface DeviceProviderState {
  polling: boolean;
  aborted: boolean;
  readonly refreshes: RecordedRefresh[];
  discoveryFails: boolean;
  models: readonly Model<Api>[];
}

interface DeviceProviderOptions {
  /** The flow keeps polling after an abort, as a provider that forgot the signal would. */
  readonly ignoresAbort?: boolean;
  readonly credentials?: CredentialStore;
}

function fixtureModel(provider: string, id: string, name: string): Model<Api> {
  return {
    id,
    name,
    api: "openai-responses",
    provider,
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 1_000,
  };
}

const neverStreams = () => {
  throw new Error("Login tests never stream");
};

/**
 * A device-code provider shaped like GitHub Copilot's flow: it hands the
 * desktop a user code, then polls until the test approves, denies, or the
 * host aborts. The device secret never leaves this closure. The model list is
 * account-specific, so it only exists after a forced network refresh.
 */
function deviceCodeProvider(options: DeviceProviderOptions = {}) {
  const approved = new AbortController();
  const state: DeviceProviderState = {
    polling: false,
    aborted: false,
    refreshes: [],
    discoveryFails: false,
    models: [],
  };
  const model = fixtureModel("device", "copilot-fixture", "Copilot Fixture");
  const login = (interaction: ProviderAuthInteraction): Promise<OAuthCredential> => {
    const deviceSecret = "device-secret-never-shown";
    interaction.notify({
      type: "device_code",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      intervalSeconds: 5,
      expiresInSeconds: 900,
      instructions: "Approve the fixture app.",
    });
    interaction.notify({ type: "progress", message: "Waiting for GitHub" });
    state.polling = true;
    return new Promise<OAuthCredential>((resolve, reject) => {
      const finish = () => {
        state.polling = false;
        interaction.signal.removeEventListener("abort", onAbort);
        approved.signal.removeEventListener("abort", onApproved);
      };
      const onAbort = () => {
        state.aborted = true;
        finish();
        reject(interaction.signal.reason);
      };
      const onApproved = () => {
        finish();
        resolve({
          type: "oauth",
          refresh: "",
          access: `token-for-${deviceSecret}`,
          expires: Date.now() + 3_600_000,
        });
      };
      if (options.ignoresAbort !== true)
        interaction.signal.addEventListener("abort", onAbort, { once: true });
      approved.signal.addEventListener("abort", onApproved, { once: true });
    });
  };
  const create = (): MutableModels => {
    const models = createModels({
      credentials: options.credentials ?? new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(),
    });
    // The real catalog always has static models beside a dynamic provider;
    // readCatalog needs at least one to name a default.
    models.setProvider({
      id: "static",
      name: "Static",
      auth: { apiKey: { name: "Fixture", resolve: async () => undefined } },
      getModels: () => [fixtureModel("static", "static-fixture", "Static Fixture")],
      stream: neverStreams,
      streamSimple: neverStreams,
    });
    models.setProvider({
      id: "device",
      name: "Device",
      auth: {
        oauth: {
          name: "Device subscription",
          login,
          refresh: async (credential) => credential,
          toAuth: async (credential) => ({ apiKey: credential.access }),
        },
      },
      getModels: () => state.models,
      refreshModels: async (context) => {
        state.refreshes.push({ allowNetwork: context.allowNetwork, force: context.force });
        if (!context.allowNetwork) return;
        if (state.discoveryFails) throw new Error("Model discovery is down");
        await context.publish({ update: () => (state.models = [model]) });
      },
      stream: neverStreams,
      streamSimple: neverStreams,
    });
    return models;
  };
  return { create, state, approve: () => approved.abort() };
}

/**
 * A credential store whose write, once begun, lands only when the test lets
 * it, and whose delete does not queue behind that write. It stands in for a
 * store that has already committed to a write when a logout arrives.
 */
function lateCommittingCredentialStore() {
  const credentials = new Map<string, Credential>();
  const gate = new AbortController();
  const state = { writesStarted: 0, writesLanded: 0 };
  const store: CredentialStore = {
    read: async (providerId) => credentials.get(providerId),
    list: async () =>
      [...credentials].map(([providerId, credential]) => ({ providerId, type: credential.type })),
    modify: async (providerId, fn) => {
      state.writesStarted += 1;
      const next = await fn(credentials.get(providerId));
      if (!gate.signal.aborted)
        await new Promise<void>((resolve) =>
          gate.signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      if (next !== undefined) credentials.set(providerId, next);
      state.writesLanded += 1;
      return next ?? credentials.get(providerId);
    },
    delete: async (providerId) => {
      credentials.delete(providerId);
    },
  };
  return { store, state, land: () => gate.abort() };
}

interface BrowserProviderOptions {
  readonly offersBrowser: boolean;
  /** The provider emits this instead of a web address. */
  readonly authUrl?: string;
  /** The manual-code prompt carries no signal; only the desktop can release it. */
  readonly holdsManualCode?: boolean;
}

/** A browser provider like Anthropic's: a method choice, an auth URL, and a manual-code prompt held open. */
function browserProvider(options: BrowserProviderOptions) {
  const prompts: string[] = [];
  const state = { prompts, manualCodeReleased: false, manualCodeReason: "" };
  const model = fixtureModel("browser", "browser-fixture", "Browser Fixture");
  const create = (): MutableModels => {
    const models = createModels({
      credentials: new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(),
    });
    models.setProvider({
      id: "browser",
      name: "Browser",
      auth: {
        oauth: {
          name: "Browser subscription",
          login: async (interaction) => {
            const method = await interaction.prompt({
              type: "select",
              message: "How do you want to sign in?",
              options: options.offersBrowser
                ? [
                    { id: "browser", label: "Browser" },
                    { id: "device", label: "Device code" },
                  ]
                : [{ id: "device", label: "Device code" }],
            });
            prompts.push(method);
            interaction.notify({
              type: "auth_url",
              url: options.authUrl ?? "https://example.com/authorize",
            });
            if (options.holdsManualCode === true) {
              // No prompt signal: the flow relies on the desktop to let go.
              try {
                await interaction.prompt({ type: "manual_code", message: "Paste the code" });
              } catch (error) {
                state.manualCodeReleased = true;
                state.manualCodeReason = error instanceof Error ? error.message : String(error);
                throw error;
              }
            }
            const manualAbort = new AbortController();
            const manual = interaction
              .prompt({
                type: "manual_code",
                message: "Paste the code",
                signal: manualAbort.signal,
              })
              .catch(() => undefined);
            // The callback server "lands" and the manual prompt is released.
            manualAbort.abort();
            await manual;
            return { type: "oauth", refresh: "r", access: "a", expires: Date.now() + 3_600_000 };
          },
          refresh: async (credential) => credential,
          toAuth: async (credential) => ({ apiKey: credential.access }),
        },
      },
      getModels: () => [model],
      stream: neverStreams,
      streamSimple: neverStreams,
    });
    return models;
  };
  return { create, state };
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

async function desktop(createModels: () => MutableModels) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-host-login-")));
  vi.stubEnv("NYTE_HOME", join(root, "state"));
  const events: HostEvent[] = [];
  const opened: string[] = [];
  const host = new DesktopHost({
    storeWorker: new URL("../../../core/src/kernel/store-worker.ts", import.meta.url),
    createModels,
    emitHostEvent: (event) => events.push(event),
    emitWatchEvent: () => undefined,
    openExternal: (url) => opened.push(url),
    pickFolder: async () => undefined,
    listFonts: async () => ({ sans: [], monospace: [] }),
    browser: {
      menu: async () => undefined,
      perform: async () => undefined,
      open: () => {
        throw new Error("Browser surfaces are not used by login tests");
      },
      navigate: () => undefined,
      close: () => undefined,
      setBounds: () => undefined,
      warm: async () => undefined,
      dispose: () => undefined,
    },
  });
  cleanups.push(
    () => host.close(),
    () => rm(root, { recursive: true, force: true }),
  );
  return { host, events, opened };
}

function deviceStatus(catalog: DesktopCatalog) {
  return catalog.providers.find((provider) => provider.id === "device")?.connection.kind;
}

function deviceModels(catalog: DesktopCatalog) {
  return catalog.models
    .filter((option) => option.provider === "device")
    .map((option) => [option.key, option.listed]);
}

function loginEvents(events: readonly HostEvent[]) {
  return events.flatMap((event) => (event.kind === "login_progress" ? [event] : []));
}

async function settled(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i += 1) await new Promise((r) => setTimeout(r, 5));
  assert.ok(condition(), "condition never held");
}

function deviceLogin(host: DesktopHost, attempt: string) {
  return host.call("host.login", { provider: "device", method: { kind: "browser" }, attempt });
}

test("a device code reaches the renderer without the device secret and the provider connects on approval", async () => {
  const provider = deviceCodeProvider();
  const { host, events, opened } = await desktop(provider.create);
  const before = await host.call("host.catalog", undefined);
  assert.equal(deviceStatus(before), "disconnected");
  assert.deepEqual(deviceModels(before), []);

  const pending = deviceLogin(host, "attempt-1");
  await settled(() => provider.state.polling);
  const progress = loginEvents(events);
  assert.deepEqual(
    progress.map((event) => [event.attempt, event.provider, event.progress]),
    [
      [
        "attempt-1",
        "device",
        {
          kind: "device_code",
          userCode: "ABCD-1234",
          verificationUri: "https://github.com/login/device",
          expiresInSeconds: 900,
          instructions: "Approve the fixture app.",
        },
      ],
      ["attempt-1", "device", { kind: "message", message: "Waiting for GitHub" }],
    ],
  );
  assert.doesNotMatch(JSON.stringify(events), /device-secret/);
  // A device code is shown, not opened: the user copies it first.
  assert.deepEqual(opened, []);

  provider.approve();
  const outcome = await pending;
  assert.deepEqual(outcome, { kind: "connected", catalogRefreshed: true } satisfies LoginOutcome);
  assert.ok(events.some((event) => event.kind === "catalog_changed"));
  assert.ok(
    provider.state.refreshes.some((refresh) => refresh.allowNetwork && refresh.force === true),
    "discovery must be forced after login",
  );
  const after = await host.call("host.catalog", undefined);
  assert.equal(deviceStatus(after), "oauth");
  assert.deepEqual(deviceModels(after), [["device/copilot-fixture", true]]);
  assert.deepEqual(after.defaults.model, { provider: "device", id: "copilot-fixture" });
});

test("cancelling a sign-in aborts the provider's polling and stores nothing", async () => {
  const provider = deviceCodeProvider();
  const { host, events } = await desktop(provider.create);
  const pending = deviceLogin(host, "attempt-2");
  await settled(() => provider.state.polling);

  // A cancel for some other attempt leaves this one polling.
  await host.call("host.cancelLogin", { attempt: "stale-attempt" });
  assert.equal(provider.state.polling, true);

  await host.call("host.cancelLogin", { attempt: "attempt-2" });
  assert.deepEqual(await pending, { kind: "cancelled" } satisfies LoginOutcome);
  assert.equal(provider.state.aborted, true);
  assert.ok(!events.some((event) => event.kind === "catalog_changed"));
  assert.equal(deviceStatus(await host.call("host.catalog", undefined)), "disconnected");

  // Approval after the cancel cannot reconnect the attempt.
  provider.approve();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(deviceStatus(await host.call("host.catalog", undefined)), "disconnected");
});

test("a cancelled attempt's late approval never saves a credential", async () => {
  const provider = deviceCodeProvider({ ignoresAbort: true });
  const { host, events } = await desktop(provider.create);
  const pending = deviceLogin(host, "attempt-late");
  await settled(() => provider.state.polling);
  await host.call("host.cancelLogin", { attempt: "attempt-late" });
  assert.deepEqual(await pending, { kind: "cancelled" } satisfies LoginOutcome);
  // The flow ignored the abort and is still polling when the user approves.
  assert.equal(provider.state.polling, true);
  provider.approve();
  await settled(() => !provider.state.polling);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(deviceStatus(await host.call("host.catalog", undefined)), "disconnected");
  assert.ok(!events.some((event) => event.kind === "catalog_changed"));
});

test("an attempt ID cannot be reused until its cancelled flow has settled, and a later reuse stays cancellable", async () => {
  const provider = deviceCodeProvider({ ignoresAbort: true });
  const { host } = await desktop(provider.create);
  const first = deviceLogin(host, "attempt-reuse");
  await settled(() => provider.state.polling);
  await host.call("host.cancelLogin", { attempt: "attempt-reuse" });
  // Cancel returns before the abandoned flow has let go; the ID is still taken.
  await assert.rejects(deviceLogin(host, "attempt-reuse"), /attempt ID is already running/);
  assert.deepEqual(await first, { kind: "cancelled" } satisfies LoginOutcome);

  // Once settled, the ID is free again and the new attempt owns its own cancel.
  const second = deviceLogin(host, "attempt-reuse");
  await settled(() => provider.state.polling);
  await host.call("host.cancelLogin", { attempt: "attempt-reuse" });
  assert.deepEqual(await second, { kind: "cancelled" } satisfies LoginOutcome);
  assert.equal(deviceStatus(await host.call("host.catalog", undefined)), "disconnected");
});

test("a new sign-in for the same provider supersedes the running one", async () => {
  const provider = deviceCodeProvider();
  const { host } = await desktop(provider.create);
  const first = deviceLogin(host, "attempt-3a");
  await settled(() => provider.state.polling);
  const second = deviceLogin(host, "attempt-3b");
  assert.deepEqual(await first, { kind: "cancelled" } satisfies LoginOutcome);
  await settled(() => provider.state.polling);
  provider.approve();
  assert.deepEqual(await second, {
    kind: "connected",
    catalogRefreshed: true,
  } satisfies LoginOutcome);
});

test("a reused attempt ID is refused before any flow starts", async () => {
  const provider = deviceCodeProvider();
  const { host } = await desktop(provider.create);
  const pending = deviceLogin(host, "attempt-4");
  await settled(() => provider.state.polling);
  await assert.rejects(deviceLogin(host, "attempt-4"), /attempt ID is already running/);
  assert.equal(provider.state.polling, true);
  await host.call("host.cancelLogin", { attempt: "attempt-4" });
  assert.deepEqual(await pending, { kind: "cancelled" } satisfies LoginOutcome);
});

test("closing the host aborts a running sign-in and refuses a new one", async () => {
  const provider = deviceCodeProvider();
  const { host } = await desktop(provider.create);
  const pending = deviceLogin(host, "attempt-5");
  await settled(() => provider.state.polling);
  await host.close();
  assert.deepEqual(await pending, { kind: "cancelled" } satisfies LoginOutcome);
  assert.equal(provider.state.aborted, true);
  await assert.rejects(deviceLogin(host, "attempt-after-close"), /window closed/);
  assert.equal(provider.state.polling, false);
});

test("signing out during approval waits for the credential the flow was already saving, then removes it", async () => {
  const store = lateCommittingCredentialStore();
  const provider = deviceCodeProvider({ credentials: store.store });
  const { host, events } = await desktop(provider.create);
  const pending = deviceLogin(host, "attempt-fence");
  await settled(() => provider.state.polling);
  provider.approve();
  await settled(() => store.state.writesStarted === 1);
  assert.equal(store.state.writesLanded, 0);

  let loginSettled = false;
  void pending.then(
    () => (loginSettled = true),
    () => (loginSettled = true),
  );
  let logoutSettled = false;
  const logout = host.call("host.logout", { provider: "device" }).then(() => {
    logoutSettled = true;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(logoutSettled, false, "logout must wait for the commit in flight");
  assert.equal(loginSettled, false);

  store.land();
  await logout;
  assert.equal(store.state.writesLanded, 1);
  assert.equal(loginSettled, true, "the sign-in settled before the logout did");
  assert.equal(deviceStatus(await host.call("host.catalog", undefined)), "disconnected");
  assert.ok(events.some((event) => event.kind === "catalog_changed"));
  await pending;
});

test("signing out while the code is still pending cancels the sign-in", async () => {
  const provider = deviceCodeProvider();
  const { host } = await desktop(provider.create);
  const pending = deviceLogin(host, "attempt-logout");
  await settled(() => provider.state.polling);
  await host.call("host.logout", { provider: "device" });
  assert.deepEqual(await pending, { kind: "cancelled" } satisfies LoginOutcome);
  assert.equal(provider.state.aborted, true);
  provider.approve();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(deviceStatus(await host.call("host.catalog", undefined)), "disconnected");
});

test("a saved credential is reported apart from a failed model discovery", async () => {
  const provider = deviceCodeProvider();
  provider.state.discoveryFails = true;
  const { host, events } = await desktop(provider.create);
  const pending = deviceLogin(host, "attempt-6");
  await settled(() => provider.state.polling);
  provider.approve();
  assert.deepEqual(await pending, {
    kind: "connected",
    catalogRefreshed: false,
  } satisfies LoginOutcome);
  assert.ok(events.some((event) => event.kind === "catalog_changed"));
  const catalog = await host.call("host.catalog", undefined);
  assert.equal(deviceStatus(catalog), "oauth");
  assert.deepEqual(deviceModels(catalog), []);
});

test("browser sign-in still answers the method choice and opens the URL", async () => {
  const provider = browserProvider({ offersBrowser: true });
  const { host, opened, events } = await desktop(provider.create);
  const outcome = await host.call("host.login", {
    provider: "browser",
    method: { kind: "browser" },
    attempt: "attempt-7",
  });
  assert.deepEqual(outcome, { kind: "connected", catalogRefreshed: true } satisfies LoginOutcome);
  assert.deepEqual(provider.state.prompts, ["browser"]);
  assert.deepEqual(opened, ["https://example.com/authorize"]);
  assert.deepEqual(loginEvents(events), []);
  assert.equal((await host.call("host.catalog", undefined)).providers[0]?.connection.kind, "oauth");
});

test("a sign-in link that is not a web address is never opened", async () => {
  const provider = browserProvider({ offersBrowser: true, authUrl: "file:///etc/passwd" });
  const { host, opened, events } = await desktop(provider.create);
  await host.call("host.login", {
    provider: "browser",
    method: { kind: "browser" },
    attempt: "attempt-unsafe",
  });
  assert.deepEqual(opened, []);
  assert.deepEqual(
    loginEvents(events).map((event) => event.progress),
    [{ kind: "message", message: "The provider sent a sign-in link that isn't a web address." }],
  );
});

test("cancelling releases a manual-code prompt the provider gave no signal for", async () => {
  const provider = browserProvider({ offersBrowser: true, holdsManualCode: true });
  const { host, opened } = await desktop(provider.create);
  const pending = host.call("host.login", {
    provider: "browser",
    method: { kind: "browser" },
    attempt: "attempt-held",
  });
  await settled(() => opened.length === 1);
  assert.equal(provider.state.manualCodeReleased, false);
  await host.call("host.cancelLogin", { attempt: "attempt-held" });
  assert.deepEqual(await pending, { kind: "cancelled" } satisfies LoginOutcome);
  await settled(() => provider.state.manualCodeReleased);
  assert.match(provider.state.manualCodeReason, /Browser login finished/);
  assert.equal(
    (await host.call("host.catalog", undefined)).providers[0]?.connection.kind,
    "disconnected",
  );
});

test("closing the host releases a held manual-code prompt", async () => {
  const provider = browserProvider({ offersBrowser: true, holdsManualCode: true });
  const { host, opened } = await desktop(provider.create);
  const pending = host.call("host.login", {
    provider: "browser",
    method: { kind: "browser" },
    attempt: "attempt-held-close",
  });
  await settled(() => opened.length === 1);
  await host.close();
  assert.deepEqual(await pending, { kind: "cancelled" } satisfies LoginOutcome);
  await settled(() => provider.state.manualCodeReleased);
});

test("a method choice without a browser option fails instead of being answered blindly", async () => {
  const provider = browserProvider({ offersBrowser: false });
  const { host, opened } = await desktop(provider.create);
  await assert.rejects(
    host.call("host.login", {
      provider: "browser",
      method: { kind: "browser" },
      attempt: "attempt-8",
    }),
  );
  assert.deepEqual(provider.state.prompts, []);
  assert.deepEqual(opened, []);
  assert.equal(
    (await host.call("host.catalog", undefined)).providers[0]?.connection.kind,
    "disconnected",
  );
});
