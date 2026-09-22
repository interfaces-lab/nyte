/**
 * Intermediate narration, reasoning, and tool calls form one work episode.
 * Compact mode keeps the episode in a clipped window
 * that follows new output; opening the group reveals the full list. The
 * final assistant response remains outside this component.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/ui/src/work-group.tsx
 */
import * as stylex from "@stylexjs/stylex";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { RunId, TurnRun } from "@nyte-ai/protocol";
import { turnPartId } from "@nyte-ai/client";
import { AnimatedNumber } from "../components/animated-number.tsx";
import { Icon } from "../components/icons.tsx";
import { focus, srOnly } from "../components/ui.tsx";
import { Spinner } from "../components/spinner.tsx";
import { livePartKey } from "../live.ts";
import type { LiveSnapshot, LiveToolProgress } from "../live.ts";
import type { ToolCallDensity } from "../theme/boot.ts";
import { toolGroupStyles } from "./styles.stylex.ts";
import { useOpenSubagentTray } from "./subagent-sessions.ts";
import { ToolCallView } from "./tool-call.tsx";
import { Countdown } from "./countdown.tsx";
import { Prose } from "./prose.tsx";
import { NO_WAITS } from "./transcript-presentation.ts";
import type { LiveWaits, WorkTurnPart } from "./transcript-presentation.ts";
import { FOLLOW_RESUME_MS, followOnScroll, overflows } from "./tool-group-follow.ts";
import { WorkGroupWindow, opensWorkGroup } from "./work-group-window.tsx";
import { workGroupBody } from "./work-group-body.ts";
import { createWorkGroupEntries } from "./work-group-entries.ts";
import {
  durableWorkGroupPresentation,
  liveWorkGroupPresentation,
} from "./work-group-presentation.ts";
import type { WorkGroupReveal } from "./work-group-body.ts";

type WorkEntry =
  | { readonly key: string; readonly kind: "part"; readonly part: WorkTurnPart }
  | { readonly key: string; readonly kind: "live-thinking"; readonly text: string };

function workEntryKey(part: WorkTurnPart): string {
  return part.kind === "tool" ? part.callId : turnPartId(part);
}

type ThinkingPart = Extract<WorkTurnPart, { readonly kind: "thinking" }>;

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

