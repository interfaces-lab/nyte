import { homedir } from "node:os";
import process from "node:process";

import { createContext } from "./context.js";
import { EXIT, runSteps } from "./engine.js";
import { STEPS, nextCommands } from "./steps.js";
import { createExec, openLog } from "./system.js";
import { clackUI, plainUI } from "./ui.js";

export const USAGE = `Usage: npx nyte-ai init [--yes] [--check]

Sets up a Nyte checkout in ./nyte: gh, mise, the GitHub login, the code,
Node, pnpm and bun, dependencies, and a first build of the terminal client.
It shows the whole plan and asks once before changing anything. Run it again
at any time: steps that are done are skipped, so a failed run continues.

  --yes     apply without asking; a step that needs a person stops the run
  --check   print the plan and change nothing

Exit codes: 0 ready or nothing to do, 1 a step failed or --check found work,
2 a step needs a person and there's no terminal, 130 cancelled.`;

export function parseInitArgs(args) {
  const flags = { yes: false, check: false, help: false };

  for (const arg of args) {
    if (arg === "--yes" || arg === "-y") flags.yes = true;
    else if (arg === "--check") flags.check = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else throw new Error(`Unknown option ${arg}.\n\n${USAGE}`);
  }

  return flags;
}

function githubFetch(env) {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;

  return (url, init = {}) => {
    const headers = new Headers(init.headers);

    if (token && String(url).startsWith("https://api.github.com/")) {
      headers.set("authorization", `Bearer ${token}`);
    }

    return globalThis.fetch(url, { ...init, headers });
  };
}

async function sudoAccess(ctx) {
  if (process.getuid?.() === 0) return "root";

  if (ctx.which("sudo") === undefined) return "missing";

  return (await ctx.exec.capture("sudo", ["-n", "true"])).code === 0 ? "passwordless" : "password";
}

/**
 * On Ctrl-C the child in the foreground gets the same SIGINT and stops, and
 * its step reports that; init only notes it here.
 *
 * @param {readonly string[]} args  Arguments after `init`.
 * @returns {Promise<number>} The exit code.
 */
export async function init(args, options = {}) {
  const flags = parseInitArgs(args);

  if (flags.help) {
    process.stdout.write(`${USAGE}\n`);

    return EXIT.ready;
  }

  const platform = options.platform ?? process.platform;

  if (platform !== "darwin" && platform !== "linux") {
    process.stderr.write(`nyte init sets up macOS and Ubuntu. This is ${platform}.\n`);

    return EXIT.failed;
  }

  const env = options.env ?? process.env;

  const interactive =
    options.interactive ?? (Boolean(process.stdin.isTTY && process.stdout.isTTY) && !env.CI);

  const home = options.home ?? homedir();

  const ctx = createContext({
    env,
    cwd: options.cwd ?? process.cwd(),
    home,
    platform,
    arch: options.arch ?? process.arch,
    interactive,
  });

  ctx.log = openLog(home);
  ctx.exec = createExec({ env: ctx.env, log: ctx.log });
  ctx.fetch = options.fetch ?? githubFetch(env);

  if (platform === "linux") ctx.sudo = await sudoAccess(ctx);

  if (platform === "darwin") {
    ctx.os.version = (await ctx.exec.capture("sw_vers", ["-productVersion"])).stdout.trim();
  }

  ctx.log.write(`nyte init ${args.join(" ")} on ${platform} ${ctx.arch}, target ${ctx.target}`);

  const next = () => nextCommands(ctx);
  const ui = interactive ? clackUI(ctx, next) : plainUI(ctx, next);
  let interrupted = false;

  const onInterrupt = () => {
    interrupted = true;
  };

  process.on("SIGINT", onInterrupt);

  try {
    return await runSteps({
      steps: options.steps ?? STEPS,
      ctx,
      ui,
      yes: flags.yes,
      checkOnly: flags.check,
      interactive,
      interrupted: () => interrupted,
    });
  } finally {
    process.off("SIGINT", onInterrupt);
  }
}
