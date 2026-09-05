/**
 * Manual sandbox for the bundled CLI.
 *
 *   pnpm --dir packages/tui sandbox
 *   pnpm --dir packages/tui sandbox --scenario long
 *   pnpm --dir packages/tui sandbox --no-build --keep
 *
 * Compiles the real binary, seeds a throwaway world with fixture transcripts,
 * and hands you the production TUI in your own terminal. Your real `~/.uji` and
 * the repo's own session database are never touched: the child process gets its
 * own `UJI_HOME` and runs in a temporary workspace that is deleted on exit.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { startMockProvider } from "./provider.ts";
import { findScenario, SCENARIOS } from "./scenarios.ts";
import { createSandbox, seedHome, seedSessions } from "./seed.ts";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..", "..");
const BINARY = resolve(PACKAGE_ROOT, "..", "..", "bin", "uji");

function run(command: string, args: readonly string[], cwd: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${command} exited with ${String(code)}`)),
    );
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      scenario: { type: "string", default: "tools" },
      "no-build": { type: "boolean", default: false },
      keep: { type: "boolean", default: false },
      list: { type: "boolean", default: false },
    },
  });

  if (values.list === true) {
    for (const entry of SCENARIOS) {
      process.stdout.write(`${entry.id.padEnd(8)} ${entry.title} — ${entry.summary}\n`);
    }
    return;
  }

  const scenario = findScenario(values.scenario ?? "tools");

  if (values["no-build"] !== true) {
    process.stdout.write("building bundled binary…\n");
    await run("pnpm", ["run", "build:binary"], PACKAGE_ROOT);
  }

  const provider = await startMockProvider();
  const root = await mkdtemp(join(tmpdir(), "uji-sandbox-"));
  let sessions = 0;
  try {
    const sandbox = await createSandbox(root, scenario);
    await seedHome(sandbox, provider.baseUrl);
    sessions = await seedSessions(sandbox, scenario);

    process.stdout.write(
      [
        "",
        `  scenario   ${scenario.id} — ${scenario.title}`,
        `  sessions   ${String(sessions)} seeded (open the session picker to switch)`,
        `  workspace  ${sandbox.workspace}`,
        `  provider   ${provider.baseUrl} (local mock)`,
        "",
        "  Live replies are steered by what you type:",
        "    bash <cmd>   read <path>   think …   long …   slow …   fail …",
        "",
      ].join("\n"),
    );

    await run(BINARY, ["--resume"], sandbox.workspace).catch(() => undefined);
  } finally {
    await provider.close();
    if (values.keep === true) process.stdout.write(`\nsandbox kept at ${root}\n`);
    else await rm(root, { recursive: true, force: true });
  }
}

await main();
