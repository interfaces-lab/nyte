import type { HostDescription, HostView } from "@nyte-ai/schema";
import type { OpenOptions } from "./connection.ts";
import type { Host } from "./host.ts";
import type { Kernel } from "./kernel.ts";
import type { Plugin } from "./plugin.ts";
import { delegationPlugin } from "./plugins/delegation.ts";
import { environmentPlugin } from "./plugins/environment.ts";
import { partsPlugin } from "./plugins/parts.ts";
import { resourcesPlugin } from "./plugins/resources.ts";
import { systemPromptPlugin } from "./plugins/system-prompt.ts";
import type { HostIdentity } from "./refs.ts";
import type { StoreConnection } from "./store.ts";

/** Describes what `composeHost` needs: `OpenOptions`, plus what the platform host supplies: the home directory `Resources.user` attaches at (null on a host without one), the operations catalog `HostView.operations` serves (protocol's), and the host's name, platform and version. */
export type ComposeOptions = OpenOptions & {
  readonly home: string | null;
  readonly operations: HostView["operations"];
  readonly description: HostDescription;
};

/** The core plugins every session loads first, in decision 13's order: what `kernel.builtins` holds. */
export const BUILTINS: readonly Plugin<"core">[] = [
  systemPromptPlugin,
  environmentPlugin,
  resourcesPlugin,
  delegationPlugin,
  partsPlugin,
];

/** Composes the in-process host `sdk.open` serves: the composition root. Runs the preflight first, touching nothing: `checkPlugins` over `BUILTINS` then `options.plugins`, any `rejected` plugin throwing `SdkError("invalid")` with its issues (collisions stay warnings, as a load reports them). Opens a store connection, reads the host's identity (`hostIdentity`), and builds the host state (`createHostState`: a fresh catalog generation, no plugins or settings yet, `options.operations`). Creates the kernel with every slot: `turn` (`createTurnDriver`), `summarize` (`createSummarizer`), `compact` (`createCompactor`), `resolveConfiguration` (`createConfigurationResolver`), `request` (`createRequest`), `models` (`createModelsApi`), each over `options.models`; `builtins` `BUILTINS`; `hostPlugins` `options.plugins`; `secrets`, `home`, `execution` (default run, covering all) and `description` as given. Registers `options.workspace` through `kernel.workspaces` as `LOCAL` (decision 5: `projectResources` true, no `expect`; `exists` when registered) and makes it the kernel's default workspace; a workspace no provider serves throws `SdkError("unavailable")` after releasing what was opened. Seeds `HostView.settings` from `settingInfos(kernel, null)`. Under `execution.kind === "run"` starts `driveInProcess(kernel, coverage)`. Returns `createHost(kernel, { credential: { kind: "token", token: "" } })` with `kernel`, its `close()` (and `[Symbol.asyncDispose]`) closing the host connection's streams, releasing the driver and its leases, closing every session's plugins (`kernel.closePlugins`), detaching every attached environment, session and workspace, and closing the store connection; the `Store` itself is the caller's. */
export function composeHost(
  options: ComposeOptions,
): Promise<Omit<Host, "listen"> & { readonly kernel: Kernel }> {
  throw new Error("not implemented");
}

/** Returns the host's identity at `host/identity`: the stored one, or on first open a minted `HostId` with the time, written once as an `identity` envelope with `expect: "absent"`, a lost race reading the winner. Never moved after. */
export function hostIdentity(store: StoreConnection): Promise<HostIdentity> {
  throw new Error("not implemented");
}
