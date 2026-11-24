import { MERMAID_COLORS, cleanMermaidSvg } from "@nyte-ai/ui/mermaid-theme";
import { renderMermaidSVG } from "beautiful-mermaid";

const MAX_SOURCE_LENGTH = 8000;

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
    const svg = cleanMermaidSvg(
      renderMermaidSVG(source, { ...MERMAID_COLORS, padding: 24, transparent: true }),
    ).replace(/<svg\b[^>]*>/, wholePixelSize);

    return svg.length > MAX_SVG_LENGTH ? { kind: "source" } : { kind: "diagram", svg };
  } catch {
    return { kind: "source" };
  }
}

function wholePixelSize(tag: string): string {
  return tag.replaceAll(
    /\b(width|height)="(\d+(?:\.\d+)?)"/g,
    (_match, name: string, value: string) =>
      `${name}="${String(2 * Math.ceil(Number(value) / 2))}"`,
  );
}
