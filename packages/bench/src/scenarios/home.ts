import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

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
    [Symbol.asyncDispose]: () => rm(home, { recursive: true, force: true }),
  };
}

export async function nodeShim(folder: string, name: string, script: string): Promise<string> {
  const path = join(folder, name);
  await mkdir(folder, { recursive: true });

  const electron = process.versions.electron === undefined ? "" : "ELECTRON_RUN_AS_NODE=1 ";

  await writeFile(
    path,
    `#!/bin/sh\n${electron}exec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`,
  );
  await chmod(path, 0o755);

  return path;
}
