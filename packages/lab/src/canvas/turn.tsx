import { create, props } from "@stylexjs/stylex";
import { TurnView } from "@nyte-ai/app/conversation/turn-view.tsx";
import { conversation } from "@nyte-ai/app/theme/schema.stylex.ts";
import type { ReactElement } from "react";
import { CanvasFrame } from "./frame";
import type { ConversationTurn } from "./demo";

const noTools = new Map();

const noContinuations: readonly ConversationTurn[] = [];

export function CanvasTurn({
  turn,
  running,
}: {
  readonly turn: ConversationTurn;
  readonly running: boolean;
}): ReactElement {
  const ids = turn.parts.flatMap((part) => {
    if (
      part.kind !== "tool" ||
      part.class.kind !== "custom" ||
      part.class.label !== "Canvas" ||
      part.state.kind !== "success"
    )
      return [];
    const id = /^canvas:([a-f0-9]{64})(?:\n|$)/.exec(part.output ?? "")?.[1];

    return id === undefined ? [] : [id];
  });

  const lastWorking = turn.parts.findLastIndex((part) => part.kind !== "assistant");
  const finalParts = turn.parts.slice(lastWorking + 1);

  const before =
    ids.length === 0
      ? turn
      : { ...turn, parts: turn.parts.slice(0, lastWorking + 1), failure: undefined };

  return (
    <div {...props(styles.turn)}>
      <TurnView
        turn={before}
        continuations={noContinuations}
        liveTools={noTools}
        cwd={undefined}
        onOpenChanges={() => {}}
        running={running && finalParts.length === 0}
      />
      {[...new Set(ids)].map((id) => (
        <CanvasFrame key={id} id={id} />
      ))}
      {ids.length > 0 && (finalParts.length > 0 || turn.failure !== undefined) && (
        <TurnView
          turn={{ ...turn, parts: finalParts }}
          continuations={noContinuations}
          liveTools={noTools}
          cwd={undefined}
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
