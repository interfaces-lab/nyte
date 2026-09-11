import { renderDiagram } from "./mermaid-render.ts";

function isRenderRequest(
  value: unknown,
): value is { readonly id: string; readonly source: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "source" in value &&
    typeof value.source === "string"
  );
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isRenderRequest(event.data)) return;
  self.postMessage({ id: event.data.id, result: renderDiagram(event.data.source) });
});
