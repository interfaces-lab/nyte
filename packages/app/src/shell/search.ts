import type { Static } from "typebox";
import { Type } from "typebox";
import { Value } from "typebox/value";

const searchText = Type.String();

const shellSearch = Type.Object({
  customize: Type.Optional(searchText),
  environment: Type.Optional(searchText),
  usage: Type.Optional(searchText),
  usageRange: Type.Optional(searchText),
});

/** The search every route shares: which chrome page and Usage view the window shows. */
export type ShellSearch = Static<typeof shellSearch>;

/** Keep the known keys that hold text; anything else reads as unset. */
export function readShellSearch(search: Record<string, unknown>): ShellSearch {
  return {
    customize: Value.Check(searchText, search.customize) ? search.customize : undefined,
    environment: Value.Check(searchText, search.environment) ? search.environment : undefined,
    usage: Value.Check(searchText, search.usage) ? search.usage : undefined,
    usageRange: Value.Check(searchText, search.usageRange) ? search.usageRange : undefined,
  };
}
