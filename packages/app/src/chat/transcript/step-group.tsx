import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ReactElement } from "react";
import { showsThinking, showsTool } from "@nyte-ai/plugin/client/presentation";
import { AnimatedNumber } from "../../components/animated-number.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { focus, srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import type { ToolCallDensity } from "../../preferences/index.ts";
import { activityStyles } from "./activity.stylex.ts";
import { stepGroupStyles } from "./step-group.stylex.ts";
import { ToolCallView } from "../tools/tool-call.tsx";
import { Prose } from "../markdown/prose.tsx";
import { ThinkingLine } from "./thinking-line.tsx";
import { reasoningHeading } from "./reasoning-heading.ts";
import type { StepMessage } from "./transcript-presentation.ts";
import { nextPin, PINNED } from "./step-group-pin.ts";
import type { StepGroupPinEvent } from "./step-group-pin.ts";
import { useStepGroupOpen } from "./step-group-open.ts";
import { stepGroupContent } from "./step-group-content.ts";
import { stepGroupLine } from "./step-group-presentation.ts";

const STEP_LIMIT = 200;

const FOCUSABLE = "a[href], button, [tabindex]";

interface StepLine {
  readonly key: string;
  readonly message: StepMessage;
  readonly markdown: string;
}

function StepLineView({
  entry,
  cwd,
  density,
  thinkingOnly,
  titled,
  live,
}: {
  entry: StepLine;
  cwd: string | undefined;
  density: ToolCallDensity;
  thinkingOnly: boolean;
  titled: boolean;
  live: boolean;
}): ReactElement | null {
  const { message } = entry;

  if (showsTool(message)) return <ToolCallView message={message} cwd={cwd} density={density} />;
  const streaming = message.status.kind === "live";

  if (thinkingOnly) {
    return (
      <div {...props(stepGroupStyles.thinking)}>
        <span {...props(srOnly)}>Reasoning</span>
        <Prose
          markdown={titled && !streaming ? reasoningHeading(entry.markdown).body : entry.markdown}
          streaming={streaming}
        />
      </div>
    );
  }

  return <ThinkingLine text={entry.markdown} streaming={streaming} live={live} />;
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
  const [now] = useState(() => Date.now());
  const first = messages[0];
  const last = messages.at(-1);
  const lastAt = last?.status.kind === "settled" ? last.status.endedAt : last?.at;

  const durationMs =
    first === undefined ? 0 : Math.max(0, (running ? now : (lastAt ?? first.at)) - first.at);

  const line = stepGroupLine({ messages, durationMs, running });

  const thinkingOnly = messages.every(showsThinking);

  const entries = messages
    .filter((message) => showsTool(message) || message.state.markdown.trim() !== "")
    .reduce<StepLine[]>((merged, message) => {
      const previous = merged.at(-1);

      if (
        !thinkingOnly &&
        showsThinking(message) &&
        previous !== undefined &&
        showsThinking(previous.message)
      ) {
        merged[merged.length - 1] = {
          ...previous,
          message,
          markdown: `${previous.markdown}\n\n${message.state.markdown}`,
        };

        return merged;
      }

      merged.push({
        key: message.id,
        message,
        markdown: showsThinking(message) ? message.state.markdown : "",
      });

      return merged;
    }, []);

  const [open, setOpen] = useStepGroupOpen(first?.id);

  const [showEarlier, setShowEarlier] = useState(false);
  const earlier = showEarlier ? 0 : Math.max(0, entries.length - STEP_LIMIT);
  const [onlyThought] = messages;
  const titled = !running && thinkingOnly && messages.length === 1 && onlyThought !== undefined;

  const hasContent =
    entries.length > 0 &&
    !(
      titled &&
      showsThinking(onlyThought) &&
      reasoningHeading(onlyThought.state.markdown).body.trim() === ""
    );

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
      {(added > 0 || removed > 0) && (
        <span {...props(stepGroupStyles.stats)}>
          {added > 0 && (
            <span {...props(intent.success, stepGroupStyles.added)}>
              +<AnimatedNumber value={added} />
            </span>
          )}
          {removed > 0 && (
            <span {...props(intent.danger, stepGroupStyles.removed)}>
              -<AnimatedNumber value={removed} />
            </span>
          )}
        </span>
      )}
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
              <StepLineView
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
