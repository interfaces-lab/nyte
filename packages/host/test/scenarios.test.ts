import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { clearSpans, enableTracing, isPart, readSpans, tool } from "@nyte-ai/core";
import type { Host, Session, SpanDetail, SpanName } from "@nyte-ai/core";
import { compileCanvas } from "@nyte-ai/plugin/core/canvas-compile";
import { asId } from "@nyte-ai/schema";
import { afterEach, assert, beforeAll, expect, it } from "vitest";
import { openHost, sqliteStore } from "../src/index.ts";
import {
  buildWaterfall,
  CI_ANSWER,
  CI_CANVAS,
  CI_PROMPT,
  ciHome,
  ciRepo,
  ciScript,
  fakeModels,
  formatWaterfall,
  lastToolText,
  readSpanFile,
  RESTAURANT_ANSWER,
  RESTAURANT_CANVAS,
  RESTAURANT_PROMPT,
  restaurantHome,
  restaurantScript,
} from "../src/bench/index.ts";
import type { FakeModels, Script, Waterfall, WaterfallRow } from "../src/bench/index.ts";

const folders: string[] = [];

beforeAll(() => enableTracing());

afterEach(async () => {
  clearSpans();

  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-scenario-run-")));
  folders.push(made);

  return made;
}

/** Opens a host on a SQLite store in a temp folder, the local workspace `workspace` and the scenario's home. */
async function openScenario(input: {
  readonly fake: FakeModels;
  readonly home: string;
  readonly workspace: string;
}): Promise<Host> {
  return openHost({
    store: sqliteStore({ path: join(await folder(), "nyte.db") }),
    models: input.fake.models,
    workspace: { kind: "local", path: input.workspace },
    home: input.home,
  });
}

/** Sends `prompt` as one traced submit and waits for its run; the trace id is the receipt id. */
async function submit(host: Host, prompt: string): Promise<{ trace: string; session: Session }> {
  const session = await host.sessions.create();
  const trace = crypto.randomUUID();
  await (await session.send(prompt, { id: asId<"receipt">(trace) })).settled();

  return { trace, session };
}

/** The first row named each of `names`, each after the one before; fails naming the first missing hop. */
function expectInOrder(rows: readonly WaterfallRow[], names: readonly SpanName[]): void {
  let from = 0;

  for (const name of names) {
    const found = rows.findIndex((row, index) => index >= from && row.name === name);

    assert(found >= 0, `No ${name} span after ${rows[from - 1]?.name ?? "the start"}.`);
    from = found + 1;
  }
}

/** What a scenario run records beside its waterfall. */
interface RunFacts {
  readonly scenario: "U" | "D";
  readonly prompt: string;
  readonly route: string;
  readonly wallMs: number;
  readonly requests: number;
  readonly terminal?: readonly {
    readonly name: string;
    readonly duration: number;
    readonly detail: SpanDetail;
  }[];
}

async function saveWaterfall(name: string, waterfall: Waterfall, facts: RunFacts): Promise<void> {
  console.log(formatWaterfall(waterfall));
  const directory = process.env.NYTE_WATERFALL_DIR;

  if (directory === undefined) return;
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${name}.json`),
    `${JSON.stringify({ ...facts, ...waterfall }, null, 2)}\n`,
  );
}

/** Checks every step answered and the session ends with `answer`. */
async function expectFinished(turns: Script, session: Session, answer: string): Promise<void> {
  expect(turns.pending()).toEqual([]);
  const last = (await session.view()).messages.at(-1);

  assert(last?.kind === "part" && last.partKind === "text");
  expect(last.state).toMatchObject({ markdown: answer });
}

it("compiles both scenarios' canvases", async () => {
  const restaurant = await compileCanvas(RESTAURANT_CANVAS);
  const ci = await compileCanvas(CI_CANVAS);

  expect(restaurant).toMatchObject({ kind: "compiled" });
  expect(ci).toMatchObject({ kind: "compiled" });
});

it("runs scenario U: skill, places MCP, canvas, answer, one trace across host and MCP child", async () => {
  await using home = await restaurantHome({ route: "direct" });
  const turns = restaurantScript({ skill: home.skills["restaurant-picker"], route: "direct" });
  const fake = fakeModels({ fallback: turns.answer });
  await using host = await openScenario({ fake, home: home.home, workspace: await folder() });
  const started = performance.now();

  const { trace, session } = await submit(host, RESTAURANT_PROMPT);
  const wall = performance.now() - started;

  await expectFinished(turns, session, RESTAURANT_ANSWER);
  expect(lastToolText(fake.requests[2])).toContain("luigi");

  const view = await session.view();
  const parts = view.messages.flatMap((message) => (message.kind === "part" ? [message] : []));

  expect(parts.map((part) => part.partKind)).toContain("canvas");
  expect(parts.filter((part) => isPart(part, tool)).length).toBe(3);

  const child = await readSpanFile(home.traceFile);
  expect(child.map((span) => span.trace)).toEqual([trace]);

  const waterfall = buildWaterfall(trace, [
    { process: "host", spans: readSpans() },
    { process: "mcp:places", spans: child },
  ]);

  expectInOrder(waterfall.rows, [
    "host.admit",
    "turn.start",
    "model.stream",
    "tool.run",
    "turn.start",
    "mcp.call",
    "mcp.serve",
    "turn.start",
    "canvas.compile",
    "part.publish",
    "turn.start",
    "model.stream",
  ]);

  const call = waterfall.rows.find((row) => row.name === "mcp.call");
  const served = waterfall.rows.find((row) => row.name === "mcp.serve");

  assert(call !== undefined && served !== undefined);
  expect(served.at).toBeGreaterThanOrEqual(call.at - 5);
  expect(served.at + served.duration).toBeLessThanOrEqual(call.at + call.duration + 5);
  expect(waterfall.rows.some((row) => row.name === "mcp.connect" && !row.traced)).toBe(true);

  expect(
    waterfall.rows.some(
      (row) => row.name === "part.publish" && String(row.detail.parts).includes("canvas"),
    ),
  ).toBe(true);

  await saveWaterfall("scenario-U", waterfall, {
    scenario: "U",
    prompt: RESTAURANT_PROMPT,
    route: "direct",
    wallMs: Math.round(wall * 100) / 100,
    requests: fake.requests.length,
  });
});

it("runs scenario U through codemode, the MCP call nested in the script", async () => {
  await using home = await restaurantHome({ route: "codemode" });
  const turns = restaurantScript({ skill: home.skills["restaurant-picker"], route: "codemode" });
  const fake = fakeModels({ fallback: turns.answer });
  await using host = await openScenario({ fake, home: home.home, workspace: await folder() });

  const { trace, session } = await submit(host, RESTAURANT_PROMPT);

  await expectFinished(turns, session, RESTAURANT_ANSWER);
  expect(lastToolText(fake.requests[2])).toContain("luigi");
  expect((await readSpanFile(home.traceFile)).map((span) => span.trace)).toEqual([trace]);
  expectInOrder(buildWaterfall(trace, [{ process: "host", spans: readSpans() }]).rows, [
    "tool.run",
    "tool.run",
    "mcp.call",
    "canvas.compile",
  ]);
});

it("runs scenario D over the CI MCP server: log tail, canvas, test, fix, rerun, diff, commit", async () => {
  await using repo = await ciRepo();
  await using home = await ciHome({ route: "mcp" });
  const turns = ciScript({ skill: home.skills["ci-triage"], route: "mcp" });
  const fake = fakeModels({ fallback: turns.answer });
  await using host = await openScenario({ fake, home: home.home, workspace: repo.root });
  const started = performance.now();

  const { trace, session } = await submit(host, CI_PROMPT);
  const wall = performance.now() - started;

  await expectFinished(turns, session, CI_ANSWER);

  const texts = fake.requests.map(lastToolText);
  const log = texts.find((text) => text.includes("characters cut from the middle"));

  assert(log !== undefined, "The job log never reached the model.");
  expect(log).toContain("-1 !== 3");
  expect(log).toContain("##[error]Process completed with exit code 1.");
  expect(texts.filter((text) => text.endsWith("[exit code 1]")).at(-1)).toContain("ℹ fail 1");
  expect(texts.at(-1)).toMatch(/ℹ pass 1[^]*\[exit code 0\]$/);

  const info = await session.info();
  const git = await host.workspace(info.workspace).git();

  assert(git.kind === "available");
  const changes = await git.api.changes({ kind: "worktree" });

  expect(changes.files.map((file) => file.path)).toEqual(["src/sum.js"]);
  expect(await git.api.commit({ message: "Fix sum", files: "all" })).toMatchObject({
    kind: "applied",
  });
  expect((await git.api.changes({ kind: "worktree" })).files).toEqual([]);
  expect((await git.api.log()).items).toHaveLength(2);

  const job = await host.workspace(info.workspace).jobs.start({
    command: "node --test",
    session: info.id,
    pty: { columns: 100, rows: 30 },
  });

  const output: string[] = [];

  for await (const frame of job.output()) {
    if (frame.kind === "exit") break;

    if (frame.kind === "bytes") output.push(new TextDecoder().decode(frame.data));
  }

  expect(output.join("")).toContain("pass 1");

  const terminal = readSpans().filter(
    (span) => span.name.startsWith("pty.") && span.trace === null,
  );
  expect(terminal.map((span) => [span.name, span.detail.pty ?? null])).toEqual([
    ["pty.spawn", true],
    ["pty.output", null],
  ]);

  const child = await readSpanFile(home.traceFile);
  expect(child.map((span) => span.trace)).toEqual([trace, trace]);

  const waterfall = buildWaterfall(trace, [
    { process: "host", spans: readSpans(trace) },
    { process: "mcp:ci", spans: child },
  ]);

  expectInOrder(waterfall.rows, [
    "host.admit",
    "turn.start",
    "tool.run",
    "mcp.call",
    "mcp.serve",
    "mcp.call",
    "mcp.serve",
    "canvas.compile",
    "part.publish",
    "pty.spawn",
    "pty.output",
    "tool.run",
    "pty.spawn",
    "pty.output",
    "model.stream",
  ]);

  expect(
    waterfall.rows.filter((row) => row.name === "pty.spawn").map((row) => row.detail.pty),
  ).toEqual([false, false]);

  await saveWaterfall("scenario-D", waterfall, {
    scenario: "D",
    prompt: CI_PROMPT,
    route: "mcp",
    wallMs: Math.round(wall * 100) / 100,
    requests: fake.requests.length,
    terminal: terminal.map((span) => ({
      name: span.name,
      duration: Math.round(span.duration * 100) / 100,
      detail: span.detail,
    })),
  });
});

it("runs scenario D through gh when no CI server is configured", async () => {
  await using repo = await ciRepo();
  await using home = await ciHome({ route: "gh" });
  const turns = ciScript({ skill: home.skills["ci-triage"], route: "gh" });
  const fake = fakeModels({ fallback: turns.answer });
  await using host = await openScenario({ fake, home: home.home, workspace: repo.root });
  const path = process.env.PATH;
  process.env.PATH = repo.path;

  try {
    const { trace, session } = await submit(host, CI_PROMPT);

    await expectFinished(turns, session, CI_ANSWER);
    expect(
      fake.requests.map(lastToolText).find((text) => text.includes("##[error]Process completed")),
    ).toMatch(/^\[truncated: the first \d+ bytes of output are not shown\][^]*-1 !== 3/);
    expect(
      buildWaterfall(trace, [{ process: "host", spans: readSpans(trace) }]).rows.filter(
        (row) => row.name === "pty.spawn",
      ),
    ).toHaveLength(4);
  } finally {
    process.env.PATH = path;
  }
});
