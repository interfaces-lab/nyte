// node scripts/build.mjs [--package <electron-builder args>]
import { spawn } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import packageMetadata from "../package.json" with { type: "json" };
import { artifacts } from "./artifacts.mjs";
import {
  bold,
  dim,
  failure,
  formatDuration,
  formatBytes,
  green,
  heading,
  lineLog,
  livePanel,
  success,
  table,
} from "./terminal.mjs";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);

const packageIndex = args.indexOf("--package");

const shouldPackage = packageIndex !== -1;

const builderArgs = shouldPackage ? args.slice(packageIndex + 1) : [];

// A terminal gets a live tail of each long stage. Turbo's stream output
// prefixes lines and ignores cursor movement, so it gets one line per change.
// Anything else (CI, a piped log) gets every line the tools print, folded per
// stage on GitHub Actions.
const turboStream = process.env.TURBO_HASH !== undefined && process.env.TURBO_IS_TUI === undefined;

const live = process.stdout.isTTY === true && !turboStream;

const githubActions = process.env.GITHUB_ACTIONS === "true";

let panel;

// Under Turbo, package depends on build, so out/ is already current or was
// restored from cache. Ad-block lists are not cached and stay in both paths.
const compiled = shouldPackage && process.env.TURBO_HASH !== undefined;

const stages = [{ title: "Ad-block lists", run: () => node("scripts/build-adblock.mjs") }];

if (!compiled) {
  stages.push(
    {
      title: "Compile main, preload, renderer",
      tail: true,
      run: () => pnpm("electron-vite", "build", "--logLevel", "info"),
    },
    { title: "Startup budgets", run: () => node("scripts/check-startup-bundle.mjs") },
  );
}

if (shouldPackage) {
  stages.push({
    title: `Package ${builderArgs.length > 0 ? builderArgs.join(" ") : "for this platform"}`,
    tail: true,
    run: () => pnpm("electron-builder", "--config", "electron-builder.config.ts", ...builderArgs),
  });
}

const outputDir = join(desktopRoot, shouldPackage ? "dist" : "out");

process.stdout.write(
  `${bold(`${packageMetadata.name} ${packageMetadata.version}`)} ${dim(`→ ${relative(process.cwd(), outputDir) || "."}`)}\n`,
);

const started = performance.now();

const packageStartedAt = Date.now();

for (const [index, stage] of stages.entries()) {
  const step = `${index + 1}/${stages.length}`;

  if (githubActions) process.stdout.write(`::group::${step} ${stage.title}\n`);
  else heading(step, stage.title);
  const stageStarted = performance.now();
  panel =
    stage.tail === true ? (live ? livePanel() : turboStream ? lineLog() : undefined) : undefined;
  const { code, output } = await stage.run();
  const elapsed = formatDuration(performance.now() - stageStarted);

  if (githubActions) process.stdout.write("::endgroup::\n");

  if (code !== 0) {
    if (output !== undefined) process.stdout.write(output);
    failure(`${stage.title} failed ${dim(`(exit ${code}, ${elapsed})`)}`);
    process.exit(code);
  }

  success(`${stage.title} ${dim(elapsed)}`);
}

process.stdout.write(`\n${green("Done")} ${dim(formatDuration(performance.now() - started))}\n`);

process.stdout.write(`${outputDir}\n`);

if (shouldPackage) {
  const rows = artifacts(outputDir, packageStartedAt).map(({ name, size }) => [
    name,
    size === undefined ? "" : dim(formatBytes(size)),
  ]);

  process.stdout.write(table(rows, { align: ["left", "right"] }));
}

function node(script, ...rest) {
  return run(process.execPath, [join(desktopRoot, script), ...rest]);
}

function pnpm(...rest) {
  // spawn() does not resolve `.cmd` shims; npm_execpath is a native binary, not JS.
  // Windows additionally refuses to launch a `.cmd` without a shell, so ask for
  // one there. Every argument below is a bare flag, so shell quoting is moot.
  return process.platform === "win32"
    ? run("pnpm.cmd", ["exec", ...rest], { shell: true })
    : run("pnpm", ["exec", ...rest]);
}

function run(command, commandArgs, options) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: desktopRoot,
      stdio: panel === undefined ? "inherit" : ["inherit", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: live ? "1" : process.env.FORCE_COLOR },
      ...options,
    });

    const push = (chunk) => panel?.push(chunk.toString());
    child.stdout?.on("data", push);
    child.stderr?.on("data", push);
    const interrupt = () => child.kill("SIGINT");
    process.once("SIGINT", interrupt);

    const finish = (code, signal) => {
      process.removeListener("SIGINT", interrupt);
      const output = panel?.stop();
      panel = undefined;

      if (signal !== null) process.kill(process.pid, signal);
      resolve({ code, output });
    };

    child.on("error", (error) => {
      failure(error.message);
      finish(1, null);
    });
    child.on("close", (code, signal) => finish(code ?? 1, signal));
  });
}
