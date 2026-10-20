import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { transcriptRows } from "@nyte-ai/app/conversation/transcript-rows.ts";
import type { TurnItemRow } from "@nyte-ai/app/conversation/transcript-rows.ts";
import { TurnItemView } from "@nyte-ai/app/conversation/turn-view.tsx";
import type { ToolCallDensity } from "@nyte-ai/app/preferences/index.ts";
import { conversation } from "@nyte-ai/app/theme/schema.stylex.ts";
import type { TurnMessages } from "@nyte-ai/app/view-helpers.ts";

export function TurnRows({
  turn,
  running,
  density,
  cwd,
}: {
  readonly turn: TurnMessages;
  readonly running: boolean;
  readonly density: ToolCallDensity;
  readonly cwd: string | undefined;
}): ReactElement | null {
  const rows = transcriptRows({
    loading: false,
    failed: false,
    turns: [turn],
    changes: [],
    prompts: [],
    held: false,
    retrying: undefined,
    running,
  }).flatMap((row): readonly TurnItemRow[] => {
    switch (row.kind) {
      case "part":
      case "step":
      case "agents":
      case "response":
      case "failure":
        return [row];
      default:
        return [];
    }
  });

  if (rows.length === 0) return null;

  return (
    <div {...props(styles.turn)}>
      {rows.map((row) => (
        <TurnItemView
          key={row.key}
          row={row}
          running={row.kind === "step" && row.trailing && running}
          density={density}
          cwd={cwd}
        />
      ))}
    </div>
  );
}

const styles = create({
  turn: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.rowGap,
    width: "100%",
    minWidth: 0,
  },
});
