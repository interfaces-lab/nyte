import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { isPart, readSpans, tool } from "@nyte-ai/core";
import type { Host, Plugin, Session, SpanName } from "@nyte-ai/core";
import { asId, isJsonObject } from "@nyte-ai/schema";
import type { Json, Message, SessionView, ToolPartState } from "@nyte-ai/schema";
import { assert, expect } from "vitest";
import { openHost, sqliteStore } from "../../src/index.ts";
import { buildWaterfall, formatWaterfall } from "../../src/bench/index.ts";
import type { FakeModels, SpanSource, Waterfall, WaterfallRow } from "../../src/bench/index.ts";

const folders: string[] = [];

/** A temp folder removed by `removeFolders`. */
export async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-perturbation-")));
  folders.push(made);

  return made;
}

/** Removes every folder `folder` made. */
export async function removeFolders(): Promise<void> {
  for (const made of folders.splice(0)) await rm(made, { recursive: true, force: true });
}

/** Opens a host on a SQLite store in a temp folder, with the scenario's home, workspace and extra core plugins. */
export async function openScenario(input: {
  readonly fake: FakeModels;
  readonly home: string;
  readonly workspace: string;
  readonly plugins?: readonly Plugin<"core">[];
  readonly store?: string;
}): Promise<Host> {
  return openHost({
    store: sqliteStore({ path: input.store ?? join(await folder(), "nyte.db") }),
    models: input.fake.models,
    workspace: { kind: "local", path: input.workspace },
    home: input.home,
    plugins: input.plugins,
  });
}

/** Sends `prompt` as one traced submit without waiting for it; the trace id is the receipt id. */
export async function submit(session: Session, prompt: string) {
  const trace = crypto.randomUUID();
  const receipt = await session.send(prompt, { id: asId<"receipt">(trace) });

  return { trace, receipt };
}

/** Sets `field` to `value` on every server in `<home>/.nyte/mcp.json`. */
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

/** Polls `read` every 10 ms until it returns something other than undefined, failing after `ms`. */
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

/** The tool parts of a view's messages, in order. */
export function toolStates(messages: readonly Message[]): readonly ToolPartState[] {
  return messages.flatMap((message) => (isPart(message, tool) ? [message.state] : []));
}

/** The settled tool call named `name`, failing when it has not settled. */
export function settledTool(messages: readonly Message[], name: string) {
  const state = toolStates(messages).findLast((candidate) => candidate.name === name);

  assert(state?.phase === "settled", `${name} has not settled.`);

  return state;
}

/** Every view a head's watch yields while it is open. */
export interface Watched {
  readonly views: SessionView[];
  /** Waits until the watch has caught up with `seq`, then ends it. */
  close(seq: number): Promise<void>;
}

/** Watches `session`'s main head, collecting every view, until `close`. */
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

/**
 * Checks what a user sees once a run ends: the watch's views move forward
 * (seq never goes back, no message twice in a view, no part's version goes
 * back), the last watched view matches a fresh `view()` (a client resuming
 * now sees what the watcher sees), the head is idle with every run's turn
 * ended (a pending message's turn has no run, which clients draw as
 * unanswered), and no tool part is left calling or running.
 */
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

/** The first row named each of `names`, each after the one before; fails naming the first missing hop. */
export function expectInOrder(rows: readonly WaterfallRow[], names: readonly SpanName[]): void {
  let from = 0;

  for (const name of names) {
    const found = rows.findIndex((row, index) => index >= from && row.name === name);

    assert(found >= 0, `No ${name} span after ${rows[from - 1]?.name ?? "the start"}.`);
    from = found + 1;
  }
}

/** The host's spans of `trace` with `others`, in one waterfall. */
export function waterfall(trace: string, others: readonly SpanSource[] = []): Waterfall {
  return buildWaterfall(trace, [{ process: "host", spans: readSpans() }, ...others]);
}

/** What one perturbation run records beside its waterfall. */
export interface PerturbationFacts {
  readonly perturbation: string;
  readonly expected: string;
  readonly observed: string;
  readonly wallMs: number;
}

/** Prints each waterfall and, with `NYTE_PERTURBATION_DIR` set, saves them with `facts` as `<name>.json`. */
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
