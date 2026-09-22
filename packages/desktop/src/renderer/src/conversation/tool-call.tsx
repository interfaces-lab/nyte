/**
 * One tool call: a quiet verb line that expands into its evidence. Ported from
 * the Honk design system's `tool-call.tsx` and recolored onto this palette.
 * Its locked law carries over: no status icons on tool calls. The running
 * state is the shimmer, failure is the red line, and the chevron is a
 * control, not a status. Neither shimmer nor red line survives a screen
 * reader or a colour-blind eye, so the same two states also ship as
 * visually hidden text.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/ui/src/tool-call.tsx
 */
import * as stylex from "@stylexjs/stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import { parsePatchFacts } from "@nyte-ai/client";
import type { ToolClass, ToolProgress, ToolTurnPart } from "@nyte-ai/protocol";
import { Icon } from "../components/icons.tsx";
import { focus, Hint, srOnly } from "../components/ui.tsx";
import type { ToolCallDensity } from "../theme/boot.ts";
import { DiffView } from "./diff-view.tsx";
import type { DiffFacts } from "./diff-view.tsx";
import { activityStyles, toolCallStyles } from "./styles.stylex.ts";
import { SubagentCallView, SubagentLineView } from "./subagent-call.tsx";
import { toolVerb } from "./tool-copy.ts";
import { toolPhase } from "./transcript-presentation.ts";
import type { LiveWaits } from "./transcript-presentation.ts";

