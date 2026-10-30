import { props } from "@stylexjs/stylex";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import type { ReactElement } from "react";
import { dividerStyles } from "./transcript.stylex.ts";

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
