import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { highlightCode } from "./syntax-highlighter.ts";

const request = Type.Object({ id: Type.Number(), code: Type.String(), language: Type.String() });
const cancel = Type.Object({ id: Type.Number(), cancel: Type.Literal(true) });
const message = Type.Union([cancel, request]);
export type HighlightRequest = Static<typeof request>;
export type HighlightCancel = Static<typeof cancel>;

// One request per task, so a cancel posted while an earlier request runs can
// still pull its target out of the queue before the worker reaches it.
const queue: HighlightRequest[] = [];
let drainScheduled = false;

function drain(): void {
  drainScheduled = false;
  const next = queue.shift();
  if (next === undefined) return;
  let html: string | undefined;
  try {
    html = highlightCode(next.code, next.language);
  } catch {
    html = undefined;
  }
  self.postMessage({ id: next.id, html: html ?? null });
  if (queue.length > 0) scheduleDrain();
}

function scheduleDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;
  setTimeout(drain, 0);
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const parsed = Value.Parse(message, event.data);
  if ("cancel" in parsed) {
    const index = queue.findIndex((item) => item.id === parsed.id);
    if (index !== -1) queue.splice(index, 1);
    return;
  }
  queue.push(parsed);
  scheduleDrain();
};
