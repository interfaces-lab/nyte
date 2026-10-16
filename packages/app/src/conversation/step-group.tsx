import { intent } from "@nyte-ai/ui/surface-theme";
/**
 * Intermediate narration, reasoning, and tool calls form one work episode.
 * Compact mode keeps the episode in a clipped window
 * that follows new output; opening the group reveals the full list. The
 * final assistant response remains outside this component.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/ui/src/work-group.tsx
 */
import { props } from "@stylexjs/stylex";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ReactElement } from "react";
import { AnimatedNumber } from "../components/animated-number.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { focus, srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import type { ToolCallDensity } from "../preferences/index.ts";
import { isToolMessage } from "../view-helpers.ts";
import { activityStyles, stepGroupStyles } from "./styles.stylex.ts";
import { ToolCallView } from "./tool-call.tsx";
import { Prose } from "./prose.tsx";
import { ThinkingLine } from "./thinking-line.tsx";
import { reasoningHeading } from "./reasoning-heading.ts";
import { isThinkingMessage } from "./transcript-presentation.ts";
import type { StepMessage } from "./transcript-presentation.ts";
import {
  FOLLOW_INPUT_MS,
  FOLLOW_RESUME_MS,
  followOnScroll,
  overflows,
} from "./step-group-follow.ts";
import { useStepGroupOpen } from "./step-group-open.ts";
import { stepGroupContent } from "./step-group-content.ts";
import {
  durableStepGroupPresentation,
  liveStepGroupPresentation,
} from "./step-group-presentation.ts";

const STEP_LIMIT = 200;

const FOCUSABLE = "a[href], button, [tabindex]";

interface StepEntry {
  readonly key: string;
  readonly message: StepMessage;
  readonly markdown: string;
}

