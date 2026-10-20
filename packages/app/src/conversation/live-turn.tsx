import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { conversation } from "../theme/schema.stylex.ts";
import type { ToolCallDensity } from "../preferences/index.ts";
import { StepGroupView } from "./step-group.tsx";

export const liveTurnStyles = create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.rowGap,
    width: "100%",
    minWidth: 0,
  },
});

export function LiveTurn({
  working,
  settledWork,
  cwd,
  density,
}: {
  working: boolean;
  settledWork: boolean;
  cwd: string | undefined;
  density: ToolCallDensity;
}): ReactElement | null {
  if (!working || settledWork) return null;

  return (
    <div {...props(liveTurnStyles.root)}>
      <StepGroupView messages={[]} cwd={cwd} added={0} removed={0} running density={density} />
    </div>
  );
}
