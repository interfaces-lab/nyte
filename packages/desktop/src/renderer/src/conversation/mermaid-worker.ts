import { Type } from "typebox";
import { Value } from "typebox/value";
import { renderDiagram } from "./mermaid-render.ts";

const renderRequest = Type.Object({ id: Type.String(), source: Type.String() });

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!Value.Check(renderRequest, event.data)) return;
  self.postMessage({ id: event.data.id, result: renderDiagram(event.data.source) });
});
