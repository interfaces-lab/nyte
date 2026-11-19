import { idSchema } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { currentConnection } from "../../data/connection.ts";
import type { FileBuffer } from "./file-document.ts";

const PositionType = Type.Object({ line: Type.Integer(), character: Type.Integer() });

const ChangeType = Type.Object({
  start: Type.Integer({ minimum: 0 }),
  end: Type.Integer({ minimum: 0 }),
  text: Type.String(),
  range: Type.Object({ start: PositionType, end: PositionType }),
});

const Address = { host: Type.String(), path: Type.String() };

const MessageType = Type.Union([
  Type.Object({
    ...Address,
    kind: Type.Literal("changes"),
    changes: Type.Array(ChangeType),
    length: Type.Integer({ minimum: 0 }),
  }),
  Type.Object({
    ...Address,
    kind: Type.Literal("text"),
    contents: Type.String(),
    typed: Type.Number(),
    window: Type.String(),
  }),
  Type.Object({
    ...Address,
    kind: Type.Literal("saved"),
    contents: Type.String(),
    version: idSchema<"file-version">(),
  }),
  Type.Object({ ...Address, kind: Type.Literal("ask") }),
]);

type Message = Static<typeof MessageType>;

type Unaddressed = Message extends infer Each
  ? Each extends Message
    ? Omit<Each, "host" | "path">
    : never
  : never;

interface Shared {
  readonly buffer: FileBuffer;
  readonly unwatch: () => void;
  holders: number;
  typed: number;
  asking: number | undefined;
}

const ASK_MS = 250;

const HERE = crypto.randomUUID();

const channel = new BroadcastChannel("nyte:documents:v1");

const shared = new Map<string, Shared>();

function post(path: string, message: Unaddressed): void {
  const host = currentConnection()?.hostId;

  if (host !== undefined) channel.postMessage({ ...message, host, path });
}

function askSoon(path: string, entry: Shared): void {
  window.clearTimeout(entry.asking);

  entry.asking = window.setTimeout(() => {
    entry.asking = undefined;
    post(path, { kind: "ask" });
  }, ASK_MS);
}

function sendText(path: string, entry: Shared): void {
  post(path, { kind: "text", contents: entry.buffer.text(), typed: entry.typed, window: HERE });
}

channel.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data;

  if (!Value.Check(MessageType, message) || message.host !== currentConnection()?.hostId) return;
  const entry = shared.get(message.path);

  if (entry === undefined) return;

  switch (message.kind) {
    case "ask":
      if (entry.buffer.getSnapshot().dirty) sendText(message.path, entry);

      return;
    case "saved":
      entry.buffer.receive(message);

      return;
    case "text": {
      const newer =
        message.typed > entry.typed || (message.typed === entry.typed && message.window > HERE);

      if (!newer) return;
      entry.typed = message.typed;
      entry.buffer.receive(message);

      return;
    }

    case "changes":
      if (!entry.buffer.receive(message)) askSoon(message.path, entry);

      return;
    default: {
      const exhaustive: never = message;

      return exhaustive;
    }
  }
});

/**
 * Makes one open file the same document in every window on this host: each edit made here goes to the windows that
 * have the file open, and theirs arrive here, so an unsaved draft is the same text everywhere while carets, tabs and
 * scroll stay each window's own. A window that opens the file later takes the draft the others hold. When two
 * windows end up with different text, the one typed in last keeps its text and the other takes it. Returns the
 * function that stops sharing for this holder; the file stays shared while another editor in this window holds it.
 */
export function shareDocument(path: string, buffer: FileBuffer): () => void {
  const known = shared.get(path);

  const entry: Shared =
    known?.buffer === buffer
      ? known
      : {
          buffer,
          holders: 0,
          typed: 0,
          asking: undefined,
          unwatch: buffer.watch((news) => {
            if (news.kind === "saved") {
              post(path, news);

              return;
            }

            entry.typed = Date.now();

            if (news.kind === "text") sendText(path, entry);
            else post(path, { ...news, changes: [...news.changes] });
          }),
        };

  if (known !== entry) {
    known?.unwatch();
    shared.set(path, entry);
    post(path, { kind: "ask" });
  }

  entry.holders += 1;

  return () => {
    entry.holders -= 1;

    if (entry.holders > 0 || shared.get(path) !== entry) return;
    window.clearTimeout(entry.asking);
    entry.unwatch();
    shared.delete(path);
  };
}
