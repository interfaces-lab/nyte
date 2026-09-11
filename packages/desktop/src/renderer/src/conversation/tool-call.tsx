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
import { memo, useLayoutEffect, useRef } from "react";
import type { ReactElement } from "react";
import type { ToolProgress, ToolTurnPart } from "@nyte-ai/core";
import { Icon } from "../components/icons.tsx";
import { focus, srOnly } from "../components/ui.tsx";
import type { ToolCallDensity } from "../theme/boot.ts";
import { DiffView } from "./diff-view.tsx";
import { activityStyles, toolCallStyles } from "./styles.stylex.ts";
import { SubagentCallView } from "./subagent-call.tsx";
import { presentTool, subagentCall } from "./tool-detail.ts";

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
      aria-label="Show full command output"
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
  density = "compact",
}: {
  part: ToolTurnPart;
  progress: ToolProgress | undefined;
  cwd: string | undefined;
  density?: ToolCallDensity;
}): ReactElement {
  const presentation = presentTool(part, progress, cwd);
  const subagent = subagentCall(part, progress);
  if (subagent !== undefined) {
    return <SubagentCallView call={subagent} presentation={presentation} density={density} />;
  }
  const expandable = presentation.body.kind !== "none";
  const editDiff = presentation.body.kind === "diff";
  const running = presentation.state === "running";
  const lineContent = (
    <>
      <span {...stylex.props(toolCallStyles.verb, running && activityStyles.shimmer)}>
        {presentation.verb}
      </span>
      {presentation.state !== "done" && (
        <span {...stylex.props(srOnly)}>
          {presentation.state === "failed" ? "Failed" : "Running"}
        </span>
      )}
      {presentation.detail !== undefined && (
        <span
          title={presentation.detailTitle ?? presentation.detail}
          {...stylex.props(toolCallStyles.detail)}
        >
          {presentation.detail}
        </span>
      )}
      {(presentation.added !== undefined || presentation.removed !== undefined) && (
        <span {...stylex.props(toolCallStyles.stats, editDiff && toolCallStyles.editStats)}>
          {presentation.added !== undefined && (
            <span {...stylex.props(toolCallStyles.added)}>+{presentation.added}</span>
          )}
          {presentation.removed !== undefined && (
            <span {...stylex.props(toolCallStyles.removed)}>-{presentation.removed}</span>
          )}
        </span>
      )}
    </>
  );

  const line = expandable ? (
    <Collapsible.Trigger
      data-tool-status={presentation.state}
      {...stylex.props(
        toolCallStyles.line,
        editDiff && toolCallStyles.editLine,
        density === "detailed" && toolCallStyles.lineDetailed,
        focus.ring,
        presentation.state === "failed" && toolCallStyles.failed,
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
      data-tool-status={presentation.state}
      {...stylex.props(
        toolCallStyles.line,
        density === "detailed" && toolCallStyles.lineDetailed,
        toolCallStyles.lineStatic,
        presentation.state === "failed" && toolCallStyles.failed,
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
          {presentation.body.kind === "output" && !state.open && (
            <OutputPreview text={presentation.body.text} />
          )}
          {presentation.body.kind === "output" && (
            <Collapsible.Panel
              role="region"
              aria-label={`${presentation.verb} output`}
              data-nyte-scrollport
              {...stylex.props(toolCallStyles.output)}
            >
              {presentation.body.text}
            </Collapsible.Panel>
          )}
          {presentation.body.kind === "diff" && (
            <Collapsible.Panel keepMounted>
              <DiffView
                path={presentation.body.path}
                diff={presentation.body.diff}
                variant="inline"
              />
            </Collapsible.Panel>
          )}
        </div>
      )}
    />
  );
});
