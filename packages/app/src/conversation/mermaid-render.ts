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
      bg: "var(--nyte-conversation-technical-bg)",
      fg: "var(--nyte-content-primary)",
      accent: "var(--nyte-blue-80)",
      muted: "var(--nyte-content-secondary)",
      surface: "var(--nyte-bg-elevated)",
      border: "var(--nyte-border-secondary-translucent)",
      line: "var(--nyte-border-primary-translucent)",
      font: "var(--nyte-font-family-sans)",
      padding: 24,
      transparent: true,
    });

    return svg.length > MAX_SVG_LENGTH ? { kind: "source" } : { kind: "diagram", svg };
  } catch {
    return { kind: "source" };
  }
}
