/** Channels in flight: credit-based flow control, body limits, cancellation, and revocation. See `relay-fixture.ts`. */
import { randomBytes } from "node:crypto";
import { BROKER_ROUTES } from "@nyte-ai/connect";
import {
  RELAY_BODY_LIMIT_BYTES,
  RELAY_CHUNK_BYTES,
  RELAY_CLOSE,
  RELAY_WINDOW_BYTES,
  decodeChunk,
  encodeChunks,
} from "@nyte-ai/connect/relay";
import { RelayDesktop } from "./workerd.ts";
import { describe, expect, it } from "vitest";
import {
  enrolled,
  phone,
  wireError,
  refused,
  settle,
  waitFor,
  RELAY_EXPOSED,
  expectCors,
  broker,
  withWorkerdRelay,
  abortBeforeHeadKeepsSocket,
  answerUntilReset,
} from "./relay-fixture.ts";

withWorkerdRelay();

describe("flow control", () => {
  it("streams an upload in chunks within the desktop's credit, and no further", async () => {
    const { environmentId, desktop, bearer } = await enrolled();
    const upload = new Uint8Array(randomBytes(RELAY_WINDOW_BYTES * 2 + 1000));

    desktop.handler = undefined;
    const answer = phone({ environmentId, bearer }, "/files.upload", {
      method: "POST",
      body: upload,
    });
    const { ch } = await desktop.next("open");
    const received: Uint8Array[] = [];
    const take = async () => {
      const frame = await desktop.next("data", (data) => data.ch === ch);
      const bytes = decodeChunk(frame.data);

      expect(bytes?.byteLength).toBeLessThanOrEqual(RELAY_CHUNK_BYTES);
      received.push(bytes ?? new Uint8Array());
    };
    const total = () => received.reduce((sum, bytes) => sum + bytes.byteLength, 0);

    while (total() < RELAY_WINDOW_BYTES) await take();
    await settle();
    expect(total()).toBe(RELAY_WINDOW_BYTES);
    expect(desktop.pending("data")).toEqual([]);
    expect(desktop.pending("end")).toEqual([]);

    desktop.send({ t: "credit", ch, bytes: RELAY_WINDOW_BYTES });

    while (total() < RELAY_WINDOW_BYTES * 2) await take();
    await settle();
    expect(total()).toBe(RELAY_WINDOW_BYTES * 2);
    desktop.send({ t: "credit", ch, bytes: RELAY_WINDOW_BYTES });

    while (total() < upload.byteLength) await take();
    await desktop.next("end", (end) => end.ch === ch);
    expect(Buffer.concat(received).equals(Buffer.from(upload))).toBe(true);
    desktop.send({ t: "head", ch, status: 200, headers: {} });
    desktop.send({ t: "end", ch });
    expect((await answer).status).toBe(200);
  });

  it("refuses a streamed body past the limit with 413 and resets the channel", async () => {
    const { environmentId, desktop, bearer } = await enrolled();
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > RELAY_BODY_LIMIT_BYTES + RELAY_CHUNK_BYTES) {
          controller.close();

          return;
        }
        sent += 65_536;
        controller.enqueue(new Uint8Array(65_536));
      },
    });
    const answer = await phone({ environmentId, bearer }, "/files.upload", {
      method: "POST",
      body,
      duplex: "half",
    });

    expect(await wireError(answer)).toEqual(refused(413, "payload_too_large"));
    const opened = desktop.received.find(
      (frame) => frame.t === "open" && frame.path === "/files.upload",
    );

    await waitFor(async () =>
      desktop.received.some(
        (frame) => frame.t === "reset" && opened?.t === "open" && frame.ch === opened.ch,
      ),
    );
  }, 20_000);

  it("returns response credit only for bytes it passed on, and delivers a large answer intact", async () => {
    const large = new Uint8Array(randomBytes(RELAY_WINDOW_BYTES * 4));
    const { environmentId, desktop, bearer } = await enrolled(async () => ({
      status: 200,
      body: large,
    }));
    const before = desktop.received.length;
    const answer = await phone({ environmentId, bearer }, "/files.bytes");
    const reader = answer.body?.getReader();
    const chunks: Uint8Array[] = [];

    for (;;) {
      const next = await reader?.read();

      if (next === undefined || next.done) break;
      chunks.push(next.value);
      await settle(5);
    }

    expect(Buffer.concat(chunks).equals(Buffer.from(large))).toBe(true);
    const granted = desktop.received
      .slice(before)
      .reduce((sum, frame) => sum + (frame.t === "credit" ? frame.bytes : 0), 0);

    expect(granted).toBeLessThanOrEqual(large.byteLength);
  });

  it("closes a desktop that grants past the window or answers out of phase", async () => {
    const cases: [string, (desktop: RelayDesktop, ch: string) => void][] = [
      [
        "credit past the window",
        (desktop, ch) => desktop.send({ t: "credit", ch, bytes: RELAY_WINDOW_BYTES }),
      ],
      [
        "data before head",
        (desktop, ch) =>
          desktop.send({ t: "data", ch, data: encodeChunks(new Uint8Array([1]))[0] ?? "" }),
      ],
      [
        "a redirect",
        (desktop, ch) =>
          desktop.socket.send(JSON.stringify({ t: "head", ch, status: 302, headers: {} })),
      ],
      [
        "a cookie",
        (desktop, ch) =>
          desktop.socket.send(
            JSON.stringify({ t: "head", ch, status: 200, headers: { "set-cookie": "a=b" } }),
          ),
      ],
      [
        "data after a bodyless head",
        (desktop, ch) => {
          desktop.send({ t: "head", ch, status: 204, headers: {} });
          desktop.send({ t: "data", ch, data: encodeChunks(new Uint8Array([1]))[0] ?? "" });
        },
      ],
      [
        "a second head",
        (desktop, ch) => {
          desktop.send({ t: "head", ch, status: 200, headers: {} });
          desktop.send({ t: "head", ch, status: 200, headers: {} });
        },
      ],
    ];

    for (const [label, act] of cases) {
      const { environmentId, desktop, bearer } = await enrolled();

      desktop.handler = undefined;
      const answer = phone({ environmentId, bearer }, "/sessions.list", {
        method: "POST",
        body: "{}",
      }).catch(() => undefined);
      const { ch } = await desktop.next("open");

      act(desktop, ch);
      expect({ label, code: (await desktop.closed).code }).toEqual({
        label,
        code: RELAY_CLOSE.invalid,
      });
      await answer.then((response) => response?.body?.cancel());
      await broker.reset();
    }
  });
});

