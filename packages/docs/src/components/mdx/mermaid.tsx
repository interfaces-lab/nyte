import { renderMermaidSVG } from "beautiful-mermaid";

/*
 * Based on https://github.com/fuma-nama/fumadocs/blob/main/apps/docs/components/mdx/mermaid.tsx
 *
 * `remarkMdxMermaid` rewrites ```mermaid fences into <Mermaid chart="..." />.
 * Beautiful Mermaid embeds its own CSS. Cloud color tokens keep it in
 * sync with the active light or dark theme without a client-side re-render.
 */

export function Mermaid({ chart }: { chart: string }) {
  const svg = renderMermaidSVG(chart.replaceAll("\\n", "\n"), {
    bg: "var(--nyte-color-background)",
    fg: "var(--nyte-color-foreground)",
    transparent: true,
  });

  return <div className="docs-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
