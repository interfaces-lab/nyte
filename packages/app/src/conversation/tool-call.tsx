/**
 * One tool call, drawn by its class: shell, edit and subagent calls have their
 * own rows, and every other class is a quiet verb line that expands into its
 * evidence. No status icons on tool calls: the running state is the shimmer,
 * the outcome is a word after the subject, and the chevron is a control.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/ui/src/tool-call.tsx
 */
import { memo } from "react";
import type { ReactElement } from "react";
import { toolOutput } from "../view-helpers.ts";
import type { ToolMessage } from "../view-helpers.ts";
import type { ToolCallDensity } from "../preferences/index.ts";
import { EditCallView } from "./edit-call.tsx";
import { ShellCallView } from "./shell-call.tsx";
import { SubagentCallView, SubagentLineView } from "./subagent-call.tsx";
import { ToolLineView } from "./tool-line.tsx";
import { excerptText, outputExcerpt } from "./tool-output.tsx";

export const ToolCallView = memo(function ToolCallView({
  message,
  cwd,
  density,
}: {
  message: ToolMessage;
  cwd: string | undefined;
  density: ToolCallDensity;
}): ReactElement {
  const { state } = message;
  const toolClass = state.class;

  switch (toolClass.kind) {
    case "delegate":
      return toolClass.role === "task" || toolClass.role === "create" ? (
        <SubagentCallView title={toolClass.title ?? "Subagent"} message={message} cwd={cwd} />
      ) : (
        <SubagentLineView
          toolClass={toolClass}
          message={message}
          output={excerptText(
            outputExcerpt(
              state.phase === "running" ? (state.progress?.text ?? "") : toolOutput(state),
            ),
          )}
        />
      );
    case "shell":
      return <ShellCallView message={message} toolClass={toolClass} cwd={cwd} density={density} />;
    case "edit":
      return <EditCallView message={message} toolClass={toolClass} cwd={cwd} density={density} />;
    case "read":
    case "list":
    case "custom":
      return <ToolLineView message={message} toolClass={toolClass} cwd={cwd} />;
    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
});