function StepEntryView({
  entry,
  cwd,
  density,
  thinkingOnly,
  titled,
}: {
  entry: StepEntry;
  cwd: string | undefined;
  density: ToolCallDensity;
  thinkingOnly: boolean;
  /** The group header already carries this lone thought's heading. */
  titled: boolean;
}): ReactElement | null {
  const { message } = entry;

  if (isToolMessage(message)) return <ToolCallView message={message} cwd={cwd} density={density} />;
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

  return <ThinkingLine text={entry.markdown} streaming={streaming} />;
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

  const durablePresentation = useMemo(
    () => durableStepGroupPresentation({ messages, durationMs, added, removed, running }),
    [added, durationMs, messages, removed, running],
  );

  const presentation = useMemo(
    () => liveStepGroupPresentation({ durable: durablePresentation, messages }),
    [durablePresentation, messages],
  );

  const { active, summary } = presentation;

  const thinkingOnly = messages.every(isThinkingMessage);

  const entries = useMemo(
    () =>
      messages.reduce<StepEntry[]>((merged, message) => {
        const previous = merged.at(-1);

        if (
          !thinkingOnly &&
          isThinkingMessage(message) &&
          previous !== undefined &&
          isThinkingMessage(previous.message)
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
          markdown: isThinkingMessage(message) ? message.state.markdown : "",
        });

        return merged;
      }, []),
    [messages, thinkingOnly],
  );

  const [open, setOpen] = useStepGroupOpen(first?.id);

  const [showEarlier, setShowEarlier] = useState(false);
  const earlier = showEarlier ? 0 : Math.max(0, entries.length - STEP_LIMIT);
  const [onlyThought] = messages;
  const titled = !active && thinkingOnly && messages.length === 1 && onlyThought !== undefined;

  const hasContent =
    entries.length > 0 &&
    !(
      titled &&
      isThinkingMessage(onlyThought) &&
      reasoningHeading(onlyThought.state.markdown).body.trim() === ""
    );

  const content = stepGroupContent({
    density,
    active,
    open,
    hasContent,
    thinkingOnly,
  });

  const preview = content === "preview";
  const expanded = content === "open";
  const panelId = useId();

  // The preview follows new output. Scrolling away pauses that; ten seconds
  // without another input, or a return to the bottom, resumes it.
  const viewportRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const callsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;

    if (viewport === null || !preview) return undefined;

    let paused = false;
    let held = false;
    let input = Number.NEGATIVE_INFINITY;
    let resumeTimer = 0;

    const clearResume = (): void => {
      if (resumeTimer === 0) return;
      window.clearTimeout(resumeTimer);
      resumeTimer = 0;
    };

    const follow = (): void => {
      clearResume();
      paused = false;
      viewport.scrollTop = viewport.scrollHeight;
    };

    const sync = (): void => {
      viewport.toggleAttribute("data-overflow", overflows(viewport));

      if (!paused) viewport.scrollTop = viewport.scrollHeight;
    };

    const onInput = (): void => {
      input = performance.now();

      if (!paused) return;
      clearResume();
      resumeTimer = window.setTimeout(follow, FOLLOW_RESUME_MS);
    };

    const onPress = (): void => {
      held = true;
    };

    const onRelease = (): void => {
      held = false;
    };

    const onScroll = (): void => {
      const step = followOnScroll(viewport, held || performance.now() - input < FOLLOW_INPUT_MS);

      if (step === undefined) {
        sync();

        return;
      }

      paused = step.paused;
      clearResume();

      if (step.resumeTimer === "arm") resumeTimer = window.setTimeout(follow, FOLLOW_RESUME_MS);
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);

    for (const child of viewport.children) observer.observe(child);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("wheel", onInput, { passive: true });
    viewport.addEventListener("touchmove", onInput, { passive: true });
    viewport.addEventListener("keydown", onInput);
    viewport.addEventListener("pointerdown", onPress);
    window.addEventListener("pointerup", onRelease);
    window.addEventListener("pointercancel", onRelease);

    return () => {
      clearResume();
      observer.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("wheel", onInput);
      viewport.removeEventListener("touchmove", onInput);
      viewport.removeEventListener("keydown", onInput);
      viewport.removeEventListener("pointerdown", onPress);
      window.removeEventListener("pointerup", onRelease);
      window.removeEventListener("pointercancel", onRelease);
    };
  }, [preview]);

  const summaryLine = (
    <>
      <span {...props(stepGroupStyles.verb, active && activityStyles.shimmer)}>{summary.verb}</span>
      {summary.detail !== undefined && (
        <span {...props(stepGroupStyles.summary)}>{summary.detail}</span>
      )}
      {(summary.added > 0 || summary.removed > 0) && (
        <span {...props(stepGroupStyles.stats)}>
          {summary.added > 0 && (
            <span {...props(intent.success, stepGroupStyles.added)}>
              +<AnimatedNumber value={summary.added} />
            </span>
          )}
          {summary.removed > 0 && (
            <span {...props(intent.danger, stepGroupStyles.removed)}>
              -<AnimatedNumber value={summary.removed} />
            </span>
          )}
        </span>
      )}
    </>
  );

  if (!hasContent) {
    return (
      <div aria-busy={active || undefined} {...props(stepGroupStyles.root, stepGroupStyles.status)}>
        {summaryLine}
      </div>
    );
  }

  // The disclosure controls the full list alone. The preview is the group's
  // own window onto live work, so it neither reads as expanded nor closes on
  // the trigger; opening from either state shows the list, and closing the
  // list returns the group to whatever the density shows by default.
  const disclosure = {
    variant: "plain",
    "aria-controls": expanded ? panelId : undefined,
    xstyle: [stepGroupStyles.toggle, focus.ring],
  } as const;

  return (
    <Collapsible.Root
      open={expanded}
      onOpenChange={setOpen}
      aria-busy={active || undefined}
      xstyle={stepGroupStyles.root}
    >
      <Collapsible.Trigger ref={triggerRef} {...disclosure}>
        {summaryLine}
        <Collapsible.Chevron xstyle={stepGroupStyles.chevron} />
      </Collapsible.Trigger>
      {content !== "closed" && (
        <Collapsible.Preview
          id={panelId}
          ref={viewportRef}
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
              />
            ))}
          </div>
        </Collapsible.Preview>
      )}
    </Collapsible.Root>
  );
}
