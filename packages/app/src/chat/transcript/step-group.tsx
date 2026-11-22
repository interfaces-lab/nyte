import { props } from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { focus, srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import type { ToolCallDensity } from "../../preferences/index.ts";
import { activityStyles } from "./activity.stylex.ts";
import { stepGroupStyles } from "./step-group.stylex.ts";
import { BrowserCallsView } from "../tools/browser-call.tsx";
import { ToolCallView } from "../tools/tool-call.tsx";
import { Prose } from "../../markdown/prose.tsx";
import { ThinkingLine } from "./thinking-line.tsx";
import { thoughtProse } from "./transcript-row-views.ts";
import type { StepMessage } from "./transcript-presentation.ts";
import { nextPin, PINNED } from "./step-group-pin.ts";
import type { StepGroupPinEvent } from "./step-group-pin.ts";
import { useStepGroupOpen } from "./step-group-open.ts";
import { stepGroupContent } from "./step-group-content.ts";
import { stepGroupFacts } from "./step-group-presentation.ts";
import type { StepGroupFacts } from "./step-group-presentation.ts";
import type { StepEntry } from "./step-entries.ts";
import { ChangeStats } from "../../components/change-stats.tsx";

const STEP_LIMIT = 200;

const FOCUSABLE = "a[href], button, [tabindex]";

export function StepEntryView({
  entry,
  cwd,
  density,
  thinkingOnly,
  titled,
  live,
}: {
  entry: StepEntry;
  cwd: string | undefined;
  density: ToolCallDensity;
  thinkingOnly: boolean;
  titled: boolean;
  live: boolean;
}): ReactElement {
  switch (entry.kind) {
    case "tool":
      return (
        <ToolCallView message={entry.message} calls={entry.calls} cwd={cwd} density={density} />
      );
    case "browser":
      return <BrowserCallsView calls={entry.steps} />;
    case "thinking": {
      if (thinkingOnly) {
        const thought = thoughtProse(entry.message, entry.markdown, titled);

        return (
          <div {...props(stepGroupStyles.thinking)}>
            <span {...props(srOnly)}>Reasoning</span>
            <Prose markdown={thought.markdown} streaming={thought.streaming} />
          </div>
        );
      }

      return (
        <ThinkingLine
          message={entry.message}
          text={entry.markdown}
          live={live}
          thoughtKey={entry.key}
        />
      );
    }

    default: {
      const _exhaustive: never = entry;

      return _exhaustive;
    }
  }
}

export function StepGroupView({
  messages,
  cwd,
  added,
  removed,
  running,
  density,
}: {
  messages: readonly StepMessage[];
  cwd: string | undefined;
  added: number;
  removed: number;
  running: boolean;
  density: ToolCallDensity;
}): ReactElement {
  return (
    <StepGroupFactsView
      facts={stepGroupFacts(messages, running)}
      cwd={cwd}
      added={added}
      removed={removed}
      running={running}
      density={density}
    />
  );
}

export function StepGroupFactsView({
  facts,
  cwd,
  added,
  removed,
  running,
  density,
}: {
  facts: StepGroupFacts;
  cwd: string | undefined;
  added: number;
  removed: number;
  running: boolean;
  density: ToolCallDensity;
}): ReactElement {
  const line = facts.line;
  const thinkingOnly = facts.thinkingOnly;
  const entries = facts.entries;
  const titled = facts.titled;
  const hasContent = facts.hasContent;

  const [open, setOpen] = useStepGroupOpen(facts.openKey);

  const [showEarlier, setShowEarlier] = useState(false);
  const earlier = showEarlier ? 0 : Math.max(0, entries.length - STEP_LIMIT);

  const content = stepGroupContent({
    density,
    active: running,
    open,
    hasContent,
    thinkingOnly,
  });

  const preview = content === "preview";
  const expanded = content === "open";
  const panelId = useId();

  const triggerRef = useRef<HTMLButtonElement>(null);
  const callsRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef(PINNED);

  const followPreview = (viewport: HTMLDivElement | null): (() => void) | undefined => {
    if (viewport === null || !preview) {
      pinRef.current = PINNED;

      return undefined;
    }

    const follow = (): void => {
      viewport.toggleAttribute("data-overflow", viewport.scrollHeight > viewport.clientHeight);

      if (pinRef.current.pinned) viewport.scrollTop = viewport.scrollHeight;
    };

    const record = (event: StepGroupPinEvent): void => {
      pinRef.current = nextPin(pinRef.current, event);
    };

    const input = (event: Event): void => record({ kind: "input", at: event.timeStamp });
    const lift = (): void => record({ kind: "pointer", down: false });
    const listeners = new AbortController();
    const options = { passive: true, signal: listeners.signal };
    viewport.addEventListener("wheel", input, options);
    viewport.addEventListener("touchmove", input, options);
    viewport.addEventListener("keydown", input, options);
    viewport.addEventListener(
      "pointerdown",
      () => record({ kind: "pointer", down: true }),
      options,
    );
    window.addEventListener("pointerup", lift, options);
    window.addEventListener("pointercancel", lift, options);
    viewport.addEventListener(
      "scroll",
      (event) => {
        record({
          kind: "scrolled",
          at: event.timeStamp,
          scrollTop: viewport.scrollTop,
          scrollHeight: viewport.scrollHeight,
          clientHeight: viewport.clientHeight,
        });
        follow();
      },
      options,
    );
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(viewport);

    for (const child of viewport.children) observer.observe(child);

    return () => {
      listeners.abort();
      observer.disconnect();
    };
  };

  const summaryLine = (
    <>
      <span {...props(stepGroupStyles.verb, running && activityStyles.shimmer)}>
        {line.kind === "thinking" ? "Thinking" : line.verb}
      </span>
      {line.kind === "summary" && line.detail !== undefined && (
        <span {...props(stepGroupStyles.summary)}>{line.detail}</span>
      )}
      <ChangeStats added={added} removed={removed} />
    </>
  );

  if (!hasContent) {
    return (
      <div
        aria-busy={running || undefined}
        {...props(stepGroupStyles.root, stepGroupStyles.status)}
      >
        {summaryLine}
      </div>
    );
  }

  const disclosure = {
    variant: "plain",
    "aria-controls": expanded ? panelId : undefined,
    xstyle: [stepGroupStyles.toggle, focus.ring],
  } as const;

  return (
    <Collapsible.Root
      open={expanded}
      onOpenChange={setOpen}
      aria-busy={running || undefined}
      xstyle={stepGroupStyles.root}
    >
      <Collapsible.Trigger ref={triggerRef} {...disclosure}>
        {summaryLine}
        <Collapsible.Chevron xstyle={stepGroupStyles.chevron} />
      </Collapsible.Trigger>
      {content !== "closed" && (
        <Collapsible.Preview
          id={panelId}
          ref={followPreview}
          data-nyte-scrollport={preview || undefined}
          data-step-preview={preview || undefined}
          xstyle={[stepGroupStyles.panel, preview && stepGroupStyles.preview]}
        >
          <div ref={callsRef} {...props(stepGroupStyles.calls)}>
            {expanded && earlier > 0 && (
              <Button
                variant="plain"
                size="sm"
                onClick={() => {
                  flushSync(() => setShowEarlier(true));
                  const first = callsRef.current?.firstElementChild;
                  const step = first?.matches(FOCUSABLE) ? first : first?.querySelector(FOCUSABLE);
                  (step instanceof HTMLElement ? step : triggerRef.current)?.focus({
                    preventScroll: true,
                  });
                }}
                xstyle={stepGroupStyles.earlier}
              >
                Show {earlier} earlier steps
              </Button>
            )}
            {entries.slice(earlier).map((entry) => (
              <StepEntryView
                key={entry.key}
                entry={entry}
                cwd={cwd}
                density={density}
                thinkingOnly={thinkingOnly}
                titled={titled}
                live={running}
              />
            ))}
          </div>
        </Collapsible.Preview>
      )}
    </Collapsible.Root>
  );
}
