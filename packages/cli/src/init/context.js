import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { basename, delimiter, join } from "node:path";

/** The repository init sets up, and the org whose members clone instead of fork. */
export const UPSTREAM = { owner: "interfaces-lab", repo: "nyte", branch: "main" };

/** Shortens a path under home to `~/…` for display. */
export function tilde(path, home) {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** The first executable named `name` on `path`, or undefined. */
export function findExecutable(name, path) {
  for (const directory of (path ?? "").split(delimiter)) {
    if (directory === "") continue;
    const candidate = join(directory, name);

    try {
      accessSync(candidate, constants.X_OK);

      return candidate;
    } catch {}
  }

  return undefined;
}

function readOsRelease() {
  try {
    const fields = Object.fromEntries(
      readFileSync("/etc/os-release", "utf8")
        .split("\n")
        .map((line) => line.match(/^([A-Z_]+)=(.*)$/u))
        .filter((match) => match !== null)
        .map(([, key, value]) => [key, value.replace(/^"|"$/gu, "")]),
    );

    return { name: fields.NAME ?? "Linux", id: fields.ID ?? "", version: fields.VERSION_ID ?? "" };
  } catch {
    return { name: "Linux", id: "", version: "" };
  }
}

/** The rc file mise activation goes in, and the syntax it takes. */
export function detectShell(env, home) {
  const name = basename(env.SHELL ?? "");

  if (name === "zsh") return { name, rc: join(env.ZDOTDIR ?? home, ".zshrc") };

  if (name === "fish") return { name, rc: join(home, ".config", "fish", "config.fish") };

  return { name: "bash", rc: join(home, ".bashrc") };
}

/** True when `directory` is a git checkout whose package.json is the nyte workspace root. */
export function holdsNyteCheckout(directory) {
  if (!existsSync(join(directory, ".git"))) return false;

  try {
    return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).name === "nyte";
  } catch {
    return false;
  }
}

/**
 * Everything the steps read about this machine. Child processes get
 * ~/.local/bin first on PATH, so a tool installed earlier in the run is
 * found by the next step.
 *
 * `binDirOnPath` says whether the user's own shell already finds
 * ~/.local/bin. `checkoutAtStart` is decided once, so the plan and the apply
 * loop agree on whether a GitHub login is needed. `sudo` is "root",
 * "passwordless", "password" or "missing"; init fills it in on Linux.
 * `shellChanged` is set by the shell step when it edits an rc file, so the
 * next commands say to reload the shell.
 */
export function createContext({ env, cwd, home, platform, arch, interactive }) {
  const binDir = join(home, ".local", "bin");
  const originalPath = env.PATH ?? "";

  const path = [binDir, ...originalPath.split(delimiter).filter((entry) => entry !== binDir)].join(
    delimiter,
  );

  const inCheckout = holdsNyteCheckout(cwd);
  const target = inCheckout ? cwd : join(cwd, UPSTREAM.repo);
  const os = platform === "linux" ? readOsRelease() : { name: "macOS", id: "macos", version: "" };

  return {
    platform,
    arch,
    home,
    cwd,
    binDir,
    interactive,
    os,
    shell: detectShell(env, home),
    binDirOnPath: originalPath.split(delimiter).includes(binDir),
    target,
    targetLabel: inCheckout ? "." : `./${UPSTREAM.repo}`,
    checkoutAtStart: inCheckout || existsSync(target),
    env: { ...env, PATH: path },
    sudo: "missing",
    shellChanged: false,
    tilde: (p) => tilde(p, home),
    which: (name) => findExecutable(name, path),
  };
}
