import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { AnswerMessage } from "@nyte-ai/plugin/client/presentation";
import { toolLineStyles } from "../tools/tool-line.tsx";

/**
 * Where a late answer reached the agent. The part it answers shows the answer itself, so this
 * stays one quiet line in the tool line's words instead of a prompt bubble.
 */
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
