/**
 * Rewrites of stored objects whose shape an earlier schema wrote, shared by
 * every backend's migration runner. Objects are content addressed, so each
 * answers the upgraded body and its new oid; the backend stores that, repoints
 * the refs that held the old oid, and drops the old row. Each pins the stored
 * shape it reads so a later change to the live types cannot alter what it
 * accepts.
 */
import { canonicalJson } from "@nyte-ai/client";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { hashCanonicalJson } from "./hash.ts";
import { CorruptObject } from "./store.ts";
import type { Oid, Run } from "./model.ts";

/** Before failures carried a class, a failed or retrying run held only the provider's text. */
const checkRunWithErrorText = Compile(
  Type.Object({
    kind: Type.Literal("run"),
    id: Type.String(),
    head: Type.String(),
    phase: Type.Union([
      Type.Object({ kind: Type.Literal("retry"), at: Type.Number(), error: Type.String() }),
      Type.Object({ kind: Type.Literal("failed"), error: Type.String() }),
    ]),
    startedAt: Type.Number(),
    attempts: Type.Number(),
    config: Type.Object({
      model: Type.Optional(
        Type.Object({ provider: Type.Optional(Type.String()), id: Type.String() }),
      ),
      thinkingLevel: Type.Optional(Type.String()),
      agent: Type.Optional(Type.String()),
    }),
    abortRequested: Type.Optional(Type.Literal(true)),
  }),
);

export function stampRunFailure(
  oid: Oid,
  raw: string,
): { readonly oid: Oid; readonly body: string } {
  const value: unknown = JSON.parse(raw);
  if (!checkRunWithErrorText.Check(value)) {
    throw new CorruptObject(oid, "is not a run this build can upgrade");
  }
  const { error, ...phase } = value.phase;
  const run: Run = {
    ...value,
    phase: { ...phase, failure: { class: "provider", message: error } },
  };
  const body = canonicalJson(run);
  return { oid: hashCanonicalJson(body), body };
}
