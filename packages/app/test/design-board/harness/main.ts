import { Type } from "typebox";
import { Value } from "typebox/value";
import { readBoardMessage } from "@nyte-ai/plugin/design/board-protocol";
import type { AppMessage, BoardMessage } from "@nyte-ai/plugin/design/board-protocol";
import { buildBoard } from "../../../src/studio/design-compile.ts";
import type { BoardLoad } from "../../../src/studio/design-compile.ts";
import { ofKind } from "./harness-api.ts";
import type { Harness, Pattern } from "./harness-api.ts";

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

type JsonPattern =
  | null
  | boolean
  | number
  | string
  | readonly JsonPattern[]
  | { readonly [key: string]: JsonPattern | undefined };

const FenceType = Type.Object({ fence: Type.Integer() });

const frame = document.body.appendChild(document.createElement("iframe"));

frame.title = "Design board";

frame.setAttribute("sandbox", "allow-scripts");

frame.referrerPolicy = "no-referrer";

frame.src = new URL("canvas/board/board.html", window.location.href).href;

const posted: BoardMessage[] = [];

const unreadable: unknown[] = [];

const fences = new Map<number, number>();

let ready = false;

let last: BoardLoad | null = null;

const send = (message: AppMessage): void => frame.contentWindow?.postMessage(message, "*");

function matches(value: Json | undefined, pattern: JsonPattern | undefined): boolean {
  if (Array.isArray(pattern)) {
    return (
      Array.isArray(value) &&
      value.length === pattern.length &&
      pattern.every((item, index) => matches(value[index], item))
    );
  }

  if (!(pattern instanceof Object)) return value === pattern;

  if (!(value instanceof Object) || Array.isArray(value)) return false;
  const fields = new Map(Object.entries(value));

  return Object.entries(pattern).every((entry) => matches(fields.get(entry[0]), entry[1]));
}

const harness: Harness = {
  posted,
  unreadable,
  load: async (files) => {
    const load = await buildBoard({
      paths: Object.keys(files).toSorted(),
      texts: new Map(Object.entries(files)),
    });

    last = load;

    if (ready) send(load);

    return load.build;
  },
  resend: () => {
    if (last !== null) send(last);
  },
  send,
  find: (kind, pattern: Pattern<BoardMessage>, since) =>
    posted.slice(since).find((message) => ofKind(message, kind) && matches(message, pattern)) ??
    null,
  fenced: (token) => fences.get(token) ?? null,
};

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== frame.contentWindow) return;

  if (Value.Check(FenceType, event.data)) {
    fences.set(event.data.fence, posted.length);

    return;
  }

  const message = readBoardMessage(event.data);

  if (message === undefined) {
    unreadable.push(event.data);

    return;
  }

  posted.push(message);

  switch (message.kind) {
    case "ready":
      ready = true;
      send({ kind: "chrome", theme: "light", variables: {} });
      send({ kind: "theme", night: false });

      if (last !== null) send(last);

      return;
    case "select":
      send({
        kind: "lights",
        you: message.span === null ? null : { kind: "span", ...message.span },
        agents: [],
        follow: null,
      });
      break;
    default:
  }
});

Object.defineProperty(window, "harness", { value: harness });
