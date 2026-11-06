import { isJson, isJsonObject } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";

const ROLES = new Set(["step", "answer", "note"]);

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
