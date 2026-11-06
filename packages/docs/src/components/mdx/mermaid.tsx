import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { renderMermaidSVG } from "beautiful-mermaid";

export function Mermaid({ chart }: { chart: string }) {
  const svg = renderMermaidSVG(chart.replaceAll("\\n", "\n"), {
    bg: role.bgBase,
    fg: role.contentPrimary,
    transparent: true,
  });

  return <div className="docs-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
