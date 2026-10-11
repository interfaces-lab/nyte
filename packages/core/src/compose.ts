import type { Models } from "@nyte-ai/ai";
import { asId } from "@nyte-ai/schema";
import type {
  HostDescription,
  HostView,
  Json,
  ModelRequestInput,
  ModelRequestOutcome,
  Owned,
  SessionId,
} from "@nyte-ai/schema";
import { createCompactor, createSummarizer } from "./compaction.ts";
import { createConfigurationResolver } from "./configuration.ts";
import { createHost } from "./connection.ts";
import type { ModelsApi, OpenOptions } from "./connection.ts";
import { SdkError } from "./error.ts";
import { driveInProcess } from "./execution.ts";
import type { Host } from "./host.ts";
import { createHostState } from "./host-view.ts";
import { createKernel } from "./kernel.ts";
import type { Kernel } from "./kernel.ts";
import { createModelsApi } from "./models.ts";
import { pollStore } from "./poll.ts";
import type { Plugin } from "./plugin.ts";
import { checkPlugins, hostPluginRows } from "./plugin-runtime.ts";
import { delegationPlugin } from "./plugins/delegation.ts";
import { environmentPlugin } from "./plugins/environment.ts";
import { partsPlugin } from "./plugins/parts.ts";
import { resourcesPlugin } from "./plugins/resources.ts";
import { systemPromptPlugin } from "./plugins/system-prompt.ts";
import { envelope } from "./records.ts";
import { hostIdentityRef } from "./refs.ts";
import type { HostIdentity } from "./refs.ts";
import { createRequest } from "./request.ts";
import { isJsonObject } from "./session-state.ts";
import { settingInfos } from "./settings.ts";
import type { StoreConnection } from "./store.ts";
import { createTurnDriver } from "./turn.ts";

/** Describes what `composeHost` needs: `OpenOptions`, plus what the platform host supplies: the home directory `Resources.user` attaches at (null on a host without one), the operations catalog `HostView.operations` serves (protocol's), the host's name, platform and version, and where each of `plugins` loaded from a plugin file came from (§41e; absent, every one is `inline`). */
export type ComposeOptions = OpenOptions & {
  readonly home: string | null;
  readonly operations: HostView["operations"];
  readonly description: HostDescription;
  readonly pluginSources?: ReadonlyMap<
    Plugin<"core">,
    { readonly source: "user" | "project"; readonly path: string }
  >;
  /** The interval in ms at which this host re-reads a store it shares with other instances, passed to the kernel as `KernelOptions.poll` (§42h): the Vercel deploy sets 1000; a Durable Object and a local host leave it unset. */
  readonly poll?: number;
  /** Host values applied inside `composeHost` before any driver attaches (§43c): each `settings` entry, in key order, through `kernel.settings.apply`; an `unknown` answer is a `warning` at `[id]` and an `invalid` one its issues as warnings under `[id]`, all reported on one `HostState.report` row `{ id: "settings", source: "user", path: null, issues }`. `openHost` fills it from `~/.nyte/settings.json`. */
  readonly seed?: { readonly settings: Readonly<Record<string, Json>> };
};

/** The core plugins every session loads first, in decision 13's order: what `kernel.builtins` holds. */
export const BUILTINS: readonly Plugin<"core">[] = [
  systemPromptPlugin,
  environmentPlugin,
  resourcesPlugin,
  delegationPlugin,
  partsPlugin,
];

/** Composes the in-process host `sdk.open` serves: the composition root. Runs the preflight first, touching nothing: `checkPlugins` over `BUILTINS` then `options.plugins`, any `rejected` plugin throwing `SdkError("invalid")` with its issues (collisions stay warnings, as a load reports them). Opens a store connection, reads the host's identity (`hostIdentity`), and builds the host state (`createHostState`: a fresh catalog generation, no settings yet, `options.operations`), its `HostView.plugins` seeded with `hostPluginRows`: one row per built-in (`source: "builtin"`) then per `options.plugins` entry (`user` or `project` with its path when `options.pluginSources` names it, else `inline` with a null path), each with no issues, merged later with the runtimes' live issues (§38x). Creates the kernel with every slot: `turn` (`createTurnDriver`), `summarize` (`createSummarizer`), `compact` (`createCompactor`), `resolveConfiguration` (`createConfigurationResolver`), `request` (`createRequest`), `models` (`createModelsApi`), each over `options.models`; `builtins` `BUILTINS`; `hostPlugins` `options.plugins`; `pluginSources`, `secrets`, `home`, `execution` (default run, covering all) and `description` as given. Registers `options.workspace` through `kernel.workspaces` as `LOCAL` (decision 5: `projectResources` true, no `expect`; `exists` when registered) and makes it the kernel's default workspace; a workspace no provider serves throws `SdkError("unavailable")` after releasing what was opened. Applies `options.seed` (§43c), then seeds `HostView.settings` from `settingInfos(kernel, null)`. Under `execution.kind === "run"` starts `driveInProcess(kernel, coverage)`; with `poll`, starts `pollStore` (§42h). Returns `createHost(kernel, { credential: { kind: "token", token: "" } })` with `kernel`, its `close()` (and `[Symbol.asyncDispose]`) stopping the poll, closing the host connection's streams, releasing the driver and its leases without waiting on the turns in flight (the driver aborts them with the host-closing signal and leaves their runs live for the next open, §38y), closing every session's plugins (`kernel.closePlugins`), detaching every attached environment, session and workspace, and closing the store connection; the `Store` itself is the caller's. */
export async function composeHost(
  options: ComposeOptions,
): Promise<Omit<Host, "listen"> & { readonly kernel: Kernel }> {
  const rejected = checkPlugins([...BUILTINS, ...options.plugins]).plugins.filter(
    (outcome) => outcome.kind === "rejected",
  );

  if (rejected.length > 0)
    throw new SdkError(
      "invalid",
      `The host cannot load ${rejected.map((outcome) => outcome.id).join(", ")}.`,
      { issues: rejected.flatMap((outcome) => outcome.issues) },
    );

  const store = await options.store.open();

  const kernel = await composeKernel(options, store).catch(async (error: unknown) => {
    await store.close();

    throw error;
  });

  const added = await kernel.workspaces.add(options.workspace).catch((error: unknown) => ({
    kind: "failed" as const,
    reason: error instanceof Error ? error.message : String(error),
  }));

  if (added.kind !== "added" && added.kind !== "exists") {
    await release(kernel, null);

    throw new SdkError(
      "unavailable",
      `The host's workspace cannot be registered (${added.kind === "stale" ? "stale" : added.reason}).`,
    );
  }

  kernel.defaultWorkspace = added.workspace;
  kernel.host.update({ settings: await settingInfos(kernel, null) });

  const driver =
    kernel.execution.kind === "run" ? driveInProcess(kernel, kernel.execution.coverage) : null;

  const unpoll = pollStore(kernel);

  const host = createHost(kernel, { credential: { kind: "token", token: "" } });
  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      unpoll();
      await host.close();
      await release(kernel, driver);
    })();

    return closing;
  };

  return { ...host, kernel, close, [Symbol.asyncDispose]: close };
}

