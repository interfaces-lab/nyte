/**
 * Cursor's transcript treats intermediate narration, reasoning, and tool
 * calls as one work episode. Compact keeps the episode in a clipped window
 * that follows new output; opening the group reveals the full list. The
 * final assistant response remains outside this component.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/ui/src/work-group.tsx
 */
import * as stylex from "@stylexjs/stylex";
import { Collapsible } from "@nyte-ai/ui/primitives";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { ToolTurnPart } from "@nyte-ai/core";
import { turnPartId } from "@nyte-ai/core/views";
import { Icon } from "../components/icons.tsx";
import { focus, srOnly } from "../components/ui.tsx";
import { Spinner } from "../components/spinner.tsx";
import { livePartKey } from "../live.ts";
import type { LiveSnapshot, LiveToolProgress } from "../live.ts";
import type { ToolCallDensity } from "../theme/boot.ts";
import { toolGroupStyles } from "./styles.stylex.ts";
import { ToolCallView } from "./tool-call.tsx";
import { Prose } from "./prose.tsx";
import { presentTool } from "./tool-detail.ts";
import type { ToolPresentation } from "./tool-detail.ts";
import { formatRunDuration } from "./transcript-presentation.ts";
import type { WorkTurnPart } from "./transcript-presentation.ts";
import { isAtScrollBottom, workGroupBody, type WorkGroupReveal } from "./work-group-body.ts";

interface PresentedTool {
  readonly part: ToolTurnPart;
  readonly presentation: ToolPresentation;
}

interface WorkSummary {
  readonly verb: string;
  readonly detail: string | undefined;
  readonly added: number;
  readonly removed: number;
}

