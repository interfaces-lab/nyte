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
import { Collapsible } from "@nyte-ai/ui/primitives";
import { useState } from "react";
import type { ReactElement } from "react";
import type { ToolProgress, ToolTurnPart } from "@nyte-ai/core";
import { Icon } from "../components/icons.tsx";
import { focus, srOnly } from "../components/ui.tsx";
import type { ToolCallDensity } from "../theme/boot.ts";
import { DiffView } from "./diff-view.tsx";
import { activityStyles, toolCallStyles } from "./styles.stylex.ts";
import { presentTool } from "./tool-detail.ts";

export function ToolCallView({
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
  const [open, setOpen] = useState(false);
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

  return (
    <Collapsible.Root
      open={open}
      disabled={!expandable}
      onOpenChange={setOpen}
      {...stylex.props(toolCallStyles.root)}
    >
      {expandable ? (
        <Collapsible.Trigger
          data-tool-status={presentation.state}
          {...stylex.props(
            toolCallStyles.line,
            editDiff && toolCallStyles.editLine,
            density === "detailed" && toolCallStyles.lineDetailed,
            focus.ring,
            presentation.state === "failed" && toolCallStyles.failed,
          )}
        >
          {lineContent}
          <span {...stylex.props(toolCallStyles.chevron, open && toolCallStyles.chevronOpen)}>
            <Icon name="chevron-right" size={12} />
          </span>
        </Collapsible.Trigger>
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
        <Collapsible.Panel>
          <DiffView path={presentation.body.path} diff={presentation.body.diff} variant="inline" />
        </Collapsible.Panel>
      )}
    </Collapsible.Root>
  );
}
