import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { toolLineStyles } from "../tools/tool-line.tsx";

export function ActionLine({
  label,
  held,
}: {
  readonly label: string;
  readonly held: boolean;
}): ReactElement {
  return (
    <div {...props(toolLineStyles.line)}>
      <Icon name="return" size="xs" />
      <span {...props(toolLineStyles.action)}>{label}</span>
      {held && (
        <span {...props(intent.warning, toolLineStyles.outcome)}>
          · Held until your next message
        </span>
      )}
    </div>
  );
}