function quantity(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

function oneDetailOrCount(
  tools: readonly PresentedTool[],
  singular: string,
  plural = `${singular}s`,
): string {
  const only = tools.length === 1 ? tools[0] : undefined;
  return only?.presentation.detail ?? quantity(tools.length, singular, plural);
}

function summarizeWork(
  tools: readonly PresentedTool[],
  duration: string | undefined,
  running: boolean,
  failed: boolean,
): WorkSummary {
  const added = tools.reduce((total, item) => total + (item.presentation.added ?? 0), 0);
  const removed = tools.reduce((total, item) => total + (item.presentation.removed ?? 0), 0);
  if (running) return { verb: "Working", detail: undefined, added, removed };
  if (failed) return { verb: "Work failed", detail: undefined, added, removed };
  if (tools.length === 0) {
    return {
      verb: "Worked",
      detail: duration === undefined ? undefined : `for ${duration}`,
      added,
      removed,
    };
  }

  const edits = tools.filter(({ part }) => part.toolName === "edit" || part.toolName === "write");
  const commands = tools.filter(({ part }) => part.toolName === "bash");
  const reads = tools.filter(({ part }) => part.toolName === "read");
  const listings = tools.filter(({ part }) => part.toolName === "ls");

  if (edits.length > 0) {
    const edited = oneDetailOrCount(edits, "file");
    const ran = commands.length > 0 ? `, ran ${quantity(commands.length, "command")}` : "";
    return { verb: "Edited", detail: `${edited}${ran}`, added, removed };
  }
  if (commands.length > 0) {
    return {
      verb: "Ran",
      detail: oneDetailOrCount(commands, "command"),
      added,
      removed,
    };
  }
  if (reads.length > 0) {
    return { verb: "Read", detail: oneDetailOrCount(reads, "file"), added, removed };
  }
  if (listings.length > 0) {
    return {
      verb: "Listed",
      detail: oneDetailOrCount(listings, "directory", "directories"),
      added,
      removed,
    };
  }

  const first = tools[0]?.presentation;
  return tools.length === 1 && first !== undefined
    ? { verb: first.verb, detail: first.detail, added, removed }
    : { verb: "Worked", detail: quantity(tools.length, "action"), added, removed };
}

function WorkEntries({
  parts,
  live,
  liveTools,
  cwd,
  density,
  dim,
}: {
  parts: readonly WorkTurnPart[];
  live: LiveSnapshot | undefined;
  liveTools: ReadonlyMap<string, LiveToolProgress>;
  cwd: string | undefined;
  density: ToolCallDensity;
  dim: boolean;
}): ReactElement {
  return (
    <>
      {parts.map((part) => {
        switch (part.kind) {
          case "assistant":
            return (
              <div
                key={turnPartId(part)}
                {...stylex.props(toolGroupStyles.commentary, dim && toolGroupStyles.commentaryDim)}
              >
                <Prose markdown={part.text} />
              </div>
            );
          case "thinking":
            return (
              <div key={turnPartId(part)} {...stylex.props(toolGroupStyles.thinking)}>
                <span {...stylex.props(srOnly)}>Reasoning</span>
                <Prose markdown={part.text} />
              </div>
            );
          case "tool":
            return (
              <ToolCallView
                key={part.callId}
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
      })}
      {live?.order.map((ref) => {
        if (ref.kind !== "thinking") return null;
        const key = livePartKey(ref.runId, ref.attempt, ref.index);
        const text = live.thinking.get(key) ?? "";
        return text === "" ? null : (
          <div key={`live-thinking:${key}`} {...stylex.props(toolGroupStyles.thinking)}>
            <span {...stylex.props(srOnly)}>Reasoning</span>
            <Prose markdown={text} streaming />
          </div>
        );
      })}
    </>
  );
}

function WorkPreview({
  children,
  onExpand,
}: {
  children: ReactNode;
  onExpand: () => void;
}): ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return undefined;

    const sync = (): void => {
      setOverflow(viewport.scrollHeight > viewport.clientHeight);
      if (!paused.current) viewport.scrollTop = viewport.scrollHeight;
    };
    const onScroll = (): void => {
      paused.current = !isAtScrollBottom({
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
      });
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    for (const child of viewport.children) observer.observe(child);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div
      ref={viewportRef}
      data-nyte-scrollport
      onClick={onExpand}
      {...stylex.props(toolGroupStyles.preview, overflow && toolGroupStyles.previewFade)}
    >
      <div {...stylex.props(toolGroupStyles.calls, toolGroupStyles.previewCalls)}>{children}</div>
    </div>
  );
}

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
  const duration = formatRunDuration(durationMs);
  const tools = parts.flatMap((part): ToolTurnPart[] => (part.kind === "tool" ? [part] : []));
  const presented = tools.map((part): PresentedTool => ({
    part,
    presentation: presentTool(part, liveTools.get(part.callId)?.progress, cwd),
  }));
  const active = running || presented.some(({ presentation }) => presentation.state === "running");
  const [reveal, setReveal] = useState<WorkGroupReveal>("default");
  const hasContent =
    parts.length > 0 ||
    (live !== undefined &&
      live.order.some((ref) => {
        if (ref.kind !== "thinking") return false;
        return (live.thinking.get(livePartKey(ref.runId, ref.attempt, ref.index)) ?? "") !== "";
      }));
  const body = workGroupBody({ density, active, reveal, hasContent });
  const failed = presented.some(({ presentation }) => presentation.state === "failed");
  const summary = summarizeWork(presented, duration, active, failed);
  const entries = (
    <WorkEntries
      parts={parts}
      live={live}
      liveTools={liveTools}
      cwd={cwd}
      density={density}
      dim={body === "preview"}
    />
  );

  return (
    <Collapsible.Root
      open={body === "list"}
      onOpenChange={(open) => setReveal(open ? "open" : "closed")}
      aria-busy={active || undefined}
      {...stylex.props(toolGroupStyles.root)}
    >
      <Collapsible.Trigger
        {...stylex.props(toolGroupStyles.toggle, focus.ring, failed && toolGroupStyles.failed)}
      >
        {active && <Spinner />}
        <span {...stylex.props(toolGroupStyles.verb)}>{summary.verb}</span>
        {summary.detail !== undefined && (
          <span {...stylex.props(toolGroupStyles.summary)}>{summary.detail}</span>
        )}
        {(summary.added > 0 || summary.removed > 0) && (
          <span {...stylex.props(toolGroupStyles.stats)}>
            {summary.added > 0 && (
              <span {...stylex.props(toolGroupStyles.added)}>+{summary.added}</span>
            )}
            {summary.removed > 0 && (
              <span {...stylex.props(toolGroupStyles.removed)}>-{summary.removed}</span>
            )}
          </span>
        )}
        <span
          {...stylex.props(toolGroupStyles.chevron, body === "list" && toolGroupStyles.chevronOpen)}
        >
          <Icon name="chevron-right" size={11} />
        </span>
      </Collapsible.Trigger>
      {body === "preview" && (
        <WorkPreview onExpand={() => setReveal("open")}>{entries}</WorkPreview>
      )}
      {body === "list" && (
        <Collapsible.Panel {...stylex.props(toolGroupStyles.calls)}>{entries}</Collapsible.Panel>
      )}
    </Collapsible.Root>
  );
}
