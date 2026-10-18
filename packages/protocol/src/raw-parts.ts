import { isJson, isJsonObject } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";

const ROLES = new Set(["step", "answer", "note"]);

/**
 * Returns a message or part view a newer host sent that this client cannot
 * read as a raw part of the same id, or null when the item is neither. Its
 * kind is the part's kind, or the message's own when it is not a part; its
 * state is the part's state, or the whole item. It reads as settled, since
 * this client cannot tell a newer status apart. Clients draw a part with no
 * renderer as its kind and raw state.
 */
export function rawPart(item: unknown): Json | null {
  if (!isJson(item) || !isJsonObject(item)) return null;
  const { id, turn, at, kind, part, partKind, role, state, version, placement, owner } = item;

  if (typeof id !== "string") return null;
  const carriesPart = typeof partKind === "string" && state !== undefined;

  const raw = {
    partKind: carriesPart ? partKind : typeof kind === "string" ? kind : "unknown",
    state: carriesPart ? state : item,
    version: typeof version === "number" ? version : 0,
  };

  if (typeof turn === "string" && typeof at === "number")
    return {
      ...raw,
      id,
      turn,
      at,
      kind: "part",
      part: typeof part === "string" ? part : id,
      role: typeof role === "string" && ROLES.has(role) ? role : "note",
      status: { kind: "settled", commit: "", endedAt: at },
    };

  return {
    ...raw,
    id,
    placement:
      isJsonObject(placement) && typeof placement["kind"] === "string"
        ? placement
        : { kind: "transcript", role: "note" },
    status: { kind: "settled", commit: "", endedAt: 0 },
    owner: typeof owner === "string" ? owner : null,
  };
}
