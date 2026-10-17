/**
 * Two clients on one session, as the TUI and the desktop are: one on the
 * host's own HTTP listener, one through Nyte Connect, the real host relay
 * (`ConnectRuntime` serving `hostShare`) against the connect-worker broker
 * in local workerd that the connect tests use. The host's relay socket
 * drops mid-run and the remote client watches again.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearSpans, enableTracing } from "@nyte-ai/core";
import type { Host } from "@nyte-ai/core";
import { applyViewFrame, createTransport, decodeOutput } from "@nyte-ai/protocol";
import type { Transport } from "@nyte-ai/protocol";
import { asId, isJsonObject } from "@nyte-ai/schema";
import type { SessionId, SessionView, ViewFrame } from "@nyte-ai/schema";
import { afterAll, afterEach, assert, beforeAll, expect, it } from "vitest";
import { base64Url, BROKER_ROUTES, LinkTransactionLookup, relayAddress } from "@nyte-ai/connect";
import type { ConnectLinking } from "@nyte-ai/connect";
import { ConnectRuntime, hostShare } from "@nyte-ai/connect/host";
import { sha256 } from "@nyte-ai/connect/signing";
// oxlint-disable-next-line nyte-code/no-cross-package-relative-imports -- the broker harness is connect-worker's test fixture, not an export; depending on connect-worker would put its wrangler build under every host dependent's build
import { startWorkerdBroker } from "../../../connect-worker/test/workerd.ts";
// oxlint-disable-next-line nyte-code/no-cross-package-relative-imports -- as above
import type { WorkerdBroker } from "../../../connect-worker/test/workerd.ts";
import { Value } from "typebox/value";
import {
  fakeModels,
  PLACES_TOOL,
  RESTAURANT_ANSWER,
  RESTAURANT_PROMPT,
  restaurantHome,
  restaurantScript,
} from "../../src/bench/index.ts";
import {
  folder,
  openScenario,
  removeFolders,
  savePerturbation,
  until,
  waterfall,
} from "./support.ts";

let broker: WorkerdBroker;

beforeAll(async () => {
  enableTracing();
  broker = await startWorkerdBroker();
}, 60_000);

afterAll(async () => {
  await broker.close();
});

afterEach(async () => {
  clearSpans();
  await removeFolders();
});

const OWNER = "user_alice";

/** Links a `ConnectRuntime` for `host` through the broker's transaction flow, approved as `OWNER`, and serves `host` through its relay. */
async function share(host: Host): Promise<
  {
    readonly environmentId: string;
    /** Closes the host's relay socket, as a network drop would; the host dials again. */
    readonly drop: () => void;
  } & AsyncDisposable
> {
  broker.clerk.users.set(OWNER, {
    banned: false,
    locked: false,
    updated_at: 1,
    email: "alice@example.com",
  });

  const home = await mkdtemp(join(tmpdir(), "nyte-connect-"));
  const opened: Extract<ConnectLinking, { kind: "awaiting_approval" }>[] = [];
  const sockets: WebSocket[] = [];

  const runtime = new ConnectRuntime({
    config: { origin: broker.origin },
    home,
    authorizer: { kind: "transaction", onOpened: (awaiting) => opened.push(awaiting) },
    onChange: () => undefined,
    name: "Perturbation host",
    fetch: (input, init) => broker.fetch(input, init),
    dial: (url) => {
      const socket = new WebSocket(broker.localUrl(url));
      sockets.push(socket);

      return socket;
    },
    timing: { linkPollMs: 50 },
  });

  const linking = runtime.link();
  const awaiting = await until(() => opened[0], 10_000, "the link transaction");

  const headers = {
    authorization: `Bearer ${await broker.sessionToken({ userId: OWNER })}`,
    "content-type": "application/json",
  };

  const lookup: unknown = await (
    await broker.fetch(`${broker.origin}/v1/link-transactions/lookup`, {
      method: "POST",
      headers,
      body: JSON.stringify({ userCode: awaiting.userCode }),
    })
  ).json();

  assert(Value.Check(LinkTransactionLookup, lookup));
  await broker.fetch(`${broker.origin}/v1/link-transactions/${lookup.transactionId}/approve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ fingerprint: lookup.fingerprint }),
  });

  const linked = await linking;

  assert(linked.kind === "linked");
  await runtime.serve(hostShare(host));

  await until(
    async () => {
      const view = await runtime.view();

      return view.kind === "linked" && view.connection.kind === "connected" ? true : undefined;
    },
    20_000,
    "the host's relay to connect",
  );

  return {
    environmentId: linked.environment.id,
    drop: () => sockets.at(-1)?.close(),
    [Symbol.asyncDispose]: async () => {
      await runtime.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}

/** Enrolls a phone-like device as `OWNER` and returns a transport through the relay with its bearer, once a relayed call answers. */
async function enrollDevice(environmentId: string): Promise<Transport> {
  const bearer = base64Url(crypto.getRandomValues(new Uint8Array(32)));

  const enrolled = await broker.fetch(`${broker.origin}${BROKER_ROUTES.devices(environmentId)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await broker.sessionToken({ userId: OWNER, sessionId: "sess_tui" })}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      clientId: "tui-install-0001",
      clientName: "Terminal",
      digest: await sha256(bearer),
    }),
  });

  expect(enrolled.status).toBe(201);

  const transport = createTransport({
    url: relayAddress(broker.origin, environmentId),
    headers: async () => ({ authorization: `Bearer ${bearer}` }),
    fetch: (input, init) => broker.fetch(input, init),
  });

  await until(
    () =>
      transport.invoke("sessions.list", {}).then(
        () => true,
        () => undefined,
      ),
    20_000,
    "the relay to admit the device",
  );

  return transport;
}

