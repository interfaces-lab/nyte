import { isPart, text } from "@nyte-ai/plugin/client";
import type { FileStatus, TurnInfo } from "@nyte-ai/sdk";
import type { HeadView } from "@nyte-ai/sdk/client";

/** Edits count by their call; other calls name no file, so the paths they hold are the files they changed. */
export function changedFiles(turn: TurnInfo): boolean {
  const calls = turn.summary.byClass;

  return (
    calls.edit.count > 0 ||
    [calls.shell, calls.delegate, calls.custom].some((entry) => entry.paths.length > 0)
  );
}

export function latestChangedTurn(view: HeadView): TurnInfo | undefined {
  return view.turns.findLast(changedFiles);
}

export function turnAnswer(view: HeadView, turn: TurnInfo): string | undefined {
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
