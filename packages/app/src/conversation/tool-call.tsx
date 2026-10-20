import { memo } from "react";
import type { ReactElement } from "react";
import { toolOutput } from "@nyte-ai/plugin/client/presentation";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
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
