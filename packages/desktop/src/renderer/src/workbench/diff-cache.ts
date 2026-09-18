import { parsePatchFacts } from "@nyte-ai/client";
import type { ParsedPatch } from "@nyte-ai/client";
import type { VcsDiffIdentity } from "../queries.ts";

const MAX_PARSED_DIFFS = 256;

interface ParsedDiffCacheEntry {
  readonly patch: string;
  readonly parsed: ParsedPatch | undefined;
}

const parsedDiffs = new Map<string, ParsedDiffCacheEntry>();

function diffIdentityKey(identity: VcsDiffIdentity): string {
  return JSON.stringify([identity.repositoryId, identity.revision, identity.path]);
}

/** Parse once per stable repository revision and path, including failed parses. */
export function parseCachedDiff(identity: VcsDiffIdentity, patch: string): ParsedPatch | undefined {
  const key = diffIdentityKey(identity);
  const cached = parsedDiffs.get(key);
  if (cached?.patch === patch) {
    // Move the entry to the newest end of the small LRU.
    parsedDiffs.delete(key);
    parsedDiffs.set(key, cached);
    return cached.parsed;
  }
  const entry = Object.freeze({ patch, parsed: parsePatchFacts(patch) });
  parsedDiffs.set(key, entry);
  if (parsedDiffs.size > MAX_PARSED_DIFFS) {
    const oldest = parsedDiffs.keys().next().value;
    if (oldest !== undefined) parsedDiffs.delete(oldest);
  }
  return entry.parsed;
}
