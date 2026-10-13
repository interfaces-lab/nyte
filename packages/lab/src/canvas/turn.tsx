import { create, props } from "@stylexjs/stylex";
import { TurnView } from "@nyte-ai/app/conversation/turn-view.tsx";
import { conversation } from "@nyte-ai/app/theme/schema.stylex.ts";
import { preferences, useSetting } from "@nyte-ai/app/preferences/index.ts";
import type { ReactElement } from "react";
import { CanvasFrame } from "./frame";
import { isToolMessage, toolOutput, type ConversationTurn } from "@nyte-ai/app/view-helpers.ts";

const noContinuations: readonly ConversationTurn[] = [];

export function CanvasTurn({
  turn,
  running,
}: {
  readonly turn: ConversationTurn;
  readonly running: boolean;
}): ReactElement {
  const density = useSetting(preferences.toolCalls);

  const ids = turn.messages.flatMap((message) => {
    if (
      !isToolMessage(message) ||
      message.state.class.kind !== "custom" ||
      message.state.class.label !== "Canvas" ||
      message.state.phase !== "settled" ||
      message.state.outcome.kind !== "ok"
    )
      return [];
    const id = /^canvas:([a-f0-9]{64})(?:\n|$)/.exec(toolOutput(message.state))?.[1];

    return id === undefined ? [] : [id];
  });

  const lastWorking = turn.messages.findLastIndex(
    (message) => message.kind !== "part" || message.role !== "answer",
  );

  const finalMessages = turn.messages.slice(lastWorking + 1);
  const failed = turn.info.state.kind === "ended" && turn.info.state.end.kind === "failed";

  const before =
    ids.length === 0
      ? turn
      : {
          info: { ...turn.info, state: { kind: "working", activity: null } as const },
          messages: turn.messages.slice(0, lastWorking + 1),
        };

  return (
    <div {...props(styles.turn)}>
      <TurnView
        turn={before}
        continuations={noContinuations}
        density={density}
        cwd={undefined}
        changes={[]}
        onOpenChanges={() => {}}
        running={running && finalMessages.length === 0}
      />
      {[...new Set(ids)].map((id) => (
        <CanvasFrame key={id} id={id} />
      ))}
      {ids.length > 0 && (finalMessages.length > 0 || failed) && (
        <TurnView
          turn={{ ...turn, messages: finalMessages }}
          continuations={noContinuations}
          density={density}
          cwd={undefined}
          changes={[]}
          onOpenChanges={() => {}}
          running={running}
        />
      )}
    </div>
  );
}

const styles = create({
  turn: { display: "flex", flexDirection: "column", gap: conversation.rowGap, minWidth: 0 },
});
