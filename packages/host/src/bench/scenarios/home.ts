import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

/** The places fixture MCP server (`search_places`); its knobs are listed at the top of the file. */
export const PLACES_SERVER = join(import.meta.dirname, "places-mcp.mjs");

/** The GitHub-like CI fixture MCP server (`list_check_runs`, `get_job_logs`). */
export const CI_SERVER = join(import.meta.dirname, "ci-mcp.mjs");

/** The `gh` stand-in answering `gh pr checks` and `gh run view <job> --log-failed`. */
export const GH_CLI = join(import.meta.dirname, "gh.mjs");

/** One stdio server for a scenario's `mcp.json`. */
export interface FixtureServer {
  readonly script: string;
  readonly env?: Readonly<Record<string, string>>;
  /** `direct` declares the tools to the model, `codemode` only inside codemode scripts; default `direct`. */
  readonly exposure?: "direct" | "codemode";
}

/** A temporary home holding a scenario's `.nyte/mcp.json` and skills. */
export interface ScenarioHome extends AsyncDisposable {
  readonly home: string;
  /** The file the fixture servers append their `mcp.serve` spans to. */
  readonly traceFile: string;
  /** Each skill's `SKILL.md`, by skill name. */
  readonly skills: Readonly<Record<string, string>>;
}

/**
 * Creates a home under `root` (default the system temp folder) with
 * `servers` in `<home>/.nyte/mcp.json`, each run by this process's Node
 * (as Node under Electron) with `NYTE_TRACE_FILE` set, and each skill body
 * at `<home>/.agents/skills/<name>/SKILL.md`. Disposing it removes the home.
 */
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

/** Writes an executable `name` into `folder` that runs `script` with this process's Node. */
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
