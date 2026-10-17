import { isPart, text } from "@nyte-ai/plugin/client";
import type { FileStatus, SessionView, TurnInfo } from "@nyte-ai/sdk";

export function changedFiles(turn: TurnInfo): boolean {
  return turn.summary.added + turn.summary.removed > 0 || turn.summary.byClass.edit.count > 0;
}

export function latestChangedTurn(view: SessionView): TurnInfo | undefined {
  return view.turns.findLast(changedFiles);
}

export function turnAnswer(view: SessionView, turn: TurnInfo): string | undefined {
  const answer = view.messages.findLast(
    (message) => message.turn === turn.id && isPart(message, text),
  );

  return answer !== undefined && isPart(answer, text) ? answer.state.markdown : undefined;
}

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
