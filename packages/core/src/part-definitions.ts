import type { Disposer } from "@nyte-ai/schema";
import { branchSummary, compaction, text, thinking, tool } from "./parts.ts";
import type { PartDefinition } from "./parts.ts";

/** Returns one registered part definition and the plugin that contributed it; null for a built-in or an ownerless definition. */
export interface RegisteredDefinition {
  readonly definition: PartDefinition;
  readonly owner: string | null;
}

/** Holds the part definitions this kernel knows, by kind: what `createPart` validates against and `act` dispatches to. */
export interface PartDefinitions {
  /** Returns the definition registered for a kind and its owner, or undefined when none is. */
  get(kind: string): RegisteredDefinition | undefined;
  /** Registers a definition under its kind, replacing any earlier one; the disposer removes it while it is still the one registered. Registering the definition already registered, or any definition of a built-in kind (reserved, whatever the owner), is a no-op with an inert disposer. */
  register(definition: PartDefinition, owner: string | null): Disposer;
  /** Returns every registered definition with its owner. */
  list(): readonly RegisteredDefinition[];
}

/** The built-in part kinds, reserved (§34b): registering any definition under one is a no-op, whatever the owner. */
export const RESERVED_PART_KINDS: ReadonlySet<string> = new Set(
  [text, thinking, tool, compaction, branchSummary].map((definition) => definition.kind),
);

/** Returns a definition registry holding the built-ins `text`, `thinking`, `tool` (or the given `tool`, its stop action wired), `compaction` and `branchSummary`, each with owner null; their kinds are reserved from then on. */
export function createPartDefinitions(input?: { readonly tool?: typeof tool }): PartDefinitions {
  const builtIns = [text, thinking, input?.tool ?? tool, compaction, branchSummary];

  const registered = new Map<string, RegisteredDefinition>(
    builtIns.map((definition) => [definition.kind, { definition, owner: null }]),
  );

  const register = (definition: PartDefinition, owner: string | null): Disposer => {
    if (
      RESERVED_PART_KINDS.has(definition.kind) ||
      registered.get(definition.kind)?.definition === definition
    )
      return () => {};

    const entry: RegisteredDefinition = { definition, owner };
    registered.set(definition.kind, entry);

    return () => {
      if (registered.get(definition.kind) === entry) registered.delete(definition.kind);
    };
  };

  return {
    get: (kind) => registered.get(kind),
    register,
    list: () => [...registered.values()],
  };
}
