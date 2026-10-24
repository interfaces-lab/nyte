import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { conversation } from "../theme/schema.stylex.ts";
import { sessionWatch, useWatchSelect } from "../sdk.tsx";
import { activityStyles } from "./activity.stylex.ts";
import { usePlanningTime } from "./planning-time.ts";
import { stepGroupStyles } from "./step-group.stylex.ts";
import { liveStatusLabel, PLANNING_LABEL } from "./step-group-presentation.ts";
import { useTranscriptScope } from "./transcript.tsx";

export const liveTurnStyles = create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.rowGap,
    width: "100%",
    minWidth: 0,
  },
  waiting: { visibility: "hidden" },
});

export function LiveTurn({
  working,
  settledWork,
}: {
  working: boolean;
  settledWork: boolean;
}): ReactElement | null {
  if (!working || settledWork) return null;

  return <PlanningLine />;
}

function PlanningLine(): ReactElement {
  const sessionId = useTranscriptScope()?.sessionId;

  const planning = useWatchSelect(
    sessionId === undefined ? undefined : sessionWatch(sessionId),
    (state) => state.value?.activity.kind === "idle",
  );

  const planningMs = usePlanningTime(planning);
  const label = planning ? liveStatusLabel({ kind: "planning" }, planningMs) : undefined;

  return (
    <div {...props(liveTurnStyles.root)}>
      <div aria-busy {...props(stepGroupStyles.root, stepGroupStyles.status)}>
        <span
          {...props(
            stepGroupStyles.verb,
            label === undefined ? liveTurnStyles.waiting : activityStyles.shimmer,
          )}
        >
          {label ?? PLANNING_LABEL}
        </span>
      </div>
    </div>
  );
}
