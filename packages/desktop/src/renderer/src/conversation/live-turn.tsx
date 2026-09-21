/**
 * The turn the model is producing right now: in-flight reasoning and tool
 * calls, then streaming prose. Settled turns come from the transcript; this
 * only draws what has not committed yet.
 */
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { livePartKey } from "../live.ts";
import type { LiveSnapshot } from "../live.ts";
import { conversation } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { Prose } from "./prose.tsx";
import { WorkGroupView } from "./tool-group.tsx";

/** Dimmed while core still holds the message behind a live run; full weight once it lands. */
const PENDING_OPACITY = 0.6;

const pendingIn = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(4px)" },
  to: { opacity: PENDING_OPACITY, transform: "translateY(0)" },
});

export const liveTurnStyles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.rowGap,
    width: "100%",
    minWidth: 0,
  },
  /**
   * A message waiting on a live run, drawn where its turn will be: muted so
   * it reads as sent without pretending the run already answered it.
   */
  pending: {
    opacity: PENDING_OPACITY,
    animationName: {
      default: pendingIn,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: "180ms",
    animationTimingFunction: t.easeOut,
  },
});

export function LiveTurn({
  live,
  working,
  settledWork,
  cwd,
}: {
  live: LiveSnapshot;
  working: boolean;
  settledWork: boolean;
  cwd: string | undefined;
}): ReactElement | null {
  const appearance = useAppearanceSettings();
  const textParts = live.order.filter((ref) => ref.kind === "text");
  const hasText = textParts.length > 0;
  const hasLiveWork =
    live.order.some((ref) => ref.kind === "thinking") ||
    live.tools.size > 0 ||
    (!hasText && working);
  if (!hasText && !hasLiveWork && !working) return null;

  return (
    <div {...stylex.props(liveTurnStyles.root)}>
      {!settledWork && hasLiveWork && (
        <WorkGroupView
          parts={[]}
          run={{ kind: "none" }}
          live={live}
          liveTools={live.tools}
          cwd={cwd}
          added={0}
          removed={0}
          running={working}
          density={appearance.toolCalls}
        />
      )}
      {textParts.map((ref) => {
        const key = livePartKey(ref.runId, ref.attempt, ref.index);
        const text = live.text.get(key) ?? "";
        return text === "" ? null : <Prose key={`text:${key}`} markdown={text} streaming />;
      })}
    </div>
  );
}
