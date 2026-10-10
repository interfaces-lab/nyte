import type { Disposer } from "@nyte-ai/schema";
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
  /** Registers a definition under its kind, replacing any earlier one; the disposer removes it while it is still the one registered. */
  register(definition: PartDefinition, owner: string | null): Disposer;
  /** Returns every registered definition with its owner. */
  list(): readonly RegisteredDefinition[];
}

/** Returns an empty definition registry; the built-ins join it with owner null in core-d's implement phase. */
export function createPartDefinitions(): PartDefinitions {
  const registered = new Map<string, RegisteredDefinition>();

  return {
    get: (kind) => registered.get(kind),
    register(definition, owner) {
      const entry: RegisteredDefinition = { definition, owner };
      registered.set(definition.kind, entry);

      return () => {
        if (registered.get(definition.kind) === entry) registered.delete(definition.kind);
      };
    },
    list: () => [...registered.values()],
  };
}
