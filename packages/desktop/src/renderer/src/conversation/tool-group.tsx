/**
 * Intermediate narration, reasoning, and tool calls form one work episode.
 * Compact mode keeps the episode in a clipped window
 * that follows new output; opening the group reveals the full list. The
 * final assistant response remains outside this component.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/ui/src/work-group.tsx
 */
import * as stylex from "@stylexjs/stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { turnPartId } from "@nyte-ai/core/views";
import { AnimatedNumber } from "../components/animated-number.tsx";
import { Icon } from "../components/icons.tsx";
import { focus, srOnly } from "../components/ui.tsx";
import { Spinner } from "../components/spinner.tsx";
import { livePartKey } from "../live.ts";
import type { LiveSnapshot, LiveToolProgress } from "../live.ts";
import type { ToolCallDensity } from "../theme/boot.ts";
import { toolGroupStyles } from "./styles.stylex.ts";
import { ToolCallView } from "./tool-call.tsx";
import { Prose } from "./prose.tsx";
import type { WorkTurnPart } from "./transcript-presentation.ts";
import { FOLLOW_RESUME_MS, followOnScroll, overflows } from "./tool-group-follow.ts";
import { WorkGroupWindow, opensWorkGroup, workGroupScrollport } from "./work-group-window.tsx";
import { workGroupBody } from "./work-group-body.ts";
import { createWorkGroupEntries } from "./work-group-entries.ts";
import { createWorkGroupPresentation } from "./work-group-presentation.ts";
import type { WorkGroupReveal } from "./work-group-body.ts";

/** One row of the episode, keyed by core's part identity so rows never remount as output settles. */
type WorkEntry =
  | { readonly key: string; readonly kind: "part"; readonly part: WorkTurnPart }
  | { readonly key: string; readonly kind: "live-thinking"; readonly text: string };

function workEntryKey(part: WorkTurnPart): string {
  return part.kind === "tool" ? part.callId : turnPartId(part);
}

function WorkEntryView({
  entry,
  liveTools,
  cwd,
  active,
  density,
}: {
  entry: WorkEntry;
  liveTools: ReadonlyMap<string, LiveToolProgress>;
  cwd: string | undefined;
  active: boolean;
  density: ToolCallDensity;
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
    case "assistant":
      return (
        <div {...stylex.props(toolGroupStyles.commentary)}>
          <Prose markdown={part.text} />
        </div>
      );
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
        />
      );
    default: {
      const _exhaustive: never = part;
      return _exhaustive;
    }
  }
}

/** Silence this long with nothing streaming reads as stuck, so the label says so. */
const STALE_AFTER_MS = 15_000;

