import type { Disposer } from "@nyte-ai/schema";
import { branchSummary, compaction, text, thinking, tool } from "../contract/parts.ts";
import type { PartDefinition, PartDefinitions, RegisteredDefinition } from "../contract/parts.ts";

export const RESERVED_PART_KINDS: ReadonlySet<string> = new Set(
  [text, thinking, tool, compaction, branchSummary].map((definition) => definition.kind),
);

export function createPartDefinitions(input?: { readonly tool?: typeof tool }): PartDefinitions {
  const builtIns = [text, thinking, input?.tool ?? tool, compaction, branchSummary];

  const registered = new Map<string, RegisteredDefinition>(
    builtIns.map((definition) => [definition.kind, { definition, owner: null }]),
  );

  const register = (definition: PartDefinition, owner: string | null): Disposer => {
    if (registered.has(definition.kind)) return () => {};

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
