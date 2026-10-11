import { isPart, text } from "@nyte-ai/plugin/client";
import type { FileStatus, SessionView, TurnInfo } from "@nyte-ai/sdk";

/** Returns whether a turn's run changed files, by the summary the fold keeps. */
export function changedFiles(turn: TurnInfo): boolean {
  return turn.summary.added + turn.summary.removed > 0 || turn.summary.byClass.edit.count > 0;
}

/** The newest turn that changed files — the anchor for the review summary. */
export function latestChangedTurn(view: SessionView): TurnInfo | undefined {
  return view.turns.findLast(changedFiles);
}

/** Returns a turn's last answer, the agent's own summary of what it did. */
export function turnAnswer(view: SessionView, turn: TurnInfo): string | undefined {
  const answer = view.messages.findLast(
    (message) => message.turn === turn.id && isPart(message, text),
  );

  return answer !== undefined && isPart(answer, text) ? answer.state.markdown : undefined;
}

/** The one-letter badge of a changed path. */
export function fileStatus(status: FileStatus): "A" | "M" | "D" | "R" {
  switch (status) {
    case "added":
    case "untracked":
      return "A";
    case "modified":
    case "conflicted":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    default: {
      const _exhaustive: never = status;

      return _exhaustive;
    }
  }
}

/** A turn's runtime: 42s, 5m, 1h 12m. Zero means nothing followed the commit. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);

  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${String(minutes)}m`;

  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}
