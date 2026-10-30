import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { control, glyph } from "@nyte-ai/ui/styles/schema.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { formatTokens } from "../../lib/format.ts";
import { sessionWatch } from "../../data/watches.ts";
import { useWatchSelect } from "../../data/watch-store.ts";

const styles = create({
  box: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: control.heightXs,
    height: control.heightXs,
  },
  ring: { width: glyph.md, height: glyph.md, fill: "none" },
  track: { stroke: role.borderPrimary },
  used: {
    stroke: role.contentSecondary,
    transform: "rotate(-90deg)",
    transformOrigin: "center",
  },
});

export function ContextRing({ sessionId }: { readonly sessionId: SessionId }): ReactElement | null {
  const store = sessionWatch(sessionId);
  const tokens = useWatchSelect(store, (state) => state.value?.context.tokens ?? 0);
  const limit = useWatchSelect(store, (state) => state.value?.context.window ?? 0);

  if (limit === 0) return null;
  const percent = Math.round((tokens / limit) * 100);
  const used = `${String(percent)}% context used`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="meter"
            aria-label="Context"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={used}
            {...props(styles.box)}
          />
        }
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" {...props(styles.ring)}>
          <circle cx={8} cy={8} r={6} strokeWidth={2} {...props(styles.track)} />
          <circle
            cx={8}
            cy={8}
            r={6}
            strokeWidth={2}
            pathLength={100}
            strokeDasharray={`${String(percent)} 100`}
            {...props(styles.used)}
          />
        </svg>
      </TooltipTrigger>
      <TooltipContent side="top">{`${used}\n${formatTokens(tokens)} of ${formatTokens(limit)} tokens`}</TooltipContent>
    </Tooltip>
  );
}
