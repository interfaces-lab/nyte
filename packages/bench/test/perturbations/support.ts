import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { isPart, readSpans, tool } from "@nyte-ai/core";
import type { Host, Session, SpanName } from "@nyte-ai/core";
import { decodeOutput, encodeInput, openHostSocket, openSessionStore } from "@nyte-ai/protocol";
import type { SessionStore } from "@nyte-ai/protocol";
import {
  asId,
  compile,
  isJsonObject,
  SessionChangeType,
  SOCKET_PATH,
  withJson,
} from "@nyte-ai/schema";
import type { Json, Message, SessionChange, SessionView, ToolPartState } from "@nyte-ai/schema";
import { assert, expect } from "vitest";
import WebSocket from "ws";
import { buildWaterfall, formatWaterfall } from "../../src/index.ts";
import type { Simulation, SpanSource, Waterfall, WaterfallRow } from "../../src/index.ts";

const folders: string[] = [];

export async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-perturbation-")));
  folders.push(made);

  return made;
}

export async function removeFolders(): Promise<void> {
  for (const made of folders.splice(0))
    await rm(made, { recursive: true, force: true, maxRetries: 10 });
}

export async function start(host: Host, prompt: string) {
  const trace = crypto.randomUUID();

  const { session, receipt } = await host.sessions.start({
    id: asId<"session">(trace),
    content: prompt,
  });

  return { trace, session, receipt };
}

export async function submit(session: Session, prompt: string) {
  const trace = crypto.randomUUID();
  const receipt = await session.send(prompt, { id: asId<"receipt">(trace) });

  return { trace, receipt };
}

export async function setServerField(home: string, field: string, value: Json): Promise<void> {
  const path = join(home, ".nyte", "mcp.json");
  const file: Json = JSON.parse(await readFile(path, "utf8"));

  assert(isJsonObject(file) && isJsonObject(file.mcpServers));

  const servers = Object.entries(file.mcpServers).map(([name, entry]) => {
    assert(isJsonObject(entry));

    return [name, { ...entry, [field]: value }];
  });

  await writeFile(path, JSON.stringify({ mcpServers: Object.fromEntries(servers) }, null, 2));
}

