import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { PERMISSIONS } from "@nyte-ai/plugin/approvals/schema";
import { expect, it } from "vitest";
import {
  afterTool,
  afterUser,
  fakeModels,
  PLACES_SERVER,
  PLACES_TOOL,
  scenarioHome,
  script,
  simulate,
} from "../src/index.ts";
import type { SimulationOutcome } from "../src/index.ts";

const run = promisify(execFile);

async function descendants(): Promise<readonly string[]> {
  const { stdout } =
    process.platform === "win32"
      ? await run("powershell.exe", [
          "-NoProfile",
          "-Command",
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)" }',
        ])
      : await run("ps", ["-axo", "pid=,ppid=,command="]);

  const rows = stdout.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);

    return match === null
      ? []
      : [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" }];
  });

  const tree = new Set([process.pid]);

  for (let grown = true; grown;) {
    grown = false;

    for (const row of rows)
      if (
        tree.has(row.ppid) &&
        !tree.has(row.pid) &&
        !row.command.startsWith("ps ") &&
        !row.command.includes("Win32_Process")
      ) {
        tree.add(row.pid);
        grown = true;
      }
  }

  return rows.flatMap((row) => (row.pid !== process.pid && tree.has(row.pid) ? [row.command] : []));
}

async function settledProcesses(
  matches: (commands: readonly string[]) => boolean,
): Promise<readonly string[]> {
  for (let poll = 0; poll < 500; poll += 1) {
    const commands = await descendants();

    if (matches(commands)) return commands;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return descendants();
}

it("drives a host over its stdio control channel, one JSON command a line, and exits once stdin closes", async () => {
  const child = spawn(
    process.execPath,
    [join(import.meta.dirname, "..", "scripts", "simulate.ts")],
    {
      stdio: ["pipe", "pipe", "inherit"],
    },
  );

  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();

  const next = async (): Promise<Record<string, unknown>> => {
    const line = await lines.next();

    if (line.done === true) throw new Error("The control channel closed.");

    return JSON.parse(line.value);
  };

  const ask = async (command: unknown) => {
    child.stdin.write(`${JSON.stringify(command)}\n`);

    return next();
  };

  expect(await next()).toMatchObject({ kind: "ready" });
  const sent = await ask({ kind: "send", text: "hi there" });

  expect(sent).toMatchObject({ kind: "sent" });
  expect(await ask({ kind: "settle", session: sent["session"] })).toMatchObject({
    kind: "view",
    view: { messages: [{ kind: "user" }, { kind: "part", state: { markdown: "Echo: hi there" } }] },
  });
  expect(await ask({ kind: "bogus" })).toMatchObject({ kind: "error" });
  expect(await ask({ kind: "kill" })).toEqual({ kind: "killed" });
  expect(await ask({ kind: "list" })).toMatchObject({ kind: "error", message: /down/u });
  expect(await ask({ kind: "restart" })).toEqual({ kind: "restarted" });
  expect(await ask({ kind: "list" })).toMatchObject({
    kind: "list",
    sessions: [{ id: sent["session"] }],
  });

  child.stdin.end();
  const [code] = await once(child, "exit");

  expect(code).toBe(0);
}, 30_000);

it("stops a running command with the run and leaves no process behind once the host is killed, its MCP server included", async () => {
  await using home = await scenarioHome({
    servers: { places: { script: PLACES_SERVER } },
    skills: {},
  });

  const turns = script([
    {
      name: "sleep",
      when: afterUser,
      reply: {
        content: [
          {
            type: "toolCall",
            id: "sleep",
            name: "bash",
            arguments: { command: "sleep 987.654", description: "Wait" },
          },
        ],
      },
    },
    {
      name: "search",
      when: afterUser,
      reply: {
        content: [
          { type: "toolCall", id: "search", name: PLACES_TOOL, arguments: { near: "here" } },
        ],
      },
    },
    {
      name: "answer",
      when: afterTool(PLACES_TOOL),
      reply: { content: [{ type: "text", text: "Found one." }] },
    },
  ]);

  await using simulation = await simulate({
    models: fakeModels({ fallback: turns.answer }).models,
    home: home.home,
  });

  expect(await simulation.host.settings.apply(PERMISSIONS, "ask")).toEqual({ kind: "applied" });

  const started: SimulationOutcome = await simulation.drive({ kind: "send", text: "wait a while" });

  if (started.kind !== "sent") throw new Error(`Expected sent, got ${started.kind}.`);
  const session = started.session;

  expect(await simulation.drive({ kind: "approve", session, decision: "once" })).toEqual({
    kind: "approved",
    tool: "bash",
  });
  expect(
    await settledProcesses((commands) => commands.some((command) => command.includes("987.654"))),
  ).toContainEqual(expect.stringContaining("sleep 987.654"));

  expect(await simulation.drive({ kind: "interrupt", session })).toEqual({
    kind: "stopped",
    runs: 1,
  });
  expect(
    await settledProcesses((commands) => !commands.some((command) => command.includes("987.654"))),
  ).not.toContainEqual(expect.stringContaining("987.654"));

  expect(await simulation.host.settings.apply(PERMISSIONS, "full")).toEqual({ kind: "applied" });
  await simulation.drive({ kind: "send", session, text: "find a place" });
  await simulation.drive({ kind: "settle", session });

  expect(turns.pending()).toEqual([]);
  expect(await descendants()).toContainEqual(expect.stringContaining(PLACES_SERVER));

  await simulation.drive({ kind: "kill" });
  expect(await settledProcesses((commands) => commands.length === 0)).toEqual([]);
}, 60_000);