function tidyPath(path: string, cwd: string | undefined): string {
  if (cwd !== undefined && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  return path;
}

function basename(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

interface ToolDetail {
  readonly text: string;
  readonly title?: string;
}

function toolDetail(toolClass: ToolClass, cwd: string | undefined): ToolDetail | undefined {
  switch (toolClass.kind) {
    case "file_edit":
    case "file_write":
    case "file_patch": {
      const title = tidyPath(toolClass.path, cwd);
      return { text: basename(title), title };
    }
    case "file_read":
    case "list":
      return { text: tidyPath(toolClass.path, cwd) };
    case "shell":
      return { text: toolClass.command };
    case "delegate":
    case "custom":
      return undefined;
    default: {
      const _exhaustive: never = toolClass;
      return _exhaustive;
    }
  }
}

type ToolBody =
  | { readonly kind: "none" }
  | { readonly kind: "output"; readonly text: string }
  | { readonly kind: "diff"; readonly path: string; readonly diff: DiffFacts };

// A second trigger: only rendered while closed, so pressing it always opens.
function OutputPreview({ text }: { text: string }): ReactElement {
  const rootRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const content = textRef.current;
    if (root === null || content === null) return undefined;
    const sync = (): void => {
      root.toggleAttribute("data-overflow", content.scrollHeight > root.clientHeight);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(root);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <Collapsible.Trigger
      ref={rootRef}
      aria-label="Show full output"
      {...stylex.props(toolCallStyles.outputPreview, focus.ring)}
    >
      <span ref={textRef} {...stylex.props(toolCallStyles.outputPreviewText)}>
        {text}
      </span>
    </Collapsible.Trigger>
  );
}

/**
 * Open state lives in Base UI, not here: a controlled `open` would re-render
 * this component (and re-parse the patch) on every toggle. The chevron and
 * preview read `state.open` through `render` instead.
 */
export const ToolCallView = memo(function ToolCallView({
  part,
  progress,
  cwd,
  active,
  density,
  waits,
}: {
  part: ToolTurnPart;
  progress: ToolProgress | undefined;
  cwd: string | undefined;
  active: boolean;
  density: ToolCallDensity;
  /** The run's live waits on its children; only the trailing turn has any. */
  waits?: LiveWaits;
}): ReactElement {
  const phase = toolPhase(part, active);
  // Hunks are parsed once per part; the counts beside them are the class's own.
  const facts = useMemo(
    () => (part.class.kind === "file_patch" ? parsePatchFacts(part.class.patch) : undefined),
    [part],
  );
  const { class: toolClass, result } = part;
  const text = result === undefined ? (progress?.text ?? "") : result.output;
  const body: ToolBody =
    toolClass.kind === "file_patch" && facts !== undefined
      ? {
          kind: "diff",
          path: tidyPath(toolClass.path, cwd),
          diff: { patch: facts.patch, added: toolClass.added, removed: toolClass.removed },
        }
      : text.trim() === ""
        ? { kind: "none" }
        : { kind: "output", text };
  // One card per child: its create. Every other call on it is a line.
  if (toolClass.kind === "delegate") {
    return toolClass.role === "create" ? (
      <SubagentCallView
        session={toolClass.target.session}
        title={toolClass.title}
        phase={phase}
        density={density}
        awaited={waits?.awaited.has(toolClass.target.session) ?? false}
      />
    ) : (
      <SubagentLineView
        toolClass={toolClass}
        phase={phase}
        density={density}
        until={waits?.deadlines.get(part.callId)}
      />
    );
  }
  const verb = toolVerb(toolClass, phase);
  const detail = toolDetail(toolClass, cwd);
  const expandable = body.kind !== "none";
  const editDiff = body.kind === "diff";
  const lineContent = (
    <>
      <span {...stylex.props(toolCallStyles.verb, phase === "running" && activityStyles.shimmer)}>
        {verb}
      </span>
      {/* A custom label is a name, not a verb; the phase words already say failed or stopped. */}
      {phase === "running" && toolClass.kind === "custom" && (
        <span {...stylex.props(srOnly)}>Running</span>
      )}
      {detail !== undefined && (
        <Hint
          content={detail.title ?? detail.text}
          trigger={<span {...stylex.props(toolCallStyles.detail)}>{detail.text}</span>}
        />
      )}
      {toolClass.kind === "file_patch" && (toolClass.added > 0 || toolClass.removed > 0) && (
        <span {...stylex.props(toolCallStyles.stats, editDiff && toolCallStyles.editStats)}>
          {toolClass.added > 0 && (
            <span {...stylex.props(toolCallStyles.added)}>+{toolClass.added}</span>
          )}
          {toolClass.removed > 0 && (
            <span {...stylex.props(toolCallStyles.removed)}>-{toolClass.removed}</span>
          )}
        </span>
      )}
    </>
  );

  const line = expandable ? (
    <Collapsible.Trigger
      data-tool-status={phase}
      {...stylex.props(
        toolCallStyles.line,
        editDiff && toolCallStyles.editLine,
        density === "detailed" && toolCallStyles.lineDetailed,
        focus.ring,
        phase === "failed" && toolCallStyles.failed,
      )}
      render={(props, state) => (
        <button {...props}>
          {lineContent}
          <span {...stylex.props(toolCallStyles.chevron, state.open && toolCallStyles.chevronOpen)}>
            <Icon name="chevron-right" size={12} />
          </span>
        </button>
      )}
    />
  ) : (
    <div
      data-tool-status={phase}
      {...stylex.props(
        toolCallStyles.line,
        density === "detailed" && toolCallStyles.lineDetailed,
        toolCallStyles.lineStatic,
        phase === "failed" && toolCallStyles.failed,
      )}
    >
      {lineContent}
    </div>
  );

  return (
    <Collapsible.Root
      disabled={!expandable}
      {...stylex.props(toolCallStyles.root)}
      render={(props, state) => (
        <div {...props}>
          {line}
          {body.kind === "output" && !state.open && <OutputPreview text={body.text} />}
          {body.kind === "output" && (
            <Collapsible.Panel
              role="region"
              aria-label="Tool output"
              data-nyte-scrollport
              data-tool-body
              {...stylex.props(toolCallStyles.output)}
            >
              {body.text}
            </Collapsible.Panel>
          )}
          {body.kind === "diff" && (
            <Collapsible.Panel keepMounted data-tool-body>
              <DiffView path={body.path} diff={body.diff} variant="inline" />
            </Collapsible.Panel>
          )}
        </div>
      )}
    />
  );
});
