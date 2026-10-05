import { role, type } from "@nyte-ai/ui/vars.stylex";
import { renderMermaidSVG } from "beautiful-mermaid";

const MAX_SOURCE_LENGTH = 8_000;

const MAX_SOURCE_LINES = 120;

const MAX_SVG_LENGTH = 500_000;

export type DiagramResult =
  | { readonly kind: "diagram"; readonly svg: string }
  | { readonly kind: "source" };

export function renderDiagram(source: string): DiagramResult {
  if (source.length > MAX_SOURCE_LENGTH || source.split("\n").length > MAX_SOURCE_LINES) {
    return { kind: "source" };
  }

  try {
    const svg = renderMermaidSVG(source, {
      bg: role.bgMutedTranslucent,
      fg: role.contentPrimary,
      accent: role.contentInteractiveTertiary,
      muted: role.contentSecondary,
      surface: role.bgElevated,
      border: role.borderSecondaryTranslucent,
      line: role.borderPrimaryTranslucent,
      padding: 24,
      transparent: true,
    })
      .replace(/^ *@import .*\n/gm, "")
      .replace(/^ *text \{ font-family: .*\n/m, "")
      .replace(/(\.mono \{ font-family: )[^;]*/, `$1${type.fontMono}`);

    return svg.length > MAX_SVG_LENGTH ? { kind: "source" } : { kind: "diagram", svg };
  } catch {
    return { kind: "source" };
  }
}
