import type { SessionView } from "@nyte-ai/sdk";
import { displayTranscriptParts } from "@nyte-ai/app/conversation/transcript-presentation.ts";
import { transcriptRows } from "@nyte-ai/app/conversation/transcript-rows.ts";
import type { TranscriptRow } from "@nyte-ai/app/conversation/transcript-rows.ts";
import { showsText, showsTool } from "@nyte-ai/plugin/client/presentation";
import type { Scene } from "./build";

export interface Stage {
  readonly rows: readonly TranscriptRow[];
  readonly working: boolean;
  readonly settledWork: boolean;
}

export function stage(scene: Scene): Stage {
  const prompts = scene.prompts ?? [];
  const running = scene.execution !== undefined && scene.execution.kind !== "idle";
  const working = running || prompts.length > 0;
  const lastTurn = scene.turns.at(-1);

  const settledWork =
    lastTurn !== undefined && displayTranscriptParts(lastTurn.messages).at(-1)?.kind === "step";

  const changes = [
    ...new Map(
      scene.turns
        .flatMap((turn) =>
          turn.messages.flatMap((message): SessionView["changes"] => {
            if (!showsTool(message) || message.state.phase !== "settled") return [];
            const { changes: changed, name } = message.state;

            if (changed === null) return [];

            return changed.paths.map((path) => ({
              path,
              status: name === "write" && changed.removed === 0 ? "added" : "modified",
              added: changed.added,
              removed: changed.removed,
            }));
          }),
        )
        .map((change) => [change.path, change]),
    ).values(),
  ];

  const rows = transcriptRows({
    loading: scene.loading === true,
    failed: scene.failed === true,
    turns: scene.turns,
    changes,
    prompts,
    running,
    held: scene.execution?.kind === "idle" && scene.execution.lastRun?.end.kind !== "completed",
    retrying: scene.execution?.kind === "retrying" ? scene.execution.reason : undefined,
  });

  return { rows, working, settledWork };
}

export function trail({ rows, working }: Stage): readonly string[] {
  return rows.flatMap((row) => {
    const lines = rowLines(row, working);

    return row.group !== null && row.leads ? ["turn", ...lines] : lines;
  });
}

function rowLines(row: TranscriptRow, working: boolean): readonly string[] {
  switch (row.kind) {
    case "skeleton":
    case "error":
      return [row.kind];
    case "retry":
      return [`retry "${row.message}"`];
    case "prompt":
      return ["prompt"];
    case "live":
      return working ? ["live"] : [];
    case "part": {
      const { message } = row;

      if (message.kind === "user") return ["  user"];

      return [
        `  ${message.partKind}${showsTool(message) ? `:${message.state.class.kind}` : ""}${message.status.kind === "live" ? " · live" : ""}`,
      ];
    }

    case "agents":
      return [`  agents ×${String(row.messages.length)}`];
    case "response":
      return [
        `  response ×${String(row.messages.length)}${row.messages.some((message) => showsText(message) && message.status.kind === "live") ? " · live" : ""}`,
      ];
    case "step": {
      const kinds = row.messages
        .map((message) => (showsTool(message) ? message.state.class.kind : message.partKind))
        .join(", ");

      const [first] = row.messages;
      const { running } = row;

      const lone = row.messages.length === 1 && first !== undefined && showsTool(first) && !running;

      return [`  step${lone ? " → line" : ""} [${kinds}]${running ? " · running" : ""}`];
    }

    case "failure":
      return [`  failure ${row.failure.class}`];
    case "earlier":
      return ["  earlier steps"];
    case "changes":
      return working ? [] : [`  changes ×${String(row.files.length)}`];
    default: {
      const _exhaustive: never = row;

      return _exhaustive;
    }
  }
}
