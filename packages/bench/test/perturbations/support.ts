import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { isPart, readSpans, tool } from "@nyte-ai/core";
import type { Host, Session, SpanName } from "@nyte-ai/core";
import { asId, isJsonObject } from "@nyte-ai/schema";
import type { Json, Message, SessionView, ToolPartState } from "@nyte-ai/schema";
import { assert, expect } from "vitest";
import { buildWaterfall, formatWaterfall } from "../../src/index.ts";
import type { SpanSource, Waterfall, WaterfallRow } from "../../src/index.ts";

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

export interface Watched {
  readonly views: SessionView[];
  close(seq: number): Promise<void>;
}

export function watchViews(session: Session): Watched {
  const views: SessionView[] = [];
  const stop = new AbortController();

  const done = (async () => {
    for await (const view of session.watch()) {
      views.push(view);

      if (stop.signal.aborted) return;
    }
  })();

  return {
    views,
    async close(seq) {
      await until(() => (Number(views.at(-1)?.seq ?? -1) >= seq ? true : undefined));
      stop.abort();
      await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 50))]);
    },
  };
}

export async function expectSettledViews(session: Session, watched: Watched): Promise<SessionView> {
  const final = await session.view();
  await watched.close(Number(final.seq));

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

  const last = watched.views.at(-1);

  assert(last !== undefined);
  expect(projection(last)).toEqual(projection(final));
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

function projection(view: SessionView) {
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
