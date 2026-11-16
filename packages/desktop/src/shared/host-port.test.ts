import { expect, test, vi } from "vitest";
import { hostPort, messagePortEnd, servePort } from "./host-port.ts";
import type { PortEnd, PortMessage, SocketLike } from "./host-port.ts";

interface ScriptedEnd {
  readonly end: PortEnd;
  readonly posted: PortMessage[];
  deliver(data: unknown): void;
  drop(): void;
  closed(): boolean;
}

function scriptedEnd(): ScriptedEnd {
  const posted: PortMessage[] = [];
  let handlers: Parameters<PortEnd["open"]>[0] | undefined;
  let closed = false;

  return {
    end: {
      open(opened) {
        handlers = opened;
      },
      post: (message) => posted.push(message),
      close() {
        closed = true;
      },
    },
    posted,
    deliver: (data) => handlers?.message(data),
    drop: () => handlers?.closed(),
    closed: () => closed,
  };
}

type SocketListener = (event: {
  readonly data: unknown;
  readonly code: number;
  readonly reason: string;
}) => void;

function fakeSocket() {
  const listeners = new Map<string, SocketListener[]>();
  const sent: string[] = [];
  const closes: string[] = [];

  const socket: SocketLike = {
    send: (data) => sent.push(data),
    close: (code, reason) => closes.push(`${code ?? "none"} ${reason ?? ""}`),
    addEventListener(type: string, listener: SocketListener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };

  return { socket, sent, closes };
}

const REQUEST = {
  kind: "request",
  id: 0,
  method: "GET",
  path: "/v1/catalog",
  headers: [],
  body: false,
} as const;

function mainEnd() {
  const port = scriptedEnd();
  const dialed = fakeSocket();
  let aborted = false;
  let answering: Promise<void> = Promise.resolve();

  servePort(
    port.end,
    (request) => {
      const answer = new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          aborted = true;
          reject(request.signal.reason);
        });
      });

      answering = answer.then(
        () => undefined,
        () => undefined,
      );

      return answer;
    },
    () => dialed.socket,
  );

  port.deliver(REQUEST);
  port.deliver({ kind: "socket", id: 1, path: "/v1/socket" });

  return { port, dialed, aborted: () => aborted, answering: () => answering };
}

test.each<{
  readonly name: string;
  readonly message: unknown;
  readonly closed: boolean;
  readonly aborted: boolean;
  readonly socket: { readonly sent: readonly string[]; readonly closes: readonly string[] };
  readonly posted?: readonly PortMessage[];
}>([
  {
    name: "a response from the window breaks the contract: the port closes and sockets shut 1001",
    message: { kind: "response", id: 0, status: 200, headers: [], body: false },
    closed: true,
    aborted: true,
    socket: { sent: [], closes: ["1001 The window closed."] },
  },
  {
    name: "opened from the window breaks the contract",
    message: { kind: "opened", id: 1 },
    closed: true,
    aborted: true,
    socket: { sent: [], closes: ["1001 The window closed."] },
  },
  {
    name: "a message that matches no kind breaks the contract",
    message: { kind: "frame", id: -1, text: "hi" },
    closed: true,
    aborted: true,
    socket: { sent: [], closes: ["1001 The window closed."] },
  },
  {
    name: "a message that isn't an object breaks the contract",
    message: "frame",
    closed: true,
    aborted: true,
    socket: { sent: [], closes: ["1001 The window closed."] },
  },
  {
    name: "a frame reaches the host's socket",
    message: { kind: "frame", id: 1, text: "hi" },
    closed: false,
    aborted: false,
    socket: { sent: ["hi"], closes: [] },
  },
  {
    name: "a shut closes the host's socket",
    message: { kind: "shut", id: 1, code: 4000, reason: "bye" },
    closed: false,
    aborted: false,
    socket: { sent: [], closes: ["4000 bye"] },
  },
  {
    name: "a reset abandons the request",
    message: { kind: "reset", id: 0 },
    closed: false,
    aborted: true,
    socket: { sent: [], closes: [] },
  },
  {
    name: "a socket on an id in use is refused",
    message: { kind: "socket", id: 1, path: "/v1/socket" },
    closed: false,
    aborted: false,
    socket: { sent: [], closes: [] },
    posted: [{ kind: "shut", id: 1, code: 1011, reason: "The host's socket is not served here." }],
  },
  {
    name: "a message for an id nobody holds is ignored",
    message: { kind: "credit", id: 9, bytes: 1 },
    closed: false,
    aborted: false,
    socket: { sent: [], closes: [] },
  },
])("main's end: $name", async (row) => {
  const made = mainEnd();
  made.port.deliver(row.message);

  if (row.aborted) await made.answering();

  expect({
    closed: made.port.closed(),
    aborted: made.aborted(),
    socket: { sent: made.dialed.sent, closes: made.dialed.closes },
    posted: made.port.posted,
  }).toEqual({
    closed: row.closed,
    aborted: row.aborted,
    socket: row.socket,
    posted: row.posted ?? [],
  });
});

