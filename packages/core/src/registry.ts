import type { Disposer, ValidationIssue } from "@nyte-ai/schema";
import type {
  ContributionTable,
  Registries,
  Registry,
  RegistryDraft,
  Setting,
  SettingDefinition,
} from "./plugin.ts";

/** Returns one registry as a session holds it: the `Registry` every plugin reads, plus writes on behalf of one plugin, the materialised items with their owners, and its step of the reload pass. Its own `add` writes as owner `core`. */
export interface CoreRegistry<T, Handle = Disposer> extends Registry<T, "core", Handle> {
  /** Returns this registry as one plugin writes to it: the items and derives it adds are that owner's, and are removed when `signal` aborts; `list` is the shared materialised set. */
  owned(owner: string, signal?: AbortSignal): Registry<T, "core", Handle>;
  /** Returns the materialised items with the plugin that owns each, in `list` order: a static item is its adder's, an item a derive sets is the deriver's, a wrapped item keeps its owner. */
  entries(): readonly { readonly item: T; readonly owner: string }[];
  /** Runs this registry's step of a reload pass: seeds a draft with the static items by key in add order (a later add under a key replaces the earlier one, and one from another owner is a collision warning unless the kind overrides on purpose), runs every derive in registration order against it with `siblings`, and makes the result what `list` and `entries` return. A derive that throws has its edits discarded and comes back as an error issue against its owner. Issue paths start at the item's key. */
  materialize(
    siblings: Registries<"core">,
  ): readonly { readonly owner: string; readonly issue: ValidationIssue }[];
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
  /** Returns every registry as one plugin writes to it (`CoreRegistry.owned`): a plugin api's `contribute`, emptied of that plugin's items when `signal` aborts. */
  owned(owner: string, signal?: AbortSignal): Registries<"core">;
  /** Runs a reload pass now: tools → agents → prompt → modelContext, skills, parts, commands, settings; each derive sees as `siblings` the registries materialised earlier in this pass and the previous pass's sets for the rest. Collisions and derive failures go to `report` with the kind first in their path; `onChange` runs once the pass finished. A pass requested from inside a pass runs after it, on a microtask. */
  materialize(): Promise<void>;
  /** Schedules a reload pass on a microtask, coalescing every write and `reload` before it into one: what an add, a disposer and `PluginApi.reload` do. */
  reload(): void;
}

/** Returns a derivation: what `add(derive)` keeps and each reload pass runs against a draft. */
type Derive<T> = (draft: RegistryDraft<T>, siblings: Registries<"core">) => void;

/** Returns one item with the plugin that owns it. */
interface Entry<T> {
  readonly item: T;
  readonly owner: string;
}

/** Names the kinds in reload order. */
const ORDER = [
  "tools",
  "agents",
  "prompt",
  "modelContext",
  "skills",
  "parts",
  "commands",
  "settings",
] as const satisfies readonly (keyof CoreRegistries)[];

/** Returns a session's empty registry set: one `createRegistry` per kind, keyed by tool name, prompt section id (a later source overrides on purpose), agent id, `<provider>/<id>` of the model ref, skill name, part kind, `<owner>/<name>` for commands and setting id; `settings.add` returns `setting(definition, owner)` joined with its disposer; every write schedules a reload; `report` receives collisions and derive failures by owner; `onChange` runs after every pass. */
export function createRegistrySet(input: {
  onChange(): void;
  setting(definition: SettingDefinition, owner: string): Setting<unknown>;
  report(owner: string, issue: ValidationIssue): void;
}): RegistrySet {
  let scheduled = false;
  let passing = false;

  const reload = (): void => {
    if (scheduled) return;
    scheduled = true;

    queueMicrotask(() => {
      if (scheduled) pass();
    });
  };

  const registries: CoreRegistries = {
    tools: createRegistry({ key: (tool) => tool.name, onChange: reload }),
    prompt: createRegistry({ key: (section) => section.id, overrides: true, onChange: reload }),
    agents: createRegistry({ key: (agent) => agent.id, onChange: reload }),
    modelContext: createRegistry({
      key: (policy) => `${policy.model.provider}/${policy.model.id}`,
      onChange: reload,
    }),
    skills: createRegistry({ key: (skill) => skill.name, onChange: reload }),
    parts: createRegistry({ key: (definition) => definition.kind, onChange: reload }),
    commands: createRegistry({
      key: (command, owner) => `${owner}/${command.name}`,
      onChange: reload,
    }),
    settings: createRegistry({
      key: (definition) => definition.id,
      handle: (definition, owner) => input.setting(definition, owner),
      onChange: reload,
    }),
  };

  const set: RegistrySet = {
    ...registries,
    owned: (owner, signal) => ({
      tools: registries.tools.owned(owner, signal),
      prompt: registries.prompt.owned(owner, signal),
      agents: registries.agents.owned(owner, signal),
      modelContext: registries.modelContext.owned(owner, signal),
      skills: registries.skills.owned(owner, signal),
      parts: registries.parts.owned(owner, signal),
      commands: registries.commands.owned(owner, signal),
      settings: registries.settings.owned(owner, signal),
    }),
    async materialize() {
      if (passing) {
        reload();

        return;
      }

      pass();
    },
    reload,
  };

  function pass(): void {
    scheduled = false;
    passing = true;

    try {
      for (const kind of ORDER) {
        for (const { owner, issue } of registries[kind].materialize(set))
          input.report(owner, { ...issue, path: [kind, ...issue.path] });
      }
    } finally {
      passing = false;
    }

    input.onChange();
  }

  return set;
}

