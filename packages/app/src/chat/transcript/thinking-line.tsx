import { props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { activityStyles } from "./activity.stylex.ts";
import { stepGroupStyles } from "./step-group.stylex.ts";
import { Prose } from "../markdown/prose.tsx";
import type { ThinkingMessage } from "@nyte-ai/plugin/client/presentation";
import { thoughtView } from "./transcript-row-views.ts";
import { useShownLive } from "./step-group-open.ts";

export function ThinkingLine({
  message,
  text: reasoning,
  live = false,
  thoughtKey,
}: {
  message: ThinkingMessage;
  text: string;
  live?: boolean;
  thoughtKey?: string;
}): ReactElement | null {
  const [open, setOpen] = useState<boolean | undefined>();
  const unfolded = useShownLive(thoughtKey, live);
  const thought = thoughtView(message, reasoning, unfolded);

  if (thought === null) return null;
  const streaming = thought.streaming;

  const label = (
    <span {...props(stepGroupStyles.verb, streaming && activityStyles.shimmer)}>
      {thought.label}
    </span>
  );

  if (thought.kind === "label") return <div {...props(stepGroupStyles.status)}>{label}</div>;

  const prose = (
    <div {...props(stepGroupStyles.calls, stepGroupStyles.thinking)}>
      <Prose markdown={thought.body} streaming={streaming} />
    </div>
  );

  if (thought.kind === "unfolded") {
    return (
      <div aria-busy={streaming || undefined} {...props(stepGroupStyles.root)}>
        <div {...props(stepGroupStyles.status)}>{label}</div>
        {prose}
      </div>
    );
  }

  return (
    <Collapsible.Root
      open={open ?? streaming}
      onOpenChange={setOpen}
      aria-busy={streaming || undefined}
      xstyle={stepGroupStyles.root}
    >
      <Collapsible.Trigger variant="plain" xstyle={[stepGroupStyles.toggle, focus.ring]}>
        {label}
        <Collapsible.Chevron xstyle={stepGroupStyles.chevron} />
      </Collapsible.Trigger>
      <Collapsible.Panel>{prose}</Collapsible.Panel>
    </Collapsible.Root>
  );
}
