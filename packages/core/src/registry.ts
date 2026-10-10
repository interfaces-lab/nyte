import type { Disposer, ValidationIssue } from "@nyte-ai/schema";
import type { ContributionTable, Registries, Registry, Setting, SettingDefinition } from "./plugin.ts";

/** Returns one registry as a session holds it: the `Registry` every plugin reads, plus writes on behalf of one plugin, the materialised items with their owners, and its step of the reload pass. Its own `add` writes as owner `core`. */
export interface CoreRegistry<T, Handle = Disposer> extends Registry<T, "core", Handle> {
  /** Returns this registry as one plugin writes to it: the items and derives it adds are that owner's; `list` is the shared materialised set. */
  owned(owner: string): Registry<T, "core", Handle>;
  /** Returns the materialised items with the plugin that owns each, in `list` order: a static item is its adder's, an item a derive sets is the deriver's, a wrapped item keeps its owner. */
  entries(): readonly { readonly item: T; readonly owner: string }[];
  /** Runs this registry's step of a reload pass: seeds a draft with the static items by key in add order (a later add under a key replaces the earlier one), runs every derive in registration order against it with `siblings`, and makes the result what `list` and `entries` return. A derive that throws has its edits discarded and comes back as an error issue against its owner. */
  materialize(siblings: Registries<"core">): readonly { readonly owner: string; readonly issue: ValidationIssue }[];
}

/** Returns one `CoreRegistry` per contribution kind a core plugin may write. */
export type CoreRegistries = {
  readonly [K in keyof Registries<"core">]: CoreRegistry<
    ContributionTable[K & keyof ContributionTable]["item"],
    ContributionTable[K & keyof ContributionTable]["handle"]
  >;
};

/** Holds one session's core registries and runs their reload pass. */
export interface RegistrySet extends CoreRegistries {
  /** Returns every registry as one plugin writes to it (`CoreRegistry.owned`): a plugin api's `contribute`. */
  owned(owner: string): Registries<"core">;
  /** Runs a reload pass now: tools → agents → prompt → modelContext, skills, parts, commands, settings; each derive sees as `siblings` the registries materialised earlier in this pass and the previous pass's sets for the rest. Derive failures go to `report`; `onChange` runs once the pass finished. A pass already running finishes first, then this one runs. */
  materialize(): Promise<void>;
  /** Schedules a reload pass on a microtask, coalescing every write and `reload` before it into one: what an add, a disposer and `PluginApi.reload` do. */
  reload(): void;
}

/** Returns a session's empty registry set: one `createRegistry` per kind, keyed by tool name, prompt section id, agent id, `<provider>/<id>` of the model ref, skill name, part kind, command name and setting id; `settings.add` returns `setting(definition, owner)` joined with its disposer; every write schedules a reload; `report` receives derive failures by owner; `onChange` runs after every pass. */
export function createRegistrySet(input: {
  onChange(): void;
  setting(definition: SettingDefinition, owner: string): Setting<unknown>;
  report(owner: string, issue: ValidationIssue): void;
}): RegistrySet {
  throw new Error("not implemented");
}

/** Returns an empty registry: `add(item)` keeps a static item under `key(item)` and returns `handle(item, owner)` joined with its disposer (the disposer alone without `handle`); `add(derive)` keeps a derivation and returns its disposer; every add and disposer calls `onChange`. Nothing shows in `list` until `materialize`. */
export function createRegistry<T, Handle = Disposer>(input: {
  key(item: T): string;
  handle?(item: T, owner: string): Handle;
  onChange(): void;
}): CoreRegistry<T, Handle> {
  throw new Error("not implemented");
}