function createThinkingKey(parts: readonly WorkTurnPart[]): (input: ThinkingKeyInput) => string {
  const settled = new Map<string, string>();

  for (const part of parts) {
    if (part.kind !== "thinking") continue;
    const key = workEntryKey(part);
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
        const durable = workEntryKey(input.part);
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

function WorkEntryView({
  entry,
  liveTools,
  cwd,
  active,
  density,
  waits,
}: {
  entry: WorkEntry;
  liveTools: ReadonlyMap<string, LiveToolProgress>;
  cwd: string | undefined;
  active: boolean;
  density: ToolCallDensity;
  waits: LiveWaits | undefined;
}): ReactElement {
  if (entry.kind === "live-thinking") {
    return (
      <div {...stylex.props(toolGroupStyles.thinking)}>
        <span {...stylex.props(srOnly)}>Reasoning</span>
        <Prose markdown={entry.text} streaming />
      </div>
    );
  }

  const { part } = entry;

  switch (part.kind) {
    case "thinking":
      return (
        <div {...stylex.props(toolGroupStyles.thinking)}>
          <span {...stylex.props(srOnly)}>Reasoning</span>
          <Prose markdown={part.text} />
        </div>
      );
    case "tool":
      return (
        <ToolCallView
          part={part}
          progress={liveTools.get(part.callId)?.progress}
          cwd={cwd}
          active={active}
          density={density}
          waits={waits}
        />
      );
    default: {
      const _exhaustive: never = part;

      return _exhaustive;
    }
  }
}

export function WorkGroupView({
  parts,
  run,
  live,
  liveTools,
  cwd,
  added,
  removed,
  running,
  density,
  waits,
}: {
  parts: readonly WorkTurnPart[];
  run: TurnRun;
  live?: LiveSnapshot;
  liveTools: ReadonlyMap<string, LiveToolProgress>;
  cwd: string | undefined;
  added: number;
  removed: number;
  running: boolean;
  density: ToolCallDensity;
  /** The trailing group carries the run's live waits on its children. */
  waits?: LiveWaits;
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

  const awaited = waits?.awaited ?? NO_WAITS.awaited;
  const [now] = useState(() => Date.now());
  const firstPart = parts[0];

  const durationMs =
    firstPart === undefined
      ? 0
      : Math.max(0, (running ? now : (parts.at(-1)?.at ?? firstPart.at)) - firstPart.at);

  const durablePresentation = useMemo(
    () => durableWorkGroupPresentation({ parts, durationMs, added, removed, running }),
    [added, durationMs, parts, removed, running],
  );

  const presentation = useMemo(
    () =>
      liveWorkGroupPresentation({
        durable: durablePresentation,
        live: presentationLive,
        awaited,
      }),
    [awaited, durablePresentation, presentationLive],
  );

  const { active, summary } = presentation;
  const waitingSessions = presentation.active ? presentation.waiting : [];
  const openSubagentTray = useOpenSubagentTray();

  const openWaitingTray =
    openSubagentTray === undefined || waitingSessions.length === 0
      ? undefined
      : (): void => openSubagentTray(waitingSessions.length === 1 ? waitingSessions[0] : undefined);

  const [joinEntries] = useState(() => createWorkGroupEntries<WorkEntry>());
  const [thinkingKey] = useState(() => createThinkingKey(parts));

  const liveThinking = useMemo(
    () =>
      liveOrder?.flatMap((ref): WorkEntry[] => {
        if (ref.kind !== "thinking") return [];
        const liveKey = livePartKey(ref.runId, ref.attempt, ref.index);

        const key = thinkingKey({
          kind: "live",
          runId: ref.runId,
          attempt: ref.attempt,
          contentIndex: ref.index,
        });

        const text = liveThoughts?.get(liveKey) ?? "";

        return text === "" ? [] : [{ key, kind: "live-thinking", text }];
      }) ?? [],
    [liveOrder, liveThoughts, thinkingKey],
  );

  const settledEntries = useMemo(
    () =>
      parts.map((part): WorkEntry => ({
        key:
          part.kind === "thinking"
            ? thinkingKey({ kind: "settled", run, part })
            : workEntryKey(part),
        kind: "part",
        part,
      })),
    [parts, run, thinkingKey],
  );

  const entries = joinEntries(settledEntries, liveThinking);
  // The first settled part names the group; later parts append after it.
  const first = parts[0];
  const groupKey = first === undefined ? undefined : workEntryKey(first);
  const [reveal, setReveal] = useState<WorkGroupReveal>("default");
  const hasContent = entries.count > 0;

  const body = workGroupBody({
    density,
    active,
    reveal,
    hasContent,
  });

  const preview = body === "preview";
  const listed = body === "list";
  const panelId = useId();

  // The preview follows new output. Scrolling away pauses that; ten seconds
  // without another input, or a return to the bottom, resumes it.
  const viewportRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;

    if (viewport === null || !preview) return undefined;

    let paused = false;
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

    const onScroll = (): void => {
      const step = followOnScroll(viewport);
      paused = step.paused;
      clearResume();

      if (step.resumeTimer === "arm") resumeTimer = window.setTimeout(follow, FOLLOW_RESUME_MS);
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);

    for (const child of viewport.children) observer.observe(child);
    viewport.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      clearResume();
      observer.disconnect();
      viewport.removeEventListener("scroll", onScroll);
    };
  }, [preview]);

  const summaryLine = (
    <>
      {active && <Spinner />}
      <span {...stylex.props(toolGroupStyles.verb)}>{summary.verb}</span>
      {summary.detail !== undefined && (
        <span {...stylex.props(toolGroupStyles.summary)}>{summary.detail}</span>
      )}
      {active && waits?.until !== undefined && (
        <span {...stylex.props(toolGroupStyles.summary)}>
          <Countdown until={waits.until} />
        </span>
      )}
      {(summary.added > 0 || summary.removed > 0) && (
        <span {...stylex.props(toolGroupStyles.stats)}>
          {summary.added > 0 && (
            <span {...stylex.props(toolGroupStyles.added)}>
              +<AnimatedNumber value={summary.added} />
            </span>
          )}
          {summary.removed > 0 && (
            <span {...stylex.props(toolGroupStyles.removed)}>
              -<AnimatedNumber value={summary.removed} />
            </span>
          )}
        </span>
      )}
    </>
  );

  if (!hasContent) {
    return openWaitingTray === undefined ? (
      <div
        aria-busy={active || undefined}
        {...stylex.props(toolGroupStyles.root, toolGroupStyles.status)}
      >
        {summaryLine}
      </div>
    ) : (
      <div aria-busy={active || undefined} {...stylex.props(toolGroupStyles.root)}>
        <button
          type="button"
          {...stylex.props(toolGroupStyles.toggle, focus.ring)}
          onClick={openWaitingTray}
        >
          {summaryLine}
        </button>
      </div>
    );
  }

  // The disclosure controls the full list alone. The preview is the group's
  // own window onto live work, so it neither reads as expanded nor closes on
  // the trigger; opening from either state shows the list, and closing the
  // list returns the group to whatever the density shows by default.
  const toggleList = (): void => setReveal(listed ? "closed" : "open");

  const chevron = (
    <span {...stylex.props(toolGroupStyles.chevron, listed && toolGroupStyles.chevronOpen)}>
      <Icon name="chevron-right" size={11} />
    </span>
  );

  const disclosure = {
    "aria-expanded": listed,
    "aria-controls": listed ? panelId : undefined,
    onClick: toggleList,
  };

  return (
    <div aria-busy={active || undefined} {...stylex.props(toolGroupStyles.root)}>
      {openWaitingTray === undefined ? (
        <button type="button" {...disclosure} {...stylex.props(toolGroupStyles.toggle, focus.ring)}>
          {summaryLine}
          {chevron}
        </button>
      ) : (
        <div {...stylex.props(toolGroupStyles.status)}>
          <button
            type="button"
            {...stylex.props(toolGroupStyles.toggle, focus.ring)}
            onClick={openWaitingTray}
          >
            {summaryLine}
          </button>
          <button
            type="button"
            aria-label={listed ? "Hide work details" : "Show work details"}
            {...disclosure}
            {...stylex.props(toolGroupStyles.toggle, focus.ring)}
          >
            {chevron}
          </button>
        </div>
      )}
      {body !== "none" && (
        <div
          id={panelId}
          ref={viewportRef}
          data-nyte-scrollport={preview || undefined}
          onClick={
            preview
              ? (event) => {
                  if (opensWorkGroup(event.target, window.getSelection(), event.currentTarget))
                    setReveal("open");
                }
              : undefined
          }
          {...stylex.props(preview && toolGroupStyles.preview)}
        >
          <div {...stylex.props(toolGroupStyles.calls)}>
            <WorkGroupWindow
              groupKey={groupKey}
              density={density}
              entries={entries}
              viewportRef={viewportRef}
              preview={preview}
              renderEntry={(entry) => (
                <WorkEntryView
                  entry={entry}
                  liveTools={liveTools}
                  cwd={cwd}
                  active={active}
                  density={density}
                  waits={waits}
                />
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
}