test("main's end: the window's port closing abandons the request and shuts sockets 1001", () => {
  const made = mainEnd();
  made.port.drop();

  expect({ aborted: made.aborted(), closes: made.dialed.closes }).toEqual({
    aborted: true,
    closes: ["1001 The window closed."],
  });
});

test.each<{ readonly code: number; readonly sent: number }>([
  { code: 1000, sent: 1000 },
  { code: 1001, sent: 1000 },
  { code: 1006, sent: 1000 },
  { code: 2999, sent: 1000 },
  { code: 3000, sent: 3000 },
  { code: 4999, sent: 4999 },
  { code: 5000, sent: 1000 },
])("main's end: a window's shut $code closes the host's socket with $sent", (row) => {
  const made = mainEnd();
  made.port.deliver({ kind: "shut", id: 1, code: row.code, reason: "bye" });

  expect(made.dialed.closes).toEqual([`${row.sent} bye`]);
});

async function windowEnd() {
  const port = scriptedEnd();
  const opened = hostPort(async () => port.end);
  const abort = new AbortController();
  const fetching = opened.fetch("http://127.0.0.1/v1/catalog", { signal: abort.signal });
  const answered = fetching.then((response) => `status ${response.status}`, String);
  const socket = opened.socket({ url: "http://127.0.0.1/v1/socket" });
  const events: string[] = [];
  socket.addEventListener("open", () => events.push("open"));
  socket.addEventListener("message", (event) => events.push(`message ${String(event.data)}`));
  socket.addEventListener("error", () => events.push("error"));
  socket.addEventListener("close", (event) => events.push(`close ${event.code} ${event.reason}`));
  await vi.waitFor(() => expect(port.posted).toHaveLength(2));

  const ids = {
    request: port.posted.find((message) => message.kind === "request")?.id ?? -1,
    socket: port.posted.find((message) => message.kind === "socket")?.id ?? -1,
  };

  return { port, abort, answered, events, ids };
}

const PORT_CLOSED = "The Nyte host's port closed.";

