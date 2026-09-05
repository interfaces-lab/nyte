/**
 * The one boundary parser. Every JSON value that arrives from the other side
 * goes through `decode` before anything reads a field from it.
 *
 * `typebox/value` interprets the schema; nothing here compiles code, so the
 * same function runs under a browser CSP that forbids `eval`.
 */
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { Issue } from "./wire.ts";

const MAX_ISSUES = 20;

export type Decoded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly Issue[] };

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this is the boundary parser itself
export function decode<S extends TSchema>(schema: S, value: unknown): Decoded<Static<S>> {
  if (Value.Check(schema, value)) return { ok: true, value };
  const issues = Value.Errors(schema, value)
    .slice(0, MAX_ISSUES)
    .map((error) => ({ path: error.instancePath, message: error.message }));
  return { ok: false, issues };
}

/** A parse failure as one line, for an error message. */
export function describeIssues(issues: readonly Issue[]): string {
  if (issues.length === 0) return "value did not match its schema";
  return issues
    .map((issue) => `${issue.path === "" ? "/" : issue.path}: ${issue.message}`)
    .join("; ");
}