export function WorkGroupView({
  parts,
  live,
  liveTools,
  cwd,
  durationMs,
  running,
  density,
}: {
  parts: readonly WorkTurnPart[];
  live?: LiveSnapshot;
  liveTools: ReadonlyMap<string, LiveToolProgress>;
  cwd: string | undefined;
  durationMs: number;
  running: boolean;
  density: ToolCallDensity;
}): ReactElement {
  const [projectWork] = useState(createWorkGroupPresentation);
  // The timer marks the frame it saw; any newer live frame makes that mark stale.
  const [staleFrame, setStaleFrame] = useState<LiveSnapshot | undefined>();
  const stale = live !== undefined && staleFrame === live;
  const { active, summary } = projectWork({
    parts,
    liveTools,
    cwd,
    durationMs,
    running,
    live,
    stale,
  });
  useEffect(() => {
    if (!active || live === undefined) return undefined;
    const timer = window.setTimeout(() => setStaleFrame(live), STALE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [active, live]);
  const [joinEntries] = useState(() => createWorkGroupEntries<WorkEntry>());
  const settledEntries = useMemo(
    () => parts.map((part): WorkEntry => ({ key: workEntryKey(part), kind: "part", part })),
    [parts],
  );
  const liveThinking =
    live?.order.flatMap((ref): WorkEntry[] => {
      if (ref.kind !== "thinking") return [];
      const key = livePartKey(ref.runId, ref.attempt, ref.index);
      const text = live.thinking.get(key) ?? "";
      return text === "" ? [] : [{ key: `live-thinking:${key}`, kind: "live-thinking", text }];
    }) ?? [];
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
  const openedWindow = reveal === "open" && density === "compact" && active;

  // The preview follows new output. Scrolling away or opening the full list
  // pauses that; ten seconds without another input returns to the window.
  const viewportRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null || (!preview && !openedWindow)) return undefined;

    let paused = false;
    let resumeTimer = 0;
    const clearResume = (): void => {
      if (resumeTimer === 0) return;
      window.clearTimeout(resumeTimer);
      resumeTimer = 0;
    };
    const follow = (): void => {
      paused = false;
      viewport.scrollTop = viewport.scrollHeight;
    };
    const resume = (): void => {
      clearResume();
      if (openedWindow) {
        setReveal("default");
        return;
      }
      follow();
    };
    const arm = (): void => {
      clearResume();
      resumeTimer = window.setTimeout(resume, FOLLOW_RESUME_MS);
    };
    const sync = (): void => {
      viewport.toggleAttribute("data-overflow", overflows(viewport));
      if (preview && !paused) viewport.scrollTop = viewport.scrollHeight;
    };
    const onScroll = (): void => {
      const step = followOnScroll(openedWindow ? "opened" : "preview", paused, viewport);
      paused = step.paused;
      if (step.resumeTimer === "arm") arm();
      else clearResume();
    };

    const scrollport = openedWindow ? workGroupScrollport(viewport) : viewport;
    if (openedWindow) {
      arm();
      scrollport.addEventListener("pointerdown", arm);
      scrollport.addEventListener("keydown", arm);
      scrollport.addEventListener("wheel", arm, { passive: true });
    }
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    for (const child of viewport.children) observer.observe(child);
    scrollport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearResume();
      observer.disconnect();
      scrollport.removeEventListener("scroll", onScroll);
      scrollport.removeEventListener("pointerdown", arm);
      scrollport.removeEventListener("keydown", arm);
      scrollport.removeEventListener("wheel", arm);
    };
  }, [openedWindow, preview]);

  const summaryLine = (
    <>
      {active && <Spinner />}
      <span {...stylex.props(toolGroupStyles.verb)}>{summary.verb}</span>
      {summary.detail !== undefined && (
        <span {...stylex.props(toolGroupStyles.summary)}>{summary.detail}</span>
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
    return (
      <div
        aria-busy={active || undefined}
        {...stylex.props(toolGroupStyles.root, toolGroupStyles.status)}
      >
        {summaryLine}
      </div>
    );
  }

  return (
    <Collapsible.Root
      open={body !== "none"}
      onOpenChange={() => setReveal(body === "list" ? "closed" : "open")}
      aria-busy={active || undefined}
      {...stylex.props(toolGroupStyles.root)}
    >
      <Collapsible.Trigger {...stylex.props(toolGroupStyles.toggle, focus.ring)}>
        {summaryLine}
        <span
          {...stylex.props(toolGroupStyles.chevron, body === "list" && toolGroupStyles.chevronOpen)}
        >
          <Icon name="chevron-right" size={11} />
        </span>
      </Collapsible.Trigger>
      <Collapsible.Panel
        ref={viewportRef}
        data-nyte-scrollport={preview || undefined}
        onClick={
          preview
            ? (event) => {
                if (opensWorkGroup(event.target, window.getSelection()?.toString() ?? ""))
                  setReveal("open");
              }
            : undefined
        }
        {...stylex.props(preview && toolGroupStyles.preview)}
      >
        <div {...stylex.props(toolGroupStyles.calls)}>
          <WorkGroupWindow
            groupKey={groupKey}
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
              />
            )}
          />
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
