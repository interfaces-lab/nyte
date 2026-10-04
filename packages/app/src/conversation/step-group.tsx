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
import type { RunId, TurnRun } from "@nyte-ai/protocol";
import { turnPartId } from "@nyte-ai/client";
import { AnimatedNumber } from "../components/animated-number.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Row } from "@nyte-ai/ui/row";
import { focus, srOnly } from "@nyte-ai/ui/a11y.stylex";
import { livePartKey } from "../live.ts";
import type { LiveSnapshot, LiveToolProgress } from "../live.ts";
import type { ToolCallDensity } from "../theme/boot.ts";
import { activityStyles, stepGroupStyles } from "./styles.stylex.ts";
import { ToolCallView } from "./tool-call.tsx";
import { Prose } from "./prose.tsx";
import { ThinkingLine } from "./thinking-line.tsx";
import { reasoningHeading } from "./reasoning-heading.ts";
import type { StepTurnPart } from "./transcript-presentation.ts";
import {
  FOLLOW_INPUT_MS,
  FOLLOW_RESUME_MS,
  followOnScroll,
  overflows,
} from "./step-group-follow.ts";
import { useStepGroupOpen } from "./transcript.tsx";
import { stepGroupContent } from "./step-group-content.ts";
import {
  durableStepGroupPresentation,
  liveStepGroupPresentation,
} from "./step-group-presentation.ts";

const STEP_LIMIT = 200;

const FOCUSABLE = "a[href], button, [tabindex]";

type StepEntry =
  | { readonly key: string; readonly kind: "part"; readonly part: StepTurnPart }
  | { readonly key: string; readonly kind: "live-thinking"; readonly text: string };

function stepEntryKey(part: StepTurnPart): string {
  return part.kind === "tool" ? part.callId : turnPartId(part);
}

type ThinkingPart = Extract<StepTurnPart, { readonly kind: "thinking" }>;

type ThinkingKeyInput =
  | {
      readonly kind: "live";
      readonly runId: RunId;
      readonly attempt: number;
      readonly contentIndex: number;
    }
  | {
      readonly kind: "settled";
      readonly run: TurnRun;
      readonly part: ThinkingPart;
    };

function createThinkingKey(parts: readonly StepTurnPart[]): (input: ThinkingKeyInput) => string {
  const settled = new Map<string, string>();

  for (const part of parts) {
    if (part.kind !== "thinking") continue;
    const key = stepEntryKey(part);
    settled.set(key, key);
  }

  const pending = new Map<
    string,
    {
      readonly runId: RunId;
      readonly attempt: number;
      readonly contentIndex: number;
      readonly key: string;
    }
  >();

  return (input): string => {
    switch (input.kind) {
      case "live": {
        const identity = livePartKey(input.runId, input.attempt, input.contentIndex);
        const key = `thinking:${identity}`;
        pending.set(identity, { ...input, key });

        return key;
      }

      case "settled": {
        const durable = stepEntryKey(input.part);
        const existing = settled.get(durable);

        if (existing !== undefined) return existing;
        let runId: RunId | undefined;

        switch (input.run.kind) {
          case "none":
            runId = undefined;
            break;
          case "run":
            runId = input.run.id;
            break;
          default: {
            const _exhaustive: never = input.run;

            return _exhaustive;
          }
        }

        if (runId === undefined) {
          settled.set(durable, durable);

          return durable;
        }

        const matches = [...pending].filter(
          ([, candidate]) =>
            candidate.runId === runId && candidate.contentIndex === input.part.contentIndex,
        );

        const match = matches.length === 1 ? matches[0] : undefined;

        if (match === undefined) {
          settled.set(durable, durable);

          return durable;
        }

        const [identity, candidate] = match;
        pending.delete(identity);
        settled.set(durable, candidate.key);

        return candidate.key;
      }

      default: {
        const _exhaustive: never = input;

        return _exhaustive;
      }
    }
  };
}

function StepEntryView({
  entry,
  liveTools,
  cwd,
  density,
  thinkingOnly,
  titled,
}: {
  entry: StepEntry;
  liveTools: ReadonlyMap<string, LiveToolProgress>;
  cwd: string | undefined;
  density: ToolCallDensity;
  thinkingOnly: boolean;
  /** The group header already carries this lone thought's heading. */
  titled: boolean;
}): ReactElement | null {
  if (entry.kind === "live-thinking") {
    return thinkingOnly ? (
      <div {...props(stepGroupStyles.thinking)}>
        <span {...props(srOnly)}>Reasoning</span>
        <Prose markdown={entry.text} streaming />
      </div>
    ) : (
      <ThinkingLine text={entry.text} streaming />
    );
  }

  const { part } = entry;

  switch (part.kind) {
    case "thinking":
      return thinkingOnly ? (
        <div {...props(stepGroupStyles.thinking)}>
          <span {...props(srOnly)}>Reasoning</span>
          <Prose markdown={titled ? reasoningHeading(part.text).body : part.text} />
        </div>
      ) : (
        <ThinkingLine text={part.text} streaming={false} />
      );
    case "tool":
      return (
        <ToolCallView
          part={part}
          progress={liveTools.get(part.callId)?.progress}
          cwd={cwd}
          density={density}
        />
      );
    default: {
      const _exhaustive: never = part;

      return _exhaustive;
    }
  }
}

