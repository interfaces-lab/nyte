import { MERMAID_COLORS, cleanMermaidSvg } from "@nyte-ai/ui/mermaid-theme";
import { renderMermaidSVG } from "beautiful-mermaid";

export function Mermaid({ chart }: { chart: string }) {
  const svg = cleanMermaidSvg(
    renderMermaidSVG(chart.replaceAll(String.raw`\n`, "\n"), {
      ...MERMAID_COLORS,
      transparent: true,
    }),
  );

  return <div className="docs-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
