import { asId, SdkError, SOCKET_LIMITS } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import type { SocketLike } from "@nyte-ai/protocol";
import { afterEach, expect, it } from "vitest";
import { openLink } from "../src/live/host-connection.ts";
import type { SocketLink } from "../src/live/host-connection.ts";
import { linkCell } from "../src/live/link.ts";
import type { LinkCell, LinkState } from "../src/live/link.ts";

const HOST = asId<"host">("host-a");

type Listener = (event: {
  readonly data: unknown;
  readonly code: number;
  readonly reason: string;
}) => void;

interface FarEnd {
  frame(frame: Json): void;
  close(code: number, reason?: string): void;
}

type Answer = (far: FarEnd, dial: number) => void;

const opened: { readonly link: SocketLink; readonly cell: LinkCell }[] = [];

afterEach(() => {
  for (const { link, cell } of opened.splice(0)) {
    link.close();
    cell.close();
  }
});

function later(run: () => void): void {
  setTimeout(run, 20);
}

function welcome(host: string): Json {
  return {
    c: "e",
    type: "welcome",
    api_revision: 45,
    api_min_revision: 45,
    api_server_revision: 45,
    host_id: host,
    client_id: "client-1",
    version: "0.0.29",
    startedAt: 7,
    match: { kind: "host-older", replace: "when-idle" },
    limits: SOCKET_LIMITS,
  };
}

function socketFor(answer: Answer) {
  let dials = 0;

  return (): SocketLike => {
    dials += 1;
    const dial = dials;
    const listeners = new Map<string, Set<Listener>>();
    let closed = false;

    const emit = (
      type: string,
      event: { data?: unknown; code?: number; reason?: string },
    ): void => {
      for (const listener of listeners.get(type) ?? []) {
        listener({ data: event.data, code: event.code ?? 0, reason: event.reason ?? "" });
      }
    };

    const far: FarEnd = {
      frame: (frame) => emit("message", { data: JSON.stringify(frame) }),
      close(code, reason = "") {
        if (closed) return;
        closed = true;
        emit("close", { code, reason });
      },
    };

    queueMicrotask(() => emit("open", {}));

    return {
      send(data) {
        if (JSON.parse(data).type === "hello") setTimeout(() => answer(far, dial), 5);
      },
      close: () => far.close(1000, "done"),
      addEventListener(type: string, listener: Listener) {
        const known = listeners.get(type) ?? new Set<Listener>();
        known.add(listener);
        listeners.set(type, known);
      },
    };
  };
}

function follow(answer: Answer, http: number | null) {
  const cell = linkCell();

  const link = openLink("http://host.test", {
    link: cell,
    host: HOST,
    credentials: { kind: "token", token: "token" },
    client: { kind: "app", name: "Nyte", version: "0.0.30" },
    socket: socketFor(answer),
    fetch: async () =>
      http === null
        ? Promise.reject(new TypeError("offline"))
        : new Response("{}", { status: http }),
  });

  opened.push({ link, cell });
  const seen: string[] = [];
  const waiting = new Map<number, () => void>();

  link.link.subscribe(() => {
    const label = describe(link.link.snapshot());

    if (seen.at(-1) === label) return;
    seen.push(label);
    waiting.get(seen.length)?.();
  });

  const reached = (count: number): Promise<void> => {
    if (seen.length >= count) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    waiting.set(count, resolve);

    return promise;
  };

  return { link, cell, seen, reached };
}

function describe(state: LinkState): string {
  switch (state.kind) {
    case "open":
      return `open ${state.version} ${state.match.kind}`;
    case "away":
      return `away ${state.reason}`;
    case "refused":
      return `refused ${state.reason}`;
    default:
      return state.kind;
  }
}

interface Row {
  readonly name: string;
  readonly answer: Answer;
  readonly http?: number | null;
  readonly after?: (link: SocketLink, cell: LinkCell) => void;
  readonly states: readonly string[];
}

const rows: readonly Row[] = [
  {
    name: "a welcome from the host the requests reach",
    answer: (far) => far.frame(welcome(HOST)),
    states: ["open 0.0.29 host-older"],
  },
  {
    name: "a welcome from another host",
    answer: (far) => far.frame(welcome("host-b")),
    states: ["refused other-host"],
  },
  {
    name: "a hello the host refuses for an older client",
    answer: (far) => {
      far.frame({
        c: "e",
        type: "refused",
        reason: "update-client",
        message: "Update the client.",
      });
      far.close(1008, "Update the client.");
    },
    states: ["refused update-client"],
  },
  {
    name: "a host closing to be replaced",
    answer: (far, dial) => {
      far.frame(welcome(HOST));

      if (dial > 1) return;
      later(() => {
        far.frame({
          c: "e",
          type: "event",
          scope: "host",
          seq: null,
          kind: "closing",
          reason: "replacing",
        });
        later(() => far.close(1001, "The host is closing."));
      });
    },
    states: ["open 0.0.29 host-older", "away replacing", "open 0.0.29 host-older"],
  },
  {
    name: "a socket that drops without a word",
    answer: (far, dial) => {
      far.frame(welcome(HOST));

      if (dial === 1) later(() => far.close(1006));
    },
    states: ["open 0.0.29 host-older", "away lost", "open 0.0.29 host-older"],
  },
  {
    name: "two hellos in a row that get no answer while HTTP answers",
    answer: (far) => far.close(1008, "The first frame must be a hello."),
    states: ["away lost", "refused update-host"],
  },
  {
    name: "a hello that gets no answer while HTTP doesn't either",
    answer: (far, dial) => (dial === 1 ? far.close(1006) : far.frame(welcome(HOST))),
    http: null,
    states: ["away lost", "open 0.0.29 host-older"],
  },
  {
    name: "a credential the host no longer takes",
    answer: (far) => far.close(1008, "Unauthenticated."),
    http: 401,
    states: ["refused auth"],
  },
  {
    name: "an HTTP answer from another host, then a retry once the user reconnects",
    answer: (far) => far.frame(welcome(HOST)),
    after(link, cell) {
      cell.refuse({ reason: "other-host", error: new SdkError("stale", "Another host.") });
      later(() => link.retry());
    },
    states: [
      "open 0.0.29 host-older",
      "refused other-host",
      "connecting",
      "open 0.0.29 host-older",
    ],
  },
  {
    name: "a connection closed by its client",
    answer: (far) => far.frame(welcome(HOST)),
    after: (link, cell) => {
      link.close();
      cell.close();
    },
    states: ["open 0.0.29 host-older", "closed"],
  },
];

it.each(rows)("moves the link through $states for $name", async (row) => {
  const { link, cell, seen, reached } = follow(row.answer, row.http === undefined ? 200 : row.http);

  if (row.after !== undefined) {
    await reached(1);
    row.after(link, cell);
  }

  await reached(row.states.length);
  expect(seen).toEqual(row.states);
});
