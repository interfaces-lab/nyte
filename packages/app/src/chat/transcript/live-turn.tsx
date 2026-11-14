import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { conversation } from "../../theme/schema.stylex.ts";
import { activityStyles } from "./activity.stylex.ts";
import { usePlanningTime } from "./planning-time.ts";
import { stepGroupStyles } from "./step-group.stylex.ts";
import {
  PLANNING_LABEL,
  planningLabel,
  SLOW_PLANNING_MS,
} from "@nyte-ai/plugin/client/presentation";
import type { LiveRowFacts } from "./transcript-rows.ts";

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

export function LiveTurn({ live }: { live: LiveRowFacts }): ReactElement | null {
  if (live.state === "idle") return null;

  return <PlanningLine live={live} />;
}

function PlanningLine({ live }: { live: LiveRowFacts }): ReactElement {
  const planningMs = usePlanningTime(live.planning, live.newest);

  const label =
    live.thought ??
    (live.planning && (live.state !== "grouped" || planningMs >= SLOW_PLANNING_MS)
      ? planningLabel(planningMs)
      : undefined);

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
