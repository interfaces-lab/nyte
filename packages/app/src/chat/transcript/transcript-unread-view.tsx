import { props } from "@stylexjs/stylex";
import { Button, ButtonGroup } from "@nyte-ai/ui/button";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import type { KeyboardEvent, ReactElement } from "react";
import { pillLabel } from "./transcript-unread.ts";
import type { NewMessagesPill } from "./transcript-unread.ts";
import { dividerStyles, messageScrollerStyles } from "./transcript.stylex.ts";

export function UnreadDivider(): ReactElement {
  return (
    <div data-unread-divider {...props(text.sm, dividerStyles.root)}>
      <span aria-hidden {...props(dividerStyles.rule)} />
      <span {...props(dividerStyles.label)}>
        New<span {...props(srOnly)}> messages below</span>
      </span>
      <span aria-hidden {...props(dividerStyles.rule)} />
    </div>
  );
}

export function NewMessages({
  pill,
  onOpen,
  onDismiss,
}: {
  readonly pill: NewMessagesPill | null;
  readonly onOpen: (direction: NewMessagesPill["direction"]) => void;
  readonly onDismiss: (direction: NewMessagesPill["direction"]) => void;
}): ReactElement {
  const dismissOnKey = (event: KeyboardEvent): void => {
    if (pill === null || (event.key !== "Backspace" && event.key !== "Delete")) return;
    event.preventDefault();
    onDismiss(pill.direction);
  };

  return (
    <div aria-live="polite" {...props(messageScrollerStyles.pill)}>
      {pill !== null && (
        <ButtonGroup data-new-messages={pill.direction}>
          <Button
            variant="outline"
            icon={pill.direction === "down" ? "arrow-down" : "arrow-up"}
            onClick={() => onOpen(pill.direction)}
            onKeyDown={dismissOnKey}
          >
            {pillLabel(pill.count)}
          </Button>
          <Button
            variant="outline"
            iconOnly
            icon="close"
            aria-label="Dismiss new messages"
            tabIndex={-1}
            onClick={() => onDismiss(pill.direction)}
          />
        </ButtonGroup>
      )}
    </div>
  );
}
