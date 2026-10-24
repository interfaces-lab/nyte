import { props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { activityStyles } from "./activity.stylex.ts";
import { stepGroupStyles } from "./step-group.stylex.ts";
import { Prose } from "./prose.tsx";
import { reasoningHeading } from "./reasoning-heading.ts";

export function ThinkingLine({
  text: reasoning,
  streaming,
  live = false,
}: {
  text: string;
  streaming: boolean;
  live?: boolean;
}): ReactElement | null {
  const [open, setOpen] = useState<boolean | undefined>();
  const [unfolded] = useState(live);

  if (reasoning.trim() === "" && !streaming) return null;

  const { title, body } =
    streaming || unfolded ? { title: undefined, body: reasoning } : reasoningHeading(reasoning);

  const label = (
    <span {...props(stepGroupStyles.verb, streaming && activityStyles.shimmer)}>
      {streaming ? "Thinking" : (title ?? "Thought")}
    </span>
  );

  if (body.trim() === "") return <div {...props(stepGroupStyles.status)}>{label}</div>;

  const prose = (
    <div {...props(stepGroupStyles.calls, stepGroupStyles.thinking)}>
      <Prose markdown={body} streaming={streaming} />
    </div>
  );

  if (unfolded)
    return (
      <div aria-busy={streaming || undefined} {...props(stepGroupStyles.root)}>
        <div {...props(stepGroupStyles.status)}>{label}</div>
        {prose}
      </div>
    );

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