describe("cancellation and revocation", () => {
  it.skipIf(abortBeforeHeadKeepsSocket)(
    "resets the desktop's channel when the phone goes away before the response head",
    async () => {
      const { environmentId, desktop, bearer } = await enrolled();

      desktop.handler = undefined;
      const abort = new AbortController();
      const answer = phone({ environmentId, bearer }, "/head.view", { signal: abort.signal }).catch(
        (error: unknown) => error,
      );
      const { ch } = await desktop.next("open");
      abort.abort();
      await answer;
      await answerUntilReset(desktop, [ch], "send");
    },
  );

  it.each([undefined, "https://app.nyte.sh"])(
    "resets the desktop channel when a client with Origin %s goes away mid-stream",
    async (origin) => {
      const { environmentId, desktop, bearer } = await enrolled();

      desktop.handler = undefined;
      const abort = new AbortController();
      const answer = phone({ environmentId, bearer }, "/head.watch", {
        signal: abort.signal,
        headers: origin === undefined ? {} : { origin },
      });
      const { ch } = await desktop.next("open");

      desktop.send({
        t: "head",
        ch,
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });

      for (const data of encodeChunks(new TextEncoder().encode("data: one\n\n")))
        desktop.send({ t: "data", ch, data });
      const response = await answer;
      const reader = response.body?.getReader();

      expect(new TextDecoder().decode((await reader?.read())?.value)).toBe("data: one\n\n");
      if (origin !== undefined) expectCors(response, origin, RELAY_EXPOSED);
      abort.abort();
      await answerUntilReset(desktop, [ch], "sent");
    },
  );

  it("ends a revoked device's open channels at once and refuses its bearer after", async () => {
    const { environmentId, desktop, bearer, deviceId } = await enrolled();

    desktop.handler = undefined;
    const answer = phone({ environmentId, bearer }, "/head.watch");
    const { ch } = await desktop.next("open");

    desktop.send({ t: "head", ch, status: 200, headers: { "content-type": "text/event-stream" } });
    const response = await answer;
    const reader = response.body?.getReader();
    const revoked = await broker.fetch(
      `${broker.origin}${BROKER_ROUTES.device(environmentId, deviceId)}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${await broker.sessionToken({ userId: "user_alice", sessionId: "sess_laptop" })}`,
        },
      },
    );

    expect(revoked.status).toBe(204);
    await desktop.next("reset", (reset) => reset.ch === ch);
    expect(
      await reader?.read().then(
        (next) => next.done,
        () => true,
      ),
    ).toBe(true);
    expect(await wireError(await phone({ environmentId, bearer }, "/sessions.list"))).toEqual(
      refused(401, "unauthorized"),
    );
    expect(desktop.socket.readyState).toBe(WebSocket.OPEN);
  });
});
