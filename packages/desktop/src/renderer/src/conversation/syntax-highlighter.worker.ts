import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { highlightCode } from "./syntax-highlighter.ts";

const request = Type.Object({ id: Type.Number(), code: Type.String(), language: Type.String() });
export type HighlightRequest = Static<typeof request>;

self.onmessage = (event: MessageEvent<unknown>) => {
  const { id, code, language } = Value.Parse(request, event.data);
  self.postMessage({ id, html: highlightCode(code, language) ?? null });
};