export function StepGroupView({
  parts,
  run,
  live,
  liveTools,
  cwd,
  added,
  removed,
  running,
  density,
}: {
  parts: readonly StepTurnPart[];
  run: TurnRun;
  live?: LiveSnapshot;
  liveTools: ReadonlyMap<string, LiveToolProgress>;
  cwd: string | undefined;
  added: number;
  removed: number;
  running: boolean;
  density: ToolCallDensity;
}): ReactElement {
  const liveOrder = live?.order;
  const liveThoughts = live?.thinking;
  const presentationTools = live?.tools;

  const presentationLive = useMemo(
    () =>
      liveOrder === undefined || presentationTools === undefined
        ? undefined
        : { order: liveOrder, tools: presentationTools },
    [liveOrder, presentationTools],
  );

  const [now] = useState(() => Date.now());
  const firstPart = parts[0];

  const durationMs =
    firstPart === undefined
      ? 0
      : Math.max(0, (running ? now : (parts.at(-1)?.at ?? firstPart.at)) - firstPart.at);

  const durablePresentation = useMemo(
    () => durableStepGroupPresentation({ parts, durationMs, added, removed, running }),
    [added, durationMs, parts, removed, running],
  );

  const presentation = useMemo(
    () =>
      liveStepGroupPresentation({
        durable: durablePresentation,
        live: presentationLive,
      }),
    [durablePresentation, presentationLive],
  );

  const { active, summary } = presentation;

  const [thinkingKey] = useState(() => createThinkingKey(parts));

  const thinkingOnly = parts.every((part) => part.kind === "thinking");

  const liveThinking = useMemo(() => {
    const merged: StepEntry[] = [];
    let adjacent = false;

    for (const ref of liveOrder ?? []) {
      if (ref.kind !== "thinking") {
        adjacent = false;
        continue;
      }

      const liveKey = livePartKey(ref.runId, ref.attempt, ref.index);

      const key = thinkingKey({
        kind: "live",
        runId: ref.runId,
        attempt: ref.attempt,
        contentIndex: ref.index,
      });

      const text = liveThoughts?.get(liveKey) ?? "";

      if (text === "") continue;
      const previous = merged.at(-1);

      if (!thinkingOnly && adjacent && previous?.kind === "live-thinking")
        merged[merged.length - 1] = { ...previous, text: `${previous.text}\n\n${text}` };
      else merged.push({ key, kind: "live-thinking", text });
      adjacent = true;
    }

    return merged;
  }, [liveOrder, liveThoughts, thinkingKey, thinkingOnly]);

  const settledEntries = useMemo(
    () =>
      parts.reduce<StepEntry[]>((merged, part) => {
        const previous = merged.at(-1);

        // Consecutive reasoning between tool calls reads as one thought.
        if (
          !thinkingOnly &&
          part.kind === "thinking" &&
          previous?.kind === "part" &&
          previous.part.kind === "thinking"
        ) {
          merged[merged.length - 1] = {
            ...previous,
            part: { ...previous.part, text: `${previous.part.text}\n\n${part.text}` },
          };

          return merged;
        }

        merged.push({
          key:
            part.kind === "thinking"
              ? thinkingKey({ kind: "settled", run, part })
              : stepEntryKey(part),
          kind: "part",
          part,
        });

        return merged;
      }, []),
    [parts, run, thinkingKey, thinkingOnly],
  );

  const entries = useMemo(
    () => [...settledEntries, ...liveThinking],
    [settledEntries, liveThinking],
  );

  const firstLive = liveOrder?.find((ref) => ref.kind === "thinking");

  const [open, setOpen] = useStepGroupOpen(
    firstPart !== undefined
      ? stepEntryKey(firstPart)
      : firstLive === undefined
        ? undefined
        : `live:${firstLive.runId}:${String(firstLive.index)}`,
    firstPart?.kind === "thinking" && run.kind === "run"
      ? `live:${run.id}:${String(firstPart.contentIndex)}`
      : undefined,
  );

  const [showEarlier, setShowEarlier] = useState(false);
  const earlier = showEarlier ? 0 : Math.max(0, entries.length - STEP_LIMIT);
  const [onlyThought] = parts;
  const titled = !active && thinkingOnly && parts.length === 1 && onlyThought !== undefined;

  const hasContent =
    entries.length > 0 &&
    !(
      titled &&
      onlyThought.kind === "thinking" &&
      reasoningHeading(onlyThought.text).body.trim() === ""
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
        <Row
          id={panelId}
          ref={viewportRef}
          data-nyte-scrollport={preview || undefined}
          data-step-preview={preview || undefined}
          xstyle={[stepGroupStyles.panel, preview && stepGroupStyles.preview]}
        >
          {preview && (
            <Row.Primary tabIndex={-1} aria-hidden xstyle={srOnly} onClick={() => setOpen(true)}>
              Show work details
            </Row.Primary>
          )}
          <div ref={callsRef} {...props(stepGroupStyles.calls)}>
            {expanded && earlier > 0 && (
              <Button
                variant="plain"
                size="sm"
                onClick={() => {
                  flushSync(() => setShowEarlier(true));
                  const first = callsRef.current?.firstElementChild;
                  const step = first?.matches(FOCUSABLE) ? first : first?.querySelector(FOCUSABLE);
                  (step instanceof HTMLElement ? step : triggerRef.current)?.focus();
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
                liveTools={liveTools}
                cwd={cwd}
                density={density}
                thinkingOnly={thinkingOnly}
                titled={titled}
              />
            ))}
          </div>
        </Row>
      )}
    </Collapsible.Root>
  );
}
