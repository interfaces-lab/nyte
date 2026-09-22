import { Value } from "typebox/value";
import type { Issue } from "./wire.ts";

const MAX_ISSUES = 20;

/** Bound schema diagnostics before sending them across the wire. */
export function validationIssues(errors: ReturnType<typeof Value.Errors>): readonly Issue[] {
  return errors
    .slice(0, MAX_ISSUES)
    .map((error) => ({ path: error.instancePath, message: error.message }));
}

/** A parse failure as one line, for an error message. */
export function describeIssues(issues: readonly Issue[]): string {
  if (issues.length === 0) return "value did not match its schema";

  return issues
    .map((issue) => `${issue.path === "" ? "/" : issue.path}: ${issue.message}`)
    .join("; ");
}
