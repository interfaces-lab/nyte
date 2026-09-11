import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { delimiter, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import process from "node:process";

try {
  const args = process.argv.slice(2);
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!["--filter", "--show", "--binary"].includes(flag) || seen.has(flag))
      throw new Error(`Unknown or repeated argument: ${flag}`);
    seen.add(flag);
    if (flag === "--show") continue;
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    if (flag === "--binary") args[index] = resolve(value);
  }
  if (seen.has("--show") && (!process.stdin.isTTY || !process.stdout.isTTY))
    throw new Error("--show requires terminal stdin and stdout. Run it directly in a terminal.");
  let bun;
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = resolve(directory, "bun");
    try {
      await access(candidate, constants.X_OK);
      bun = candidate;
      break;
    } catch {
      /* Try the next PATH entry. */
    }
  }
  if (!bun) throw new Error("Bun was not found on PATH. Install the version in mise.toml.");
  const root = await mkdtemp(join(tmpdir(), "nyte-terminal-qa-"));
  const home = join(root, "driver-home");
  const guards = join(root, "bin");
  await mkdir(home);
  await mkdir(guards);
  // Never let automated clipboard/editor/browser actions reach the user's desktop.
  for (const command of [
    "pbcopy",
    "pbpaste",
    "xclip",
    "xsel",
    "wl-copy",
    "wl-paste",
    "open",
    "xdg-open",
  ]) {
    await writeFile(
      join(guards, command),
      '#!/bin/sh\necho "Desktop integration is disabled in terminal QA" >&2\nexit 1\n',
      { mode: 0o700 },
    );
  }
  const env = {
    PATH: `${guards}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local/share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local/state"),
    TMPDIR: root,
    TMP: root,
    TEMP: root,
    SHELL: "/bin/sh",
    LANG: "en_US.UTF-8",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    NYTE_QA_ROOT: root,
    NYTE_OFFLINE: "1",
    NYTE_SKIP_VERSION_CHECK: "1",
    BROWSER: "/usr/bin/false",
    EDITOR: "/usr/bin/false",
    VISUAL: "/usr/bin/false",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  process.stderr.write(`Terminal QA evidence: ${root}\n`);
  // No Bun module is loaded until HOME and the environment allowlist are installed.
  const child = spawn(
    bun,
    [
      "--no-env-file",
      "--no-install",
      fileURLToPath(new URL("./main.ts", import.meta.url)),
      ...args,
    ],
    {
      env,
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: "inherit",
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
  });
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\nUsage: pnpm --dir packages/tui run test [--filter text] [--show] [--binary path]\n`,
  );
  process.exitCode = 1;
}
