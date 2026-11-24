import { asId } from "@nyte-ai/schema";
import type { ComposeOptions } from "@nyte-ai/core/server";
import { afterEach, expect, it, vi } from "vitest";
import { openRetirement } from "../src/serve/retire.ts";
import { fakeModels } from "./fixtures/fake-models.ts";
import { listen } from "../src/index.ts";
import { cleanups, compose, hello, openSocket, TOKEN } from "./fixtures/socket-client.ts";

const main = asId<"head">("main");

const NEWER_TERMINAL = hello(1, [], "nyte", { kind: "tui", version: "99.0.0" });

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Row {
  readonly name: string;
  readonly execution?: ComposeOptions["execution"];
  readonly run: "none" | "held";
  readonly ending: "hello" | "stop";
  readonly replaced: boolean;
  readonly closing: string | null;
  readonly code: number | null;
  readonly advance: string | null;
}

const rows: readonly Row[] = [
  {
    name: "a newer client of the host's supervisor, with a run streaming",
    run: "held",
    ending: "hello",
    replaced: false,
    closing: null,
    code: null,
    advance: null,
  },
  {
    name: "a newer client of the host's supervisor, with nothing busy",
    run: "none",
    ending: "hello",
    replaced: true,
    closing: "replacing",
    code: 1001,
    advance: null,
  },
  {
    name: "a message sent once the host retired",
    execution: { kind: "admit-only" },
    run: "none",
    ending: "hello",
    replaced: true,
    closing: "replacing",
    code: 1001,
    advance: "retry",
  },
  {
    name: "the host stopping",
    run: "held",
    ending: "stop",
    replaced: false,
    closing: "stopping",
    code: 1001,
    advance: null,
  },
];

it.each(rows)("$name", async (row) => {
  const fake = fakeModels();
  const host = await compose(fake, { execution: row.execution });
  let replaced = false;

  const retirement = openRetirement(host.server, {
    supervisor: "nyte",
    replaced: () => {
      replaced = true;
    },
  });

  cleanups.push(async () => retirement.close());

  const listener = await listen(host, {
    transport: { kind: "http" },
    auth: {
      kind: "token",
      token: TOKEN,
      authority: new Set(["participant", "owner", "maintenance"]),
    },
    retirement,
  });

  cleanups.push(() => listener.close());

  if (row.run === "held") {
    fake.reply({
      content: [{ type: "text", text: "Working." }],
      until: new Promise(() => undefined),
    });
    const { session } = await host.sessions.start({ content: "Go." });
    await expect
      .poll(async () => (await session.view()).execution.kind, { timeout: 5000 })
      .toBe("live");
  }

  const client = await openSocket(listener, NEWER_TERMINAL);
  const welcome = await client.until((frame) => frame.type === "welcome");

  if (row.ending === "stop") await retirement.announce("stopping");
  else if (row.replaced) await expect.poll(() => replaced, { timeout: 5000 }).toBe(true);
  else await expect.poll(async () => host.server.retire()).toBe(false);

  const closed = row.code === null ? null : await client.closed;

  const closing = client.frames.find((frame) => frame.type === "event" && frame.kind === "closing");

  const later = row.advance === null ? null : await host.sessions.start({ content: "Later." });

  const advanced =
    later === null
      ? null
      : await vi.waitFor(async () => {
          const report = await host.execution.advance({ session: later.session.id, head: main });

          if (report.kind === "busy") throw new Error("Another step holds the head.");

          return report;
        });

  expect({
    match: welcome.match,
    replaced,
    closing: closing?.reason ?? null,
    code: closed?.code ?? null,
    advance: advanced?.kind ?? null,
  }).toEqual({
    match: { kind: "host-older", replace: "when-idle" },
    replaced: row.replaced,
    closing: row.closing,
    code: row.code,
    advance: row.advance,
  });
});
