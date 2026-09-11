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
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { Prose } from "./prose.tsx";
import { WorkGroupView } from "./tool-group.tsx";

export const liveTurnStyles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.rowGap,
    width: "100%",
    minWidth: 0,
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
          live={live}
          liveTools={live.tools}
          cwd={cwd}
          durationMs={0}
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
