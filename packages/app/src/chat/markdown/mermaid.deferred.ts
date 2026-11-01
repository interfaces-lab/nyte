import { publishDeferred } from "../../lib/deferred.tsx";
import { renderDiagram } from "./mermaid-render.ts";

export const mermaidRuntime = { renderDiagram };

publishDeferred("mermaid", mermaidRuntime);