/** Returns the host's identity at `host/identity`: the stored one, or on first open a minted `HostId` with the time, written once as an `identity` envelope with `expect: "absent"`, a lost race reading the winner. Never moved after. */
export async function hostIdentity(store: StoreConnection): Promise<HostIdentity> {
  const known = await storedIdentity(store);

  if (known !== null) return known;
  const identity: HostIdentity = { id: asId<"host">(crypto.randomUUID()), createdAt: Date.now() };

  const outcome = await store.refs.set([
    {
      name: hostIdentityRef(),
      target: await store.objects.put(
        envelope(
          "identity",
          { id: identity.id, createdAt: identity.createdAt },
          identity.createdAt,
        ),
      ),
      expect: "absent",
    },
  ]);

  if (outcome.kind === "set") return identity;
  const winner = await storedIdentity(store);

  if (winner === null) throw new SdkError("internal", "host/identity holds no identity.");

  return winner;
}

/** Returns the kernel `composeHost` serves: every slot filled over `options.models`, each built on first use once the kernel exists. */
async function composeKernel(options: ComposeOptions, store: StoreConnection): Promise<Kernel> {
  const identity = await hostIdentity(store);
  const models = options.models;
  let composed: Kernel | null = null;

  const bound = <T>(make: (kernel: Kernel, models: Models) => T): (() => T) => {
    let made: T | null = null;

    return () => {
      if (made !== null) return made;

      if (composed === null) throw new SdkError("internal", "The kernel is not composed yet.");
      made = make(composed, models);

      return made;
    };
  };

  const turn = bound(createTurnDriver);
  const summarize = bound(createSummarizer);
  const compact = bound(createCompactor);
  const resolve = bound(createConfigurationResolver);
  const request = bound(createRequest);
  const api = bound(createModelsApi);

  const catalog: ModelsApi = {
    list: () => api().list(),
    refresh: (provider) => api().refresh(provider),
    setDefault: (ref) => api().setDefault(ref),
    verify: (provider) => api().verify(provider),
    login: (input) => api().login(input),
    logout: (provider) => api().logout(provider),
  };

  composed = createKernel({
    hostId: identity.id,
    store,
    description: options.description,
    host: createHostState({
      catalog: asId<"catalog-generation">(crypto.randomUUID()),
      plugins: [],
      settings: [],
      operations: options.operations,
    }),
    execution: options.execution,
    turn: { run: (input) => turn().run(input) },
    summarize: (input) => summarize()(input),
    compact: (input) => compact()(input),
    resolveConfiguration: (input) => resolve()(input),
    request<T>(session: SessionId, input: ModelRequestInput<T>): Promise<ModelRequestOutcome<T>> {
      return request()(session, input);
    },
    models: catalog,
    builtins: BUILTINS,
    hostPlugins: options.plugins,
    pluginSources: options.pluginSources,
    secrets: options.secrets,
    home: options.home,
    poll: options.poll,
  });

  composed.host.update({ plugins: hostPluginRows(composed) });

  return composed;
}

/** Releases what a composed host holds, once: the in-process driver and its leases, every session's plugins, every attached environment (each session's, then each registered workspace's own), then the store connection. */
async function release(kernel: Kernel, driver: Owned | null): Promise<void> {
  await driver?.close();
  const sessions = [...kernel.runtimes().keys()];

  for (const session of sessions) await kernel.closePlugins(session);

  for (const session of sessions) await kernel.environments.detach(session);

  for (const ref of await kernel.store.refs.list("workspaces/"))
    await kernel.environments.detachWorkspace(
      asId<"workspace">(ref.name.slice("workspaces/".length)),
    );

  await kernel.store.close();
}

/** Returns the identity `host/identity` holds, or null before the first open. */
async function storedIdentity(store: StoreConnection): Promise<HostIdentity | null> {
  const ref = await store.refs.get(hostIdentityRef());
  const object = ref?.target ? await store.objects.get(ref.target) : null;

  if (!isJsonObject(object) || object.kind !== "identity" || !isJsonObject(object.body))
    return null;
  const { id, createdAt } = object.body;

  return typeof id === "string" && typeof createdAt === "number"
    ? { id: asId<"host">(id), createdAt }
    : null;
}
