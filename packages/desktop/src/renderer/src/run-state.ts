import type { RunInfo } from "@nyte-ai/core";

/** Terminal phases remain in history but no longer make their head live. */
export function runLive(run: RunInfo | undefined): boolean {
  if (run === undefined) return false;
  switch (run.phase.kind) {
    case "respond":
    case "tools":
    case "waiting":
    case "retry":
      return true;
    case "done":
    case "aborted":
    case "failed":
      return false;
    default: {
      const _exhaustive: never = run.phase;
      return _exhaustive;
    }
  }
}

/** A session is working while any of its heads has a live run. */
export function sessionWorking(session: {
  readonly heads: readonly { readonly run?: RunInfo }[];
}): boolean {
  return session.heads.some((head) => runLive(head.run));
}
