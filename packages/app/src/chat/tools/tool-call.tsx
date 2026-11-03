import type { ReactElement } from "react";
import { toolOutput } from "@nyte-ai/plugin/client/presentation";
import { QUESTION_TOOL } from "@nyte-ai/plugin/question/schema";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import type { ToolCallDensity } from "../../preferences/index.ts";
import { EditCallView } from "./edit-call.tsx";
import { QuestionCallView } from "./question-call.tsx";
import { ShellCallView } from "./shell-call.tsx";
import { SubagentLineView } from "./subagent-call.tsx";
import { ToolLineView } from "./tool-line.tsx";
import { excerptText, outputExcerpt } from "./tool-output.tsx";

export function ToolCallView({
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
      return (
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
    case "custom":
      return state.name === QUESTION_TOOL ? (
        <QuestionCallView message={message} toolClass={toolClass} cwd={cwd} />
      ) : (
        <ToolLineView message={message} toolClass={toolClass} cwd={cwd} />
      );
    case "read":
    case "list":
      return <ToolLineView message={message} toolClass={toolClass} cwd={cwd} />;
    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
}