test.each<{
  readonly name: string;
  readonly message?: (ids: { readonly request: number; readonly socket: number }) => unknown;
  readonly act?: "abort" | "drop";
  readonly closed: boolean;
  readonly answered: string | undefined;
  readonly events: readonly string[];
  readonly posted?: readonly string[];
}>([
  {
    name: "a request from the host breaks the contract: the port closes and sockets shut 1006",
    message: () => ({ ...REQUEST, id: 7 }),
    closed: true,
    answered: `TypeError: ${PORT_CLOSED}`,
    events: ["error", `close 1006 ${PORT_CLOSED}`],
  },
  {
    name: "a socket from the host breaks the contract",
    message: () => ({ kind: "socket", id: 7, path: "/v1/socket" }),
    closed: true,
    answered: `TypeError: ${PORT_CLOSED}`,
    events: ["error", `close 1006 ${PORT_CLOSED}`],
  },
  {
    name: "a message that matches no kind breaks the contract",
    message: (ids) => ({ kind: "shut", id: ids.socket, code: 1.5, reason: "" }),
    closed: true,
    answered: `TypeError: ${PORT_CLOSED}`,
    events: ["error", `close 1006 ${PORT_CLOSED}`],
  },
  {
    name: "the host's port closing fails the request and shuts sockets 1006",
    act: "drop",
    closed: false,
    answered: `TypeError: ${PORT_CLOSED}`,
    events: ["error", `close 1006 ${PORT_CLOSED}`],
  },
  {
    name: "a response answers the request",
    message: (ids) => ({
      kind: "response",
      id: ids.request,
      status: 204,
      headers: [],
      body: false,
    }),
    closed: false,
    answered: "status 204",
    events: [],
  },
  {
    name: "a reset fails the request",
    message: (ids) => ({ kind: "reset", id: ids.request }),
    closed: false,
    answered: "TypeError: The Nyte host abandoned the request.",
    events: [],
  },
  {
    name: "an aborted request is reset",
    act: "abort",
    closed: false,
    answered: "AbortError: This operation was aborted",
    events: [],
    posted: ["reset request"],
  },
  {
    name: "opened opens the socket",
    message: (ids) => ({ kind: "opened", id: ids.socket }),
    closed: false,
    answered: undefined,
    events: ["open"],
  },
  {
    name: "a frame reaches the socket",
    message: (ids) => ({ kind: "frame", id: ids.socket, text: "hi" }),
    closed: false,
    answered: undefined,
    events: ["message hi"],
  },
  {
    name: "a shut closes the socket with the host's code",
    message: (ids) => ({ kind: "shut", id: ids.socket, code: 4000, reason: "bye" }),
    closed: false,
    answered: undefined,
    events: ["close 4000 bye"],
  },
  {
    name: "a shut 1006 is an error first",
    message: (ids) => ({ kind: "shut", id: ids.socket, code: 1006, reason: "lost" }),
    closed: false,
    answered: undefined,
    events: ["error", "close 1006 lost"],
  },
])("the window's end: $name", async (row) => {
  const made = await windowEnd();
  const before = made.port.posted.length;

  if (row.message !== undefined) made.port.deliver(row.message(made.ids));

  if (row.act === "abort") made.abort.abort();

  if (row.act === "drop") made.port.drop();

  const answered = row.answered === undefined ? undefined : await made.answered;

  expect({
    closed: made.port.closed(),
    answered,
    events: made.events,
    posted: made.port.posted
      .slice(before)
      .map(
        (message) =>
          `${message.kind} ${message.id === made.ids.request ? "request" : String(message.id)}`,
      ),
  }).toEqual({
    closed: row.closed,
    answered: row.answered,
    events: row.events,
    posted: row.posted ?? [],
  });
});

function recording(port: MessagePort, posted: PortMessage[]): PortEnd {
  const end = messagePortEnd(port);

  return {
    open: (handlers) => end.open(handlers),
    post(message) {
      posted.push(message);
      end.post(message);
    },
    close: () => end.close(),
  };
}

const KIB = 1024;

test.each<{
  readonly name: string;
  readonly chunks: readonly number[];
  readonly read: boolean;
  readonly frames: number;
  readonly credits: readonly number[];
}>([
  {
    name: "a body under half the window is never credited",
    chunks: [300 * KIB],
    read: true,
    frames: 1,
    credits: [],
  },
  {
    name: "the window credits what it read once half the window has gone by",
    chunks: [300 * KIB, 300 * KIB, 300 * KIB],
    read: true,
    frames: 3,
    credits: [600 * KIB],
  },
  {
    name: "a small frame costs a kibibyte",
    chunks: Array.from({ length: 600 }, () => 1),
    read: true,
    frames: 600,
    credits: [512 * KIB],
  },
  {
    name: "the host stops sending once a whole window is unread",
    chunks: Array.from({ length: 8 }, () => 256 * KIB),
    read: false,
    frames: 4,
    credits: [],
  },
  {
    name: "credits let the host send the rest",
    chunks: Array.from({ length: 8 }, () => 256 * KIB),
    read: true,
    frames: 8,
    credits: [512 * KIB, 512 * KIB, 512 * KIB, 512 * KIB],
  },
])("flow control: $name", async (row) => {
  const channel = new MessageChannel();
  const fromMain: PortMessage[] = [];
  const fromWindow: PortMessage[] = [];

  servePort(recording(channel.port1, fromMain), async () => {
    const chunks = [...row.chunks];

    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          const size = chunks.shift();

          if (size === undefined) controller.close();
          else controller.enqueue(new Uint8Array(size));
        },
      }),
    );
  });

  const response = await hostPort(async () => recording(channel.port2, fromWindow)).fetch(
    "http://127.0.0.1/v1/blob",
  );

  if (row.read) await response.arrayBuffer();

  await vi.waitFor(() =>
    expect({
      frames: fromMain.filter((message) => message.kind === "data").length,
      credits: fromWindow.flatMap((message) => (message.kind === "credit" ? [message.bytes] : [])),
    }).toEqual({ frames: row.frames, credits: row.credits }),
  );
  channel.port1.close();
});
