import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

export const PLACES_SERVER = join(import.meta.dirname, "places-mcp.mjs");

export const CI_SERVER = join(import.meta.dirname, "ci-mcp.mjs");

export const GH_CLI = join(import.meta.dirname, "gh.mjs");

export interface FixtureServer {
  readonly script: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly exposure?: "direct" | "codemode";
}

export interface ScenarioHome extends AsyncDisposable {
  readonly home: string;
  readonly traceFile: string;
  readonly skills: Readonly<Record<string, string>>;
}

export async function scenarioHome(input: {
  readonly servers: Readonly<Record<string, FixtureServer>>;
  readonly skills: Readonly<Record<string, string>>;
  readonly root?: string;
}): Promise<ScenarioHome> {
  const home = await realpath(await mkdtemp(join(input.root ?? tmpdir(), "nyte-scenario-")));
  const traceFile = join(home, "mcp-spans.jsonl");
  await mkdir(join(home, ".nyte"), { recursive: true });
  await writeFile(traceFile, "");

  const electron = process.versions.electron === undefined ? {} : { ELECTRON_RUN_AS_NODE: "1" };

  const mcpServers = Object.fromEntries(
    Object.entries(input.servers).map(([name, server]) => [
      name,
      {
        command: process.execPath,
        args: [server.script],
        env: { ...electron, ...server.env, NYTE_TRACE_FILE: traceFile },
        exposure: server.exposure ?? "direct",
      },
    ]),
  );

  await writeFile(join(home, ".nyte", "mcp.json"), JSON.stringify({ mcpServers }, null, 2));
  const skills: Record<string, string> = {};

  for (const [name, body] of Object.entries(input.skills)) {
    const folder = join(home, ".agents", "skills", name);
    await mkdir(folder, { recursive: true });
    skills[name] = join(folder, "SKILL.md");
    await writeFile(skills[name], body);
  }

  return {
    home,
    traceFile,
    skills,
    async [Symbol.asyncDispose]() {
      await stopHomeProcesses(home);
      await rm(home, { recursive: true, force: true, maxRetries: 10 });
    },
  };
}

const STOP_MS = 10_000;

export async function stopHomeProcesses(home: string): Promise<void> {
  for (const pid of processesIn(home)) signal(pid, "SIGTERM");
  const deadline = Date.now() + STOP_MS;

  while (processesIn(home).length > 0) {
    if (Date.now() > deadline) {
      for (const pid of processesIn(home)) signal(pid, "SIGKILL");

      return;
    }

    await sleep(50);
  }
}

function processesIn(home: string): readonly number[] {
  if (process.platform === "win32") return [];

  const listed = spawnSync("ps", ["axeww", "-o", "pid=,command="], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  if (listed.error !== undefined) throw listed.error;

  return listed.stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s.*\sHOME=(\S+)/u.exec(line);
    const pid = Number(match?.[1]);

    return match?.[2] === home && pid !== process.pid ? [pid] : [];
  });
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) throw cause;
  }
}

export async function nodeShim(folder: string, name: string, script: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  const electron = process.versions.electron !== undefined;

  if (process.platform === "win32") {
    const path = join(folder, `${name}.cmd`);
    await writeFile(
      path,
      `@echo off\r\n${electron ? "set ELECTRON_RUN_AS_NODE=1\r\n" : ""}"${process.execPath}" "${script}" %*\r\n`,
    );

    return path;
  }

  const path = join(folder, name);

  await writeFile(
    path,
    `#!/bin/sh\n${electron ? "ELECTRON_RUN_AS_NODE=1 " : ""}exec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`,
  );
  await chmod(path, 0o755);

  return path;
}
