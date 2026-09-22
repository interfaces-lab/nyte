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
      bg: "var(--nyte-conversation-technical-background)",
      fg: "var(--nyte-text-primary)",
      accent: "var(--nyte-accent)",
      muted: "var(--nyte-text-tertiary)",
      surface: "var(--nyte-bg-raised)",
      border: "var(--nyte-stroke-secondary)",
      font: "var(--nyte-font-family-sans)",
      padding: 24,
      transparent: true,
    });

    return svg.length > MAX_SVG_LENGTH ? { kind: "source" } : { kind: "diagram", svg };
  } catch {
    return { kind: "source" };
  }
}
