import { asId, isJson, isJsonObject } from "@nyte-ai/schema";
import type { HostView, Json, SessionView } from "@nyte-ai/schema";
import {
  CANCEL_PATH,
  CHANNEL_PATH,
  createTransport,
  parseJson,
  STREAM_HEADER,
} from "@nyte-ai/protocol";
import { afterEach, assert, describe, expect, it } from "vitest";
import { createSendJournal, journalLoop } from "../src/journal.ts";
import { createLink, createRows } from "../src/rows.ts";
import { createHeadViews, watchHead } from "../src/watch.ts";
import { BASE, readOperation, TOKEN_SECRET, until } from "./served.ts";
import {
  answer,
  cleanups,
  client,
  closeOpened,
  open,
  settledChat,
  tapped,
  text,
  users,
} from "./connection.ts";

afterEach(closeOpened);

describe("client streaming", () => {
  it("streams a reply's text as appends on the message the first frame sent, never the whole text again", async () => {
    const host = await open();
    const heads = new Set<string>();
    const appended: string[] = [];

    host.intercept(async (request, next) => {
      if (readOperation(request) === "head.watch") {
        const id = request.headers.get(STREAM_HEADER);
        assert(id !== null);
        heads.add(id);
      }

      const response = await next(request);

      if (readOperation(request) !== CHANNEL_PATH || response.body === null) return response;

      return new Response(
        tapped(response.body, (chunk, id) => {
          if (heads.has(id))
            appended.push(
              ...[...chunk.matchAll(/"append":"(x*)"/g)].map((match) => match[1] ?? ""),
            );
        }),
        response,
      );
    });

    const connection = await client(host);
    const session = await settledChat(host, connection);

    host.fake.reply({
      content: [{ type: "text", text: "x".repeat(400) }],
      tokens: 20,
      tap: () => new Promise((resolve) => setTimeout(resolve, 20)),
    });

    const views: SessionView[] = [];

    const done = until(session.watch(), (view) => {
      views.push(view);

      return view.execution.kind === "idle" && view.messages.length === 4;
    });

    await (await session.send("Stream.")).settled();
    await done;

    expect(appended.length).toBeGreaterThan(5);
    expect(appended.join("").length).toBeLessThanOrEqual(400);
    expect(views.at(-1)?.messages.at(-1)).toMatchObject({ state: { markdown: "x".repeat(400) } });
  });

  it.each(["reset", "end", "disconnect"] as const)(
    "reopens a head.watch after a %s from the host's whole view and reports the link",
    async (cut) => {
      const host = await open();
      const connection = await client(host);
      host.fake.reply(text("One."), text("Two."));

      const { session, receipt: started } = await connection.sessions.start({
        content: "First.",
      });

      await started.settled();
      const opens: string[][] = [];
      const heads = new Map<string, string[]>();
      let firstHead: string | undefined;

      host.intercept(async (request, next) => {
        if (readOperation(request) === "head.watch") {
          const id = request.headers.get(STREAM_HEADER);
          assert(id !== null);
          const kinds: string[] = [];
          opens.push(kinds);
          heads.set(id, kinds);
          firstHead ??= id;
        }

        if (readOperation(request) !== CHANNEL_PATH) return next(request);
        const response = await next(request);
        assert(response.body !== null);

        const body = tapped(
          response.body,
          (chunk, id) =>
            heads
              .get(id)
              ?.push(
                ...[...chunk.matchAll(/^data: \{"kind":"(\w+)"/gm)].map((match) => match[1] ?? ""),
              ),
          cut !== "disconnect"
            ? { after: 1, kind: cut, when: (id) => id === firstHead }
            : undefined,
        );

        return new Response(body, response);
      });

      const link = createLink();
      const links: HostView["link"]["kind"][] = [];
      link.subscribe((state) => links.push(state.kind));

      const rows = createRows(
        createTransport({
          url: BASE,
          headers: async () => ({ Authorization: `Bearer ${TOKEN_SECRET}` }),
          fetch: host.fetch,
        }),
        link,
      );

      cleanups.push(async () => link.close("client"));

      const resumed = until(
        watchHead(createHeadViews(rows), journalLoop(rows, createSendJournal()), {
          session: session.id,
          head: asId("main"),
        }),
        async (view) =>
          JSON.stringify(view) === JSON.stringify(await host.view(session.id)) &&
          users(view).length === 2,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      if (cut === "disconnect") host.listener.disconnectClients();
      await (await session.send("Second.", { delivery: "queue" })).settled();
      const view = await resumed;

      expect(opens.length).toBeGreaterThanOrEqual(2);
      expect(opens.map((kinds) => kinds[0])).toEqual(opens.map(() => "view"));
      expect(users(view)).toEqual(["First.", "Second."]);
      expect(links).toContain("reconnecting");
      expect(links.at(-1)).toBe("connected");
    },
  );

  it("shows a head.watch that starts mid-stream the text streamed before it", async () => {
    const host = await open();
    const writer = await client(host);
    const { session } = await writer.sessions.start({ content: "Hi." });
    const halfway = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();

    host.fake.reply({
      content: [{ type: "text", text: "abcdefgh" }],
      tokens: 4,
      async tap(streamed) {
        if (streamed !== 2) return;
        halfway.resolve();
        await resume.promise;
      },
    });

    const receipt = await session.send("Go.");
    await halfway.promise;
    const reader = await client(host);
    const late = until(reader.session(session.id).watch(), (view) => answer(view) === "abcd");

    expect(answer(await late)).toBe("abcd");
    resume.resolve();
    await receipt.settled();
  });

  it("resumes a head.watch mid-stream with the text streamed in the gap, none of it twice", async () => {
    const host = await open();
    const connection = await client(host);
    const { session } = await connection.sessions.start({ content: "Hi." });
    const first = Promise.withResolvers<void>();
    const gap = Promise.withResolvers<void>();
    const paused = Promise.withResolvers<void>();
    const end = Promise.withResolvers<void>();
    let opens = 0;

    host.fake.reply({
      content: [{ type: "text", text: "abcdefgh" }],
      tokens: 4,
      async tap(streamed) {
        if (streamed === 1) {
          first.resolve();
          await gap.promise;
        }

        if (streamed === 3) {
          paused.resolve();
          await end.promise;
        }
      },
    });

    host.intercept(async (request, next) => {
      if (readOperation(request) === "head.watch" && ++opens === 2) {
        gap.resolve();
        await paused.promise;
      }

      return next(request);
    });

    const seen: string[] = [];

    const settled = until(session.watch(), (view) => {
      const markdown = answer(view);

      if (markdown !== null && markdown !== seen.at(-1)) seen.push(markdown);

      if (markdown === "ab") host.listener.disconnectClients();

      if (markdown === "abcdef") end.resolve();

      return view.execution.kind === "idle" && markdown === "abcdefgh";
    });

    const receipt = await session.send("Go.");
    await first.promise;
    await settled;
    await receipt.settled();

    expect(seen).toEqual(["ab", "abcdef", "abcdefgh"]);
  });

  it("shares one fold per head: two watchers open one head.watch and see the same views, and the last leaving closes it", async () => {
    const host = await open();
    const connection = await client(host);
    const session = await settledChat(host, connection);
    host.fake.reply(text("Shared."));
    let opened = 0;
    let closed = 0;
    const streams = new Set<Json>();

    host.intercept(async (request, next) => {
      if (readOperation(request) === "head.watch") {
        opened += 1;
        streams.add(request.headers.get(STREAM_HEADER));
      }

      if (readOperation(request) === CANCEL_PATH) {
        const body: unknown = await request.clone().json();

        if (isJson(body) && isJsonObject(body) && streams.has(body.stream ?? null)) closed += 1;
      }

      return next(request);
    });

    const done = async (view: SessionView): Promise<boolean> =>
      view.execution.kind === "idle" &&
      view.messages.length === 4 &&
      JSON.stringify(view) === JSON.stringify(await host.view(session.id));

    const first = until(session.watch(), done);
    const second = until(connection.session(session.id).watch(), done);
    await (await session.send("Both.")).settled();
    const [left, right] = await Promise.all([first, second]);

    expect(opened).toBe(1);
    expect(right).toEqual(left);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(1);
  });

  it("sends a session list's changed rows and rebuilds it through additions, renames, moves, removals and a reconnect", async () => {
    const host = await open();
    const watches = new Set<string>();
    const sent = new Map<string, string>();

    host.intercept(async (request, next) => {
      const id = request.headers.get(STREAM_HEADER);

      if (readOperation(request) === "sessions.watch" && id !== null) watches.add(id);
      const response = await next(request);

      if (readOperation(request) !== CHANNEL_PATH || response.body === null) return response;

      return new Response(
        tapped(response.body, (chunk, stream) => {
          if (watches.has(stream)) sent.set(stream, (sent.get(stream) ?? "") + chunk);
        }),
        response,
      );
    });

    const connection = await client(host);
    host.fake.reply(text("One."), text("Two."), text("Three."), text("Again."), text("Four."));
    const watching = connection.sessions.watch()[Symbol.asyncIterator]();

    const shown = async (): Promise<readonly (string | null)[]> => {
      for (;;) {
        const next = await watching.next();
        assert(next.done !== true);

        if (JSON.stringify(next.value) === JSON.stringify((await connection.sessions.list()).items))
          return next.value.map((row) => row.name);
      }
    };

    const frames = (): readonly Json[] =>
      [...sent.values()].flatMap((text) =>
        text
          .split("\n\n")
          .flatMap((block) => (block.startsWith("data: ") ? [parseJson(block.slice(6))] : [])),
      );

    const start = async (name: string) => {
      const { session, receipt } = await connection.sessions.start({ name, content: name });
      await receipt.settled();

      return session;
    };

    expect(await shown()).toEqual([]);
    const alpha = await start("Alpha");
    const beta = await start("Beta");
    await start("Gamma");
    expect(await shown()).toEqual(["Gamma", "Beta", "Alpha"]);

    const before = frames().length;
    await beta.update({ name: "Beta two" });
    expect(await shown()).toEqual(["Gamma", "Beta two", "Alpha"]);

    expect(frames().slice(before)).toEqual([
      {
        kind: "delta",
        order: { runs: [0, 1, -1, 1, 2, 1], items: [beta.id] },
        items: [expect.objectContaining({ id: beta.id, name: "Beta two" })],
      },
    ]);

    const moving = frames().length;
    await (await alpha.send("Again.")).settled();
    expect(await shown()).toEqual(["Alpha", "Gamma", "Beta two"]);

    expect([
      ...new Set(
        frames()
          .slice(moving)
          .flatMap((frame) =>
            isJsonObject(frame) && Array.isArray(frame.items)
              ? frame.items.map((row) => (isJsonObject(row) ? row.name : null))
              : [frame],
          ),
      ),
    ]).toEqual(["Alpha"]);

    const removing = frames().length;
    await beta.remove();
    expect(await shown()).toEqual(["Alpha", "Gamma"]);
    expect(frames().slice(removing)).toEqual([
      { kind: "delta", order: { runs: [0, 2], items: [] }, items: [] },
    ]);

    host.listener.disconnectClients();
    await start("Delta");
    expect(await shown()).toEqual(["Delta", "Alpha", "Gamma"]);
    expect(watches.size).toBe(2);
    expect([...sent.values()].map((text) => text.match(/"kind":"(list|delta)"/)?.[1])).toEqual([
      "list",
      "list",
    ]);
    await watching.return?.();
  });
});
