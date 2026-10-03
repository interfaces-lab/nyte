import { props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { activityStyles, toolGroupStyles } from "./styles.stylex.ts";
import { Prose } from "./prose.tsx";
import { reasoningHeading } from "./reasoning-heading.ts";

/** Reasoning between tool calls: open while it streams, folded to its title once it settles. */
export function ThinkingLine({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}): ReactElement | null {
  const [open, setOpen] = useState<boolean | undefined>();

  if (text.trim() === "" && !streaming) return null;

  const { title, body } = streaming ? { title: undefined, body: text } : reasoningHeading(text);

  const label = (
    <span {...props(toolGroupStyles.verb, streaming && activityStyles.shimmer)}>
      {streaming ? "Thinking" : (title ?? "Thought")}
    </span>
  );

  if (body.trim() === "") return <div {...props(toolGroupStyles.status)}>{label}</div>;

  return (
    <Collapsible.Root
      open={open ?? streaming}
      onOpenChange={setOpen}
      aria-busy={streaming || undefined}
      xstyle={toolGroupStyles.root}
    >
      <Collapsible.Trigger variant="plain" xstyle={[toolGroupStyles.toggle, focus.ring]}>
        {label}
        <Collapsible.Chevron xstyle={toolGroupStyles.chevron} />
      </Collapsible.Trigger>
      <Collapsible.Panel>
        <div {...props(toolGroupStyles.calls, toolGroupStyles.thinking)}>
          <Prose markdown={body} streaming={streaming} />
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