/** One client's watch of a head: every frame in order, the view they build, and how often it watched again. */
interface Watch {
  readonly frames: ViewFrame[];
  readonly view: () => SessionView | null;
  readonly attempts: () => number;
  readonly errors: string[];
  close(): void;
}

/** Watches `session`'s main head through `transport`, applying each frame to the view before it, and watches again from a fresh view when the stream fails. */
function watch(transport: Transport, session: SessionId): Watch {
  const frames: ViewFrame[] = [];
  const errors: string[] = [];
  let view: SessionView | null = null;
  let attempts = 0;
  let closed = false;
  let iterator: AsyncIterator<unknown> | null = null;

  void (async () => {
    while (!closed) {
      attempts += 1;
      let first = true;

      try {
        const source = transport.frames("head.watch", { session, head: "main" });
        iterator = source[Symbol.asyncIterator]();

        for (;;) {
          const next = await iterator.next();

          if (next.done === true || closed) break;
          const frame = decodeOutput("head.watch", next.value);

          if (first) expect(frame.kind).toBe("view");
          first = false;
          view = applyViewFrame(frame.kind === "view" ? null : view, frame);
          frames.push(frame);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  })();

  return {
    frames,
    view: () => view,
    attempts: () => attempts,
    errors,
    close() {
      closed = true;
      void iterator?.return?.();
    },
  };
}

/** What a view shows of the conversation, without `heads`, whose `unread` is each principal's own. */
function transcript(view: SessionView | null) {
  return JSON.parse(
    JSON.stringify({
      seq: view?.seq,
      messages: view?.messages,
      parts: view?.parts,
      turns: view?.turns,
      execution: view?.execution,
    }),
  );
}

it("keeps two clients' views of one session equal when the relayed one loses its stream mid-run and watches again", async () => {
  await using home = await restaurantHome({ env: { PLACES_DELAY_MS: "1500" } });
  const turns = restaurantScript({ skill: home.skills["restaurant-picker"], route: "direct" });
  const fake = fakeModels({ fallback: turns.answer });
  await using host = await openScenario({ fake, home: home.home, workspace: await folder() });
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));

  const listener = await host.listen({
    transport: { kind: "http", hostname: "127.0.0.1" },
    auth: { kind: "token", token },
  });

  assert(listener.address !== null);
  await using connected = await share(host);
  const relayed = await enrollDevice(connected.environmentId);

  const local = createTransport({
    url: listener.address,
    headers: async () => ({ authorization: `Bearer ${token}` }),
  });

  const trace = crypto.randomUUID();
  const started = performance.now();

  const { session, receipt } = decodeOutput(
    "sessions.start",
    await local.invoke("sessions.start", {
      id: asId<"session">(trace),
      content: RESTAURANT_PROMPT,
    }),
  );

  const desktop = watch(local, session);
  const terminal = watch(relayed, session);

  await until(
    () => (terminal.view() !== null && desktop.view() !== null ? true : undefined),
    10_000,
    "both clients' first views",
  );

  await until(
    () =>
      JSON.stringify(terminal.view()?.messages ?? []).includes(`"name":"${PLACES_TOOL}"`)
        ? true
        : undefined,
    10_000,
    "the terminal to see the places call",
  );

  const before = terminal.frames.length;

  connected.drop();

  const end = decodeOutput(
    "receipt.settled",
    await local.invoke("receipt.settled", { session, receipt }),
  );

  const wall = Math.round(performance.now() - started);

  expect(end).toMatchObject({ kind: "completed" });

  const fresh = await until(
    async () => {
      const view = await host.session(session).view();

      return desktop.view()?.seq === view.seq && terminal.view()?.seq === view.seq
        ? view
        : undefined;
    },
    20_000,
    "both clients to catch up with the host",
  );

  desktop.close();
  terminal.close();

  expect(terminal.attempts()).toBeGreaterThanOrEqual(2);
  expect(desktop.attempts()).toBe(1);
  expect(desktop.errors).toEqual([]);
  expect(terminal.view()).toEqual(desktop.view());
  expect(transcript(desktop.view())).toEqual(transcript(fresh));
  expect(fresh.messages.at(-1)).toMatchObject({ state: { markdown: RESTAURANT_ANSWER } });
  expect(fresh.execution.kind).toBe("idle");

  for (const frames of [desktop.frames, terminal.frames]) {
    const seqs = frames.map((frame) => Number(frame.kind === "view" ? frame.view.seq : frame.seq));

    expect(seqs).toEqual(seqs.toSorted((a, b) => a - b));
  }

  await savePerturbation("two-clients-relay-reconnect", [waterfall(trace)], {
    perturbation:
      "Two clients watch one session (desktop on the host's HTTP listener, terminal through Nyte Connect's workerd broker); the relay's sockets drop during the places call",
    expected:
      "The relayed watch fails and watches again from a fresh view; both clients end on the same view as the host, with no delta that fails to apply and no seq going back; the local client never notices.",
    observed: `run ${isJsonObject(end) ? JSON.stringify(end.kind) : "?"}; terminal watched ${terminal.attempts()} times (${terminal.errors.join(" | ")}), ${before} frames before the drop and ${terminal.frames.length} in all; desktop watched once with ${desktop.frames.length} frames; final views equal`,
    wallMs: wall,
  });

  await listener.close();
}, 90_000);
