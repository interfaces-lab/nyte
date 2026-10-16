import type { SessionView } from "@nyte-ai/sdk";
import { displayTranscriptParts } from "@nyte-ai/app/conversation/transcript-presentation.ts";
import { transcriptRows } from "@nyte-ai/app/conversation/transcript-rows.ts";
import type { TranscriptRow } from "@nyte-ai/app/conversation/transcript-rows.ts";
import { showsText, showsTool } from "@nyte-ai/plugin/client/presentation";
import type { Scene } from "./specimens";

export interface Stage {
  readonly rows: readonly TranscriptRow[];
  readonly changes: SessionView["changes"];
  readonly working: boolean;
  readonly settledWork: boolean;
}

export function stage(scene: Scene): Stage {
  const landing = scene.landing ?? [];
  const running = scene.execution !== undefined && scene.execution.kind !== "idle";
  const working = running || landing.length > 0;
  const lastTurn = scene.turns.at(-1);

  const settledWork =
    lastTurn !== undefined && displayTranscriptParts(lastTurn.messages).at(-1)?.kind === "step";

  const rows = transcriptRows({
    loading: scene.loading === true,
    failed: scene.failed === true,
    turns: scene.turns,
    landing,
    held: scene.execution?.kind === "idle" && scene.execution.lastRun?.end.kind !== "completed",
    retrying: scene.execution?.kind === "retrying" ? scene.execution.reason : undefined,
    working,
    running,
  });

  const changes = scene.turns.flatMap((turn) =>
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
  );

  return { rows, changes, working, settledWork };
}

export function trail({ rows, working }: Stage): readonly string[] {
  return rows.flatMap((row): readonly string[] => {
    switch (row.kind) {
      case "skeleton":
      case "error":
        return [row.kind];
      case "retry":
        return [`retry "${row.message}"`];
      case "landing":
        return [`landing${row.pending ? " · pending" : ""}`];
      case "live":
        return row.working ? ["live"] : [];
      case "turn": {
        const turns = [row.turn, ...row.continuations];
        const trailing = row.trailing && working;

        const head = `turn${trailing ? " · trailing, running" : ""}${
          row.continuations.length > 0 ? ` · +${String(row.continuations.length)} continuation` : ""
        }`;

        return [
          head,
          ...turns.flatMap((entry, turnIndex): readonly string[] => {
            const display = displayTranscriptParts(entry.messages);
            const active = trailing && turnIndex === turns.length - 1;

            const groups = display.map((item, index) => {
              switch (item.kind) {
                case "part": {
                  const { message } = item;

                  if (message.kind === "user") return "  user";

                  return `  ${message.partKind}${showsTool(message) ? `:${message.state.class.kind}` : ""}${message.status.kind === "live" ? " · live" : ""}`;
                }

                case "agents":
                  return `  agents ×${String(item.messages.length)}`;
                case "response":
                  return `  response ×${String(item.messages.length)}${item.messages.some((message) => showsText(message) && message.status.kind === "live") ? " · live" : ""}`;
                case "step": {
                  const kinds = item.messages
                    .map((message) =>
                      showsTool(message) ? message.state.class.kind : message.partKind,
                    )
                    .join(", ");

                  const [first] = item.messages;

                  const lone =
                    item.messages.length === 1 &&
                    first !== undefined &&
                    showsTool(first) &&
                    !(active && index === display.length - 1);

                  return lone ? `  step → line [${kinds}]` : `  step [${kinds}]`;
                }

                default: {
                  const _exhaustive: never = item;

                  return _exhaustive;
                }
              }
            });

            const { state } = entry.info;

            return state.kind === "ended" && state.end.kind === "failed"
              ? [...groups, `  failure ${state.end.failure.class}`]
              : groups;
          }),
        ];
      }

      default: {
        const _exhaustive: never = row;

        return _exhaustive;
      }
    }
  });
}
