import { Type } from "typebox";
import { Value } from "typebox/value";
import { factRef } from "./names.ts";
import { NAME_FACT } from "./sdk/snapshot.ts";
import type { Session } from "./store.ts";

/**
 * The name a session was given, read straight from its fact ref. A row read
 * through the SDK loads the session's whole main branch to describe it; a
 * walk that only labels sessions needs this one blob.
 */
export async function sessionName(
  session: Pick<Session, "refs" | "objects">,
): Promise<string | undefined> {
  const oid = await session.refs.read(factRef(NAME_FACT));

  if (oid === null) return undefined;
  const object = await session.objects.get(oid);

  return object?.kind === "blob" && Value.Check(Type.String(), object.value)
    ? object.value
    : undefined;
}
