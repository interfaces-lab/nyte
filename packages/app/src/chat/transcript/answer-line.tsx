import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { AnswerMessage } from "@nyte-ai/plugin/client/presentation";
import { toolLineStyles } from "../tools/tool-line.tsx";

export function AnswerLine({
  message,
  held,
}: {
  readonly message: AnswerMessage;
  readonly held: boolean;
}): ReactElement {
  return (
    <div {...props(toolLineStyles.line)}>
      <span {...props(toolLineStyles.action)}>Answered</span>
      <span {...props(toolLineStyles.details)}>{message.source.label}</span>
      <span {...props(toolLineStyles.outcome)}>· after the agent moved on</span>
      {held && (
        <span {...props(intent.warning, toolLineStyles.outcome)}>
          · Held until your next message
        </span>
      )}
    </div>
  );
}
