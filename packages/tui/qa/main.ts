import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { open } from "./terminal.ts";
import { scenarios } from "./journeys.ts";
import type { BinaryIdentity, InputRecord, Scenario, Terminal } from "./types.ts";

function distribution(inputs: InputRecord[]) {
  const samples = inputs
    .flatMap((input) => (input.latencyMs === undefined ? [] : [input.latencyMs]))
    .toSorted((a, b) => a - b);
  return {
    count: samples.length,
    unmatched: inputs.length - samples.length,
    p50: samples[Math.max(0, Math.ceil(samples.length * 0.5) - 1)] ?? null,
    p95: samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)] ?? null,
    max: samples.at(-1) ?? null,
  };
}

const inputBudget = { p95Ms: 1000 / 60, maxMs: 50 };

const active = new Set<Terminal>();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.allSettled([...active].map((terminal) => terminal.close())).then(() =>
      process.exit(signal === "SIGINT" ? 130 : 143),
    );
  });
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      binary: { type: "string" },
      filter: { type: "string" },
      show: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const root = process.env.NYTE_QA_ROOT;
  if (!root || !process.env.HOME)
    throw new Error("Launch with node qa/run.mjs so HOME is isolated before imports.");
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined) environment[key] = value;
  const binaryPath = await realpath(
    resolve(values.binary ?? fileURLToPath(new URL("../../../bin/nyte", import.meta.url))),
  );
  const version = Bun.spawn([binaryPath, "--version"], {
    cwd: root,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const versionTimer = globalThis.setTimeout(() => version.kill("SIGKILL"), 10000);
  const [versionText, versionError, versionCode] = await Promise.all([
    new Response(version.stdout).text(),
    new Response(version.stderr).text(),
    version.exited,
  ]);
  clearTimeout(versionTimer);
  if (versionCode !== 0)
    throw new Error(`Binary --version failed (${versionCode}): ${versionError}`);
  const revision = Bun.spawn(
    ["git", "-C", fileURLToPath(new URL("../../..", import.meta.url)), "rev-parse", "HEAD"],
    { env: environment, stdout: "pipe", stderr: "ignore" },
  );
  const revisionText = await new Response(revision.stdout).text();
  const revisionCode = await revision.exited;
  const packageInfo: unknown = JSON.parse(
    await readFile(
      fileURLToPath(new URL("../node_modules/@opentui/core/package.json", import.meta.url)),
      "utf8",
    ),
  );
  if (
    typeof packageInfo !== "object" ||
    packageInfo === null ||
    !("version" in packageInfo) ||
    typeof packageInfo.version !== "string"
  )
    throw new Error("Cannot read installed OpenTUI version.");
  const binary: BinaryIdentity = {
    path: binaryPath,
    sha256: createHash("sha256")
      .update(await readFile(binaryPath))
      .digest("hex"),
    version: versionText.trim(),
    revision: revisionCode === 0 ? revisionText.trim() : "unknown",
    opentui: packageInfo.version,
  };
  process.stdout.write(`${JSON.stringify({ binary })}\n`);
  const selected: Scenario[] = scenarios.filter(
    (scenario) =>
      !values.filter ||
      `${scenario.name} ${scenario.covers.join(" ")}`
        .toLowerCase()
        .includes(values.filter.toLowerCase()),
  );
  if (selected.length === 0)
    throw new Error(`No scenarios match ${JSON.stringify(values.filter ?? "")}.`);
  const results = [];
  for (const [index, scenario] of selected.entries()) {
    const directory = join(root, `case-${index + 1}`);
    const home = join(directory, "home");
    const cwd = join(directory, "workspace");
    await mkdir(home, { recursive: true });
    await mkdir(cwd);
    const env = {
      ...environment,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local/share"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_STATE_HOME: join(home, ".local/state"),
    };
    const terminals: Terminal[] = [];
    let failure: string | undefined;
    const startedAt = performance.now();
    try {
      await scenario.run({
        binary,
        home,
        cwd,
        env,
        show: values.show,
        async open(options = {}) {
          const terminal = await open({
            binary: binary.path,
            cwd,
            env,
            width: 100,
            height: 32,
            ...options,
            show: values.show,
          });
          terminals.push(terminal);
          active.add(terminal);
          return terminal;
        },
      });
    } catch (error) {
      // Bun can render a wrapped error's stack without its message; keep both.
      failure =
        error instanceof Error
          ? error.stack?.includes(error.message)
            ? error.stack
            : `${error.message}\n${error.stack ?? ""}`
          : String(error);
    }
    const screens = terminals.map((terminal) => terminal.screen());
    for (const terminal of terminals) {
      try {
        await terminal.close();
      } catch (error) {
        failure = `${failure ?? ""}\nCleanup failed: ${String(error)}`;
      }
      active.delete(terminal);
    }
    const inputs = terminals.flatMap((terminal) => terminal.inputs);
    const actions = Object.fromEntries(
      [...new Set(inputs.map((input) => input.action))].map((action) => [
        action,
        distribution(inputs.filter((input) => input.action === action)),
      ]),
    );
    for (const action of scenario.localInputs ?? []) {
      const measured = actions[action];
      if (!measured || measured.count === 0 || measured.unmatched > 0) {
        failure = `${failure ?? ""}\nLocal input ${action} has missing screen measurements.`;
        continue;
      }
      if (
        measured.p95 !== null &&
        measured.max !== null &&
        (measured.p95 > inputBudget.p95Ms || measured.max > inputBudget.maxMs)
      ) {
        failure = `${failure ?? ""}\nLocal input ${action}: p95 ${measured.p95.toFixed(2)} ms, max ${measured.max.toFixed(2)} ms exceeds ${inputBudget.p95Ms.toFixed(2)}/${inputBudget.maxMs} ms budget.`;
      }
    }
    const result = {
      name: scenario.name,
      covers: scenario.covers,
      status: failure ? "fail" : "pass",
      failure,
      durationMs: performance.now() - startedAt,
      latency: distribution(inputs),
      actions,
      localInputBudget: scenario.localInputs
        ? { ...inputBudget, actions: scenario.localInputs }
        : undefined,
    };
    await writeFile(
      join(directory, "evidence.json"),
      JSON.stringify(
        {
          ...result,
          binary,
          terminals: await Promise.all(
            terminals.map(async (terminal, terminalIndex) => ({
              screen: screens[terminalIndex],
              inputs: terminal.inputs,
              chunks: terminal.chunks,
              exitCode: await terminal.exited,
            })),
          ),
        },
        null,
        2,
      ),
    );
    results.push(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
  await writeFile(join(root, "report.json"), JSON.stringify({ binary, results }, null, 2));
  const failed = results.filter((result) => result.status === "fail").length;
  process.stdout.write(
    `${results.length - failed}/${results.length} cases passed. ${failed} failed. Report: ${join(root, "report.json")}\n`,
  );
  process.exitCode = failed ? 1 : 0;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await Promise.allSettled([...active].map((terminal) => terminal.close()));
}
