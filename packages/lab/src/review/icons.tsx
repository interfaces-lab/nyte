import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import type { GlyphSize, IconName } from "@nyte-ai/ui/icon";

function step(size: number): GlyphSize {
  if (size <= 10) return "2xs";

  if (size <= 12) return "xs";

  if (size <= 14) return "sm";

  return "md";
}

export function Glyph({
  name,
  size = 14,
  className,
}: {
  readonly name: IconName;
  readonly size?: number;
  readonly className?: string;
}): ReactElement {
  return (
    <span className={["gr-glyph", className].filter(Boolean).join(" ")}>
      <Icon name={name} size={step(size)} />
    </span>
  );
}
