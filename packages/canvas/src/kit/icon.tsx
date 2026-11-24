import { ICON_NAMES, Icon as Glyph } from "@nyte-ai/ui/icon";
import type { GlyphSize, IconName } from "@nyte-ai/ui/icon";
import type { ReactElement } from "react";

const CLOSE_NAMES = 6;

export function Icon(props: {
  readonly name: IconName;
  readonly size?: GlyphSize;
  readonly label?: string;
}): ReactElement | null {
  const name = ICON_NAMES.find((candidate) => candidate === props.name);

  if (name === undefined) {
    console.error(unknownIcon(props.name));

    return null;
  }

  return <Glyph name={name} size={props.size ?? "sm"} label={props.label} />;
}

function unknownIcon(name: string): string {
  const words = name.toLowerCase().split(/[^a-z0-9]+/u);

  const close = ICON_NAMES.filter((candidate) =>
    candidate.split("-").some((part) => words.includes(part)),
  ).slice(0, CLOSE_NAMES);

  return close.length === 0
    ? `Icon has no glyph named "${name}". The names are: ${ICON_NAMES.join(", ")}.`
    : `Icon has no glyph named "${name}". Close names: ${close.join(", ")}.`;
}
