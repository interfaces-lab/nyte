import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { conversation } from "../../theme/schema.stylex.ts";
import { chatStore } from "../../data/chat-store.ts";
import { useWatchSelect } from "../../data/watch-store.ts";
import { activityStyles } from "./activity.stylex.ts";
import { usePlanningTime } from "./planning-time.ts";
import { stepGroupStyles } from "./step-group.stylex.ts";
import {
  PLANNING_LABEL,
  planningLabel,
  SLOW_PLANNING_MS,
} from "@nyte-ai/plugin/client/presentation";
import { useTranscriptScope } from "./transcript.tsx";
import type { LiveRowState } from "./transcript-rows.ts";

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

export function LiveTurn({ state }: { state: LiveRowState }): ReactElement | null {
  if (state === "idle") return null;

  return <PlanningLine grouped={state === "grouped"} />;
}

function PlanningLine({ grouped }: { grouped: boolean }): ReactElement {
  const sessionId = useTranscriptScope()?.sessionId;
  const store = sessionId === undefined ? undefined : chatStore(sessionId);
  const planning = useWatchSelect(
    store,
    (state) => state.value?.execution.kind === "live" && state.value.activity.kind === "idle",
  );
  const newest = useWatchSelect(store, (state) => state.value?.messages.at(-1)?.id);
  const planningMs = usePlanningTime(planning, newest);

  const label =
    planning && (!grouped || planningMs >= SLOW_PLANNING_MS)
      ? planningLabel(planningMs)
      : undefined;

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
