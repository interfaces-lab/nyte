import type { RunDiff, RunId, SessionId } from "@nyte-ai/protocol";

export class RunDiffFreshness {
  private readonly checked = new Map<SessionId, Set<RunId>>();

  needsRefresh(sessionId: SessionId, runId: RunId, terminal: boolean, diff: RunDiff | undefined) {
    return !terminal || diff === undefined || !this.checked.get(sessionId)?.has(runId);
  }

  recordCheck(sessionId: SessionId, runId: RunId, terminal: boolean): void {
    if (!terminal) return;
    const checked = this.checked.get(sessionId) ?? new Set<RunId>();
    checked.add(runId);
    this.checked.set(sessionId, checked);
  }

  release(sessionId: SessionId): void {
    this.checked.delete(sessionId);
  }
}