export async function until<T>(
  read: () => Promise<T | undefined> | T | undefined,
  ms = 10_000,
  what = "the condition",
): Promise<T> {
  const deadline = Date.now() + ms;

  for (;;) {
    const value = await read();

    if (value !== undefined) return value;

    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function toolStates(messages: readonly Message[]): readonly ToolPartState[] {
  return messages.flatMap((message) => (isPart(message, tool) ? [message.state] : []));
}

export function settledTool(messages: readonly Message[], name: string) {
  const state = toolStates(messages).findLast((candidate) => candidate.name === name);

  assert(state?.phase === "settled", `${name} has not settled.`);

  return state;
}

type Shown = Pick<SessionView, "messages"> & { readonly seq: number };

export interface Watched {
  readonly views: readonly Shown[];
  close(final: Pick<SessionView, "messages">): Promise<void>;
}

const changes = compile(withJson(SessionChangeType));

export async function watchViews(simulation: Simulation, session: Session): Promise<Watched> {
  const listening = await simulation.drive({ kind: "listen" });

  assert(listening.kind === "listening");
  const url = new URL(SOCKET_PATH, listening.url);
  url.protocol = "ws:";

  const socket = await openHostSocket({
    socket: new WebSocket(url.href, { headers: { Authorization: `Bearer ${listening.token}` } }),
    client: { kind: "other", name: "perturbation", version: "0.0.0", actions: [] },
  });

  const scope = `session/${session.id}`;
  const views: Shown[] = [];
  const pending: SessionChange[] = [];
  let store: SessionStore | null = null;

  const show = (current: SessionStore): void => {
    const snapshot = current.snapshot();

    views.push({
      seq: current.seq,
      messages: snapshot.order.flatMap((id) => {
        const message = snapshot.rows.messages.get(id);

        return message === undefined ? [] : [message];
      }),
    });
  };

  const read = async (): Promise<void> => {
    store = null;

    const window = decodeOutput(
      "head.read",
      await socket.call(
        "head.read",
        encodeInput("head.read", {
          session: session.id,
          head: session.name,
          window: { tail: 200 },
        }),
      ),
    );

    const opened = openSessionStore(window);
    store = opened;

    for (const change of pending.splice(0)) opened.apply(change);
    show(opened);
  };

  socket.onEvent((event) => {
    if (event.scope !== scope || event.kind !== "change" || !changes.Check(event)) return;

    if (store === null) {
      pending.push(event);

      return;
    }

    store.apply(event);

    if (store.stale) void read();
    else show(store);
  });

  await socket.call("events.subscribe", { scopes: [scope] });
  await read();

  return {
    views,
    async close(final) {
      const shown = JSON.stringify(projection(final));

      await until(
        () =>
          JSON.stringify(projection(views.at(-1) ?? { messages: [] })) === shown ? true : undefined,
        10_000,
        "the client's view to match the host's",
      );
      socket.close();
    },
  };
}

export async function expectSettledViews(session: Session, watched: Watched): Promise<SessionView> {
  const final = await session.view();
  await watched.close(final);

  let seq = -1;
  const versions = new Map<string, number>();

  for (const view of watched.views) {
    expect(Number(view.seq)).toBeGreaterThanOrEqual(seq);
    seq = Number(view.seq);
    const ids = view.messages.map((message) => message.id);

    expect(new Set(ids).size, "a message appears twice in one view").toBe(ids.length);

    for (const message of view.messages) {
      if (message.kind !== "part") continue;
      const before = versions.get(message.part) ?? -1;

      expect(message.version, `part ${message.part} went back a version`).toBeGreaterThanOrEqual(
        before,
      );
      versions.set(message.part, message.version);
    }
  }

  expect(final.execution.kind).toBe("idle");
  expect(
    final.turns.flatMap((turn) => (turn.run === null ? [] : [turn.state.kind])),
    "a run's turn is still working or waiting",
  ).toEqual(final.turns.flatMap((turn) => (turn.run === null ? [] : ["ended"])));
  expect(
    toolStates(final.messages).filter((state) => state.phase !== "settled"),
    "a tool part is still calling or running",
  ).toEqual([]);

  return final;
}

function projection(view: Pick<SessionView, "messages">) {
  return view.messages.map((message) =>
    message.kind === "part"
      ? { id: message.id, kind: message.partKind, version: message.version }
      : { id: message.id, kind: "user", status: message.status.kind },
  );
}

export function expectInOrder(rows: readonly WaterfallRow[], names: readonly SpanName[]): void {
  let from = 0;

  for (const name of names) {
    const found = rows.findIndex((row, index) => index >= from && row.name === name);

    assert(found >= 0, `No ${name} span after ${rows[from - 1]?.name ?? "the start"}.`);
    from = found + 1;
  }
}

export function waterfall(trace: string, others: readonly SpanSource[] = []): Waterfall {
  return buildWaterfall(trace, [{ process: "host", spans: readSpans() }, ...others]);
}

export interface PerturbationFacts {
  readonly perturbation: string;
  readonly expected: string;
  readonly observed: string;
  readonly wallMs: number;
}

export async function savePerturbation(
  name: string,
  traces: readonly Waterfall[],
  facts: PerturbationFacts,
): Promise<void> {
  console.log(
    `${facts.perturbation}\n${traces.map((traced) => formatWaterfall(traced)).join("\n\n")}`,
  );
  const directory = process.env.NYTE_PERTURBATION_DIR;

  if (directory === undefined) return;
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${name}.json`),
    `${JSON.stringify({ ...facts, traces }, null, 2)}\n`,
  );
}
