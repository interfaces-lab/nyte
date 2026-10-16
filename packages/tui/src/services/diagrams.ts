import { Worker } from "node:worker_threads";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import { compiled } from "../compiled.ts";

const MAX_SOURCE_CHARS = 8_000;

const MAX_SOURCE_LINES = 120;

const MAX_DIAGRAM_LINES = 300;

const MAX_DIAGRAM_CHARS = 100_000;

/** How many drawn diagrams stay cached by source. */
const KEPT_DIAGRAMS = 64;

const DiagramRequestType = Type.Object({ id: Type.Integer(), source: Type.String() });

const DiagramReplyType = Type.Union([
  Type.Object({ id: Type.Integer(), kind: Type.Literal("drawn"), text: Type.String() }),
  Type.Object({ id: Type.Integer(), kind: Type.Literal("failed") }),
]);

/** A mermaid source the diagram thread is asked to draw. */
export type DiagramRequest = Static<typeof DiagramRequestType>;

/** The diagram thread's answer to one request. */
export type DiagramReply = Static<typeof DiagramReplyType>;

/** Checks a request on the diagram thread. */
export const diagramRequests = Compile(DiagramRequestType);

const diagramReplies = Compile(DiagramReplyType);

/** Draws mermaid diagrams as text on a thread of their own, started by the first diagram. */
export interface Diagrams {
  /** Rejects when the source or its drawing is too large, or the source does not parse. */
  draw(source: string): Promise<string>;
  dispose(): void;
}

/**
 * Mermaid layout loads elkjs, about 3 MB of JavaScript. Drawing on a worker whose entry is a
 * separate bundle keeps it out of the CLI's startup, so only a session that shows a diagram
 * pays for it, and only once.
 */
export function createDiagrams(): Diagrams {
  let worker: Worker | null = null;
  let sequence = 0;
  const waiting = new Map<number, PromiseWithResolvers<string>>();
  const drawn = new Map<string, Promise<string>>();

  const fail = (cause: Error): void => {
    for (const pending of waiting.values()) pending.reject(cause);
    waiting.clear();
    drawn.clear();
    worker = null;
  };

  const start = (): Worker => {
    const started = new Worker(
      compiled ? "./tui/src/mermaid-worker.ts" : new URL("../mermaid-worker.ts", import.meta.url),
    );

    started.unref();
    started.on("message", (reply) => {
      if (!diagramReplies.Check(reply)) return;
      const pending = waiting.get(reply.id);

      if (pending === undefined) return;
      waiting.delete(reply.id);

      if (reply.kind === "drawn") pending.resolve(reply.text);
      else pending.reject(new SyntaxError("The diagram does not parse"));
    });
    started.on("error", fail);
    started.on("exit", (code) =>
      fail(new Error(`The diagram thread exited with ${String(code)}.`)),
    );

    return started;
  };

  const render = async (source: string): Promise<string> => {
    if (source.length > MAX_SOURCE_CHARS || source.split("\n").length > MAX_SOURCE_LINES)
      throw new RangeError("Diagram is too large");
    worker ??= start();
    const id = (sequence += 1);
    const pending = Promise.withResolvers<string>();

    waiting.set(id, pending);
    worker.postMessage({ id, source } satisfies DiagramRequest);
    const text = await pending.promise;

    if (text.length > MAX_DIAGRAM_CHARS || text.split("\n").length > MAX_DIAGRAM_LINES)
      throw new RangeError("Diagram is too large");

    return text;
  };

  return {
    draw(source) {
      const known = drawn.get(source);

      if (known !== undefined) return known;
      const drawing = render(source);

      drawing.catch(() => drawn.delete(source));
      drawn.set(source, drawing);

      if (drawn.size > KEPT_DIAGRAMS) {
        const [oldest] = drawn.keys();

        if (oldest !== undefined) drawn.delete(oldest);
      }

      return drawing;
    },
    dispose() {
      const running = worker;

      fail(new Error("The diagram thread closed."));
      void running?.terminate();
    },
  };
}
