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
  showsThinking,
  SLOW_PLANNING_MS,
} from "@nyte-ai/plugin/client/presentation";
import type { Message } from "@nyte-ai/sdk";
import { reasoningHeading } from "./reasoning-heading.ts";
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

/** Without `thinking` rows, the line also stands in for the run's thinking, by its latest heading. */
export function LiveTurn({
  state,
  thinking,
}: {
  state: LiveRowState;
  thinking: boolean;
}): ReactElement | null {
  if (state === "idle") return null;

  return <PlanningLine grouped={state === "grouped"} thinking={thinking} />;
}

function PlanningLine({
  grouped,
  thinking,
}: {
  grouped: boolean;
  thinking: boolean;
}): ReactElement {
  const sessionId = useTranscriptScope()?.sessionId;
  const store = sessionId === undefined ? undefined : chatStore(sessionId);

  const planning = useWatchSelect(
    store,
    (state) => state.value?.execution.kind === "live" && state.value.activity.kind === "idle",
  );

  const newest = useWatchSelect(store, (state) => state.value?.messages.at(-1)?.id);
  const planningMs = usePlanningTime(planning, newest);

  const thought = useWatchSelect(store, (state) =>
    thinking || grouped || state.value?.activity.kind !== "thinking"
      ? undefined
      : thoughtLabel(state.value.messages),
  );

  const label =
    thought ??
    (planning && (!grouped || planningMs >= SLOW_PLANNING_MS)
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

function thoughtLabel(messages: readonly Message[]): string {
  const thought = messages.findLast(showsThinking);

  return (
    (thought === undefined ? undefined : reasoningHeading(thought.state.markdown).title) ??
    "Thinking"
  );
}