/** Returns an empty registry: `add(item)` keeps a static item under `key(item, owner)` and returns `handle(item, owner)` joined with its disposer (the disposer alone without `handle`); `add(derive)` keeps a derivation and returns its disposer; every add and disposer calls `onChange`. With `overrides`, a static item from another owner under a taken key replaces it without a collision. Nothing shows in `list` until `materialize`. */
export function createRegistry<T, Handle = Disposer>(input: {
  key(item: T, owner: string): string;
  handle?(item: T, owner: string): Handle;
  readonly overrides?: boolean;
  onChange(): void;
}): CoreRegistry<T, Handle> {
  const statics: Entry<T>[] = [];
  const derives: { readonly derive: Derive<T>; readonly owner: string }[] = [];
  let materialized: readonly Entry<T>[] = [];

  const removal = (remove: () => void, signal: AbortSignal | undefined): Disposer => {
    let removed = false;

    const dispose = (): void => {
      if (removed) return;
      removed = true;
      signal?.removeEventListener("abort", dispose);
      remove();
      input.onChange();
    };

    signal?.addEventListener("abort", dispose, { once: true });

    if (signal?.aborted === true) dispose();

    return dispose;
  };

  const adder = (
    owner: string,
    signal: AbortSignal | undefined,
  ): Registry<T, "core", Handle>["add"] => {
    function add(item: T): Handle & Disposer;
    function add(derive: Derive<T>): Disposer;
    function add(value: T | Derive<T>): Disposer {
      if (isDerive(value)) {
        const entry = { derive: value, owner };
        derives.push(entry);
        input.onChange();

        return removal(() => derives.splice(derives.indexOf(entry), 1), signal);
      }

      const entry: Entry<T> = { item: value, owner };
      statics.push(entry);
      input.onChange();
      const dispose = removal(() => statics.splice(statics.indexOf(entry), 1), signal);

      return Object.assign(dispose, input.handle?.(value, owner));
    }

    return add;
  };

  const owned = (owner: string, signal?: AbortSignal): Registry<T, "core", Handle> => ({
    add: adder(owner, signal),
    list: () => materialized.map((entry) => entry.item),
  });

  return {
    ...owned("core"),
    owned,
    entries: () => materialized,
    materialize(siblings) {
      const draft = new Map<string, Entry<T>>();
      const issues: { readonly owner: string; readonly issue: ValidationIssue }[] = [];

      for (const entry of statics) {
        const key = input.key(entry.item, entry.owner);
        const previous = draft.get(key);

        if (previous !== undefined && previous.owner !== entry.owner && input.overrides !== true)
          issues.push({
            owner: entry.owner,
            issue: {
              severity: "warning",
              path: [key],
              message: `${key} from ${entry.owner} replaces the one from ${previous.owner}.`,
              source: { plugin: entry.owner },
            },
          });

        draft.set(key, entry);
      }

      for (const { derive, owner } of derives) {
        const before = new Map(draft);

        try {
          derive(draftOf(draft, owner), siblings);
        } catch (error) {
          draft.clear();

          for (const [key, entry] of before) draft.set(key, entry);

          issues.push({
            owner,
            issue: {
              severity: "error",
              path: [],
              message: `A derivation failed: ${error instanceof Error ? error.message : String(error)}`,
              source: { plugin: owner },
            },
          });
        }
      }

      materialized = [...draft.values()];

      return issues;
    },
  };
}

/** Returns the draft one derivation edits: what it sets is its own, what it wraps keeps its owner. */
function draftOf<T>(draft: Map<string, Entry<T>>, owner: string): RegistryDraft<T> {
  return {
    set(id, item) {
      draft.set(id, { item, owner });
    },
    get: (id) => draft.get(id)?.item,
    delete(id) {
      draft.delete(id);
    },
    ids: () => [...draft.keys()],
    wrap(id, wrap) {
      const current = draft.get(id);

      if (current !== undefined) draft.set(id, { item: wrap(current.item), owner: current.owner });
    },
  };
}

/** Returns whether an add is a derivation: every contribution item is a plain object, so a function is one. */
function isDerive<T>(value: T | Derive<T>): value is Derive<T> {
  return typeof value === "function";
}
