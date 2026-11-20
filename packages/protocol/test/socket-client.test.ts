import { API_MIN_REVISION, API_REVISION, isJsonObject, SOCKET_LIMITS } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { linkLost } from "../src/client/stream-client.ts";
import { openHostSocket } from "../src/client/socket-client.ts";
import type { HostSocket, SocketLike } from "../src/client/socket-client.ts";
import { parseJson } from "../src/wire/json.ts";

type Listener = (event: {
  readonly data: unknown;
  readonly code: number;
  readonly reason: string;
}) => void;

type Answering = "nothing" | "probes";

const CLIENT = { kind: "other", name: "test", version: "1", actions: [] } as const;

afterEach(() => {
  vi.useRealTimers();
});

function farEnd(answering: Answering) {
  const listeners = new Map<string, Set<Listener>>();
  const calls: string[] = [];
  let closed = false;

  const emit = (
    type: string,
    event: { readonly data?: unknown; readonly code?: number; readonly reason?: string },
  ): void => {
    for (const listener of listeners.get(type) ?? [])
      listener({ data: event.data, code: event.code ?? 0, reason: event.reason ?? "" });
  };

  const answer = (frame: Json): void => {
    if (!isJsonObject(frame)) return;

    if (frame["type"] === "hello") {
      emit("message", {
        data: JSON.stringify({
          c: "e",
          type: "welcome",
          api_revision: API_REVISION,
          api_min_revision: API_MIN_REVISION,
          api_server_revision: API_REVISION,
          host_id: "host",
          client_id: "client",
          limits: SOCKET_LIMITS,
        }),
      });

      return;
    }

    const op = frame["op"];

    if (typeof op !== "string") return;
    calls.push(op);

    if (answering === "probes" && op === "events.unsubscribe")
      emit("message", {
        data: JSON.stringify({ c: "e", type: "result", id: frame["id"], output: null }),
      });
  };

  const socket: SocketLike = {
    send: (data) => queueMicrotask(() => answer(parseJson(data))),
    close: () => {
      closed = true;
    },
    addEventListener(type: string, listener: Listener) {
      const known = listeners.get(type) ?? new Set<Listener>();
      known.add(listener);
      listeners.set(type, known);
    },
  };

  return {
    socket,
    calls,
    open: () => emit("open", {}),
    answer: (id: string) =>
      emit("message", { data: JSON.stringify({ c: "e", type: "result", id, output: "late" }) }),
    closed: () => closed,
  };
}

async function opened(
  answering: Answering,
): Promise<{ readonly far: ReturnType<typeof farEnd>; readonly socket: HostSocket }> {
  const far = farEnd(answering);
  const opening = openHostSocket({ socket: far.socket, client: CLIENT });
  far.open();
  const socket = await opening;
  await socket.welcome;

  return { far, socket };
}

describe("a host socket", () => {
  it("fails to open after 10 s when the host never accepts", async () => {
    vi.useFakeTimers();
    const far = farEnd("nothing");
    const opening = openHostSocket({ socket: far.socket, client: CLIENT });
    const failed = expect(opening).rejects.toMatchObject({ code: "unavailable" });

    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    expect(far.closed()).toBe(true);
  });

  it.each([
    {
      case: "idle, the host answering nothing",
      answering: "nothing",
      call: false,
      asked: false,
      alive: 39_999,
      lost: 40_000,
    },
    {
      case: "a call pending, the host answering nothing",
      answering: "nothing",
      call: true,
      asked: false,
      alive: 14_999,
      lost: 15_000,
    },
    {
      case: "asked to probe, the host answering nothing",
      answering: "nothing",
      call: false,
      asked: true,
      alive: 1_999,
      lost: 2_000,
    },
  ] as const)(
    "counts itself lost $case, and fails what was pending as a lost link",
    async (row) => {
      vi.useFakeTimers();
      const { far, socket } = await opened(row.answering);
      const pending = row.call ? socket.call("head.read", {}) : row.asked ? socket.probe() : null;
      const failed = pending?.catch((error: unknown) => error);
      let ended = false;
      void socket.closed.then(() => (ended = true));

      await vi.advanceTimersByTimeAsync(row.alive);
      expect(ended).toBe(false);
      await vi.advanceTimersByTimeAsync(row.lost - row.alive);

      expect(ended).toBe(true);
      expect(await socket.closed).toEqual({ code: 1006, reason: "The host stopped answering." });
      expect(far.closed()).toBe(true);
      expect(far.calls.filter((op) => op === "events.unsubscribe")).toHaveLength(1);

      if (failed !== undefined) expect(linkLost(await failed)).toBe(true);
      expect(linkLost(await socket.call("head.read", {}).catch((error: unknown) => error))).toBe(
        true,
      );
    },
  );

  it("keeps a slow call going while the host answers its probes, and an idle socket probes once every 30 s", async () => {
    vi.useFakeTimers();
    const { far, socket } = await opened("probes");
    const pending = socket.call("head.read", {});
    let ended = false;
    void socket.closed.then(() => (ended = true));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(ended).toBe(false);
    far.answer("1");
    expect(await pending).toBe("late");

    const probes = far.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ended).toBe(false);
    expect(far.calls.length - probes).toBe(4);
  });
});
