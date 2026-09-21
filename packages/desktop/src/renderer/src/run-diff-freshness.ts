import type { RunDiff, RunId, SessionId } from "@nyte-ai/protocol";

export class RunDiffFreshness {
  private readonly checked = new Map<SessionId, Set<RunId>>();

  needsRefresh(sessionId: SessionId, runId: RunId, terminal: boolean, diff: RunDiff | undefined) {
    if (!terminal || diff === undefined) return true;
    switch (diff.kind) {
      case "tree":
        return false;
      case "recorded":
      case "not_found":
        return !this.checked.get(sessionId)?.has(runId);
      default: {
        const _exhaustive: never = diff;
        return _exhaustive;
      }
    }
  }

  recordCheck(sessionId: SessionId, runId: RunId, terminal: boolean, diff: RunDiff): void {
    if (!terminal) return;
    switch (diff.kind) {
      case "tree":
        return;
      case "recorded":
      case "not_found": {
        const checked = this.checked.get(sessionId) ?? new Set<RunId>();
        checked.add(runId);
        this.checked.set(sessionId, checked);
        return;
      }
      default: {
        const _exhaustive: never = diff;
        return _exhaustive;
      }
    }
  }

  release(sessionId: SessionId): void {
    this.checked.delete(sessionId);
  }
}
