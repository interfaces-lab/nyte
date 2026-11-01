import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { UPSTREAM } from "./context.js";
import {
  checksumFor,
  downloadVerified,
  installExecutable,
  latestRelease,
  removeQuietly,
} from "./system.js";

const done = (detail) => ({ state: "done", detail });

const todo = (detail) => ({ state: "todo", detail });

const unknown = (detail) => ({ state: "unknown", detail });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const upstreamSlug = `${UPSTREAM.owner}/${UPSTREAM.repo}`;

/**
 * Ubuntu packages: git and download tools, and the libraries Electron loads.
 * 24.04 renamed several libraries for the 64-bit time_t transition.
 */
export function ubuntuPackages(version) {
  const t64 = Number.parseFloat(version) >= 24.04 ? "t64" : "";

  return [
    "git",
    "curl",
    "ca-certificates",
    "unzip",
    "xz-utils",
    "libnss3",
    `libatk1.0-0${t64}`,
    `libatk-bridge2.0-0${t64}`,
    `libcups2${t64}`,
    `libgtk-3-0${t64}`,
    `libasound2${t64}`,
    "libdrm2",
    "libgbm1",
    "libxss1",
    "libxkbcommon0",
    "libxcomposite1",
    "libxdamage1",
    "libxrandr2",
  ];
}

async function missingPackages(ctx) {
  const packages = ubuntuPackages(ctx.os.version);

  const { stdout } = await ctx.exec.capture("dpkg-query", [
    "-W",
    "-f=${Package} ${db:Status-Abbrev}\n",
    ...packages,
  ]);

  const installed = new Set(
    stdout
      .split("\n")
      .filter((line) => line.split(" ")[1]?.startsWith("ii"))
      .map((line) => line.split(" ")[0]),
  );

  return packages.filter((name) => !installed.has(name));
}

/** A command and its arguments, run through sudo unless init already runs as root. */
function asRoot(ctx, command, args) {
  return ctx.sudo === "root" ? [command, args] : ["sudo", [command, ...args]];
}

/** Downloads a GitHub release asset, checks it against the release's checksum file. */
async function fetchRelease(ctx, repository, pick) {
  const release = await latestRelease(repository, ctx.fetch);
  const version = release.tag.replace(/^v/u, "");
  const { asset, checksums } = pick(version, release.tag);
  const url = release.assets.get(asset);
  const listingUrl = release.assets.get(checksums);

  if (url === undefined || listingUrl === undefined) {
    throw new Error(`${repository} ${release.tag} has no ${asset} for this machine.`);
  }

  const listing = await (await ctx.fetch(listingUrl)).text();
  const directory = await mkdtemp(join(tmpdir(), "nyte-init-"));
  const file = join(directory, asset);
  await downloadVerified(url, file, checksumFor(listing, asset), ctx.fetch);

  return { version, directory, file };
}

async function toolVersion(ctx, name, args, pattern) {
  const executable = ctx.which(name);

  if (executable === undefined) return undefined;
  const { code, stdout } = await ctx.exec.capture(executable, args);

  return code === 0 ? (stdout.match(pattern)?.[1] ?? "installed") : undefined;
}

function mise(ctx) {
  return ctx.which("mise") ?? join(ctx.binDir, "mise");
}

/** Runs a command with the checkout's toolchain from mise. */
function inCheckout(ctx, io, command, args) {
  return ctx.exec.run(mise(ctx), ["exec", "--", command, ...args], {
    cwd: ctx.target,
    onLine: io.line,
  });
}

async function git(ctx, args) {
  return ctx.exec.capture("git", ["-C", ctx.target, ...args]);
}

/** The remote that points at interfaces-lab/nyte: upstream in a fork, origin in a clone. */
async function upstreamRemote(ctx) {
  const { code, stdout } = await git(ctx, ["remote", "-v"]);

  if (code !== 0) return undefined;

  const remotes = stdout
    .split("\n")
    .map((line) => line.split(/\s+/u))
    .filter(([, url]) => url !== undefined && /[/:]interfaces-lab\/nyte(\.git)?$/u.test(url))
    .map(([name, url]) => ({ name, url }));

  return remotes.find((remote) => remote.name === "upstream") ?? remotes[0];
}

/** Why the checkout is left alone, or undefined when main is checked out and clean. */
async function leaveAlone(ctx) {
  const branch = (await git(ctx, ["symbolic-ref", "--short", "-q", "HEAD"])).stdout.trim();
  const head = (await git(ctx, ["rev-parse", "--short", "HEAD"])).stdout.trim();

  if (branch === "") return `at ${head}, detached HEAD, left as is`;

  if (branch !== UPSTREAM.branch) return `on ${branch}, left as is`;
  const status = await git(ctx, ["status", "--porcelain", "--untracked-files=no"]);

  if (status.stdout.trim() !== "") return "on main with local changes, left as is";

  return undefined;
}

async function checkCode(ctx) {
  const label = ctx.targetLabel;

  if (!existsSync(ctx.target)) return todo(`${label} doesn't exist`);

  if (!existsSync(join(ctx.target, ".git")))
    return todo(`${label} exists but isn't a git checkout`);
  const remote = await upstreamRemote(ctx);

  if (remote === undefined) return todo(`${label} isn't a checkout of ${upstreamSlug}`);
  const reason = await leaveAlone(ctx);

  if (reason !== undefined) return done(`${label} ${reason}`);

  const remoteHead = await ctx.exec.capture("git", [
    "ls-remote",
    remote.url,
    `refs/heads/${UPSTREAM.branch}`,
  ]);

  const sha = remoteHead.stdout.split(/\s+/u)[0];

  if (remoteHead.code !== 0 || sha === undefined || sha === "") {
    return done(`${label} on main; couldn't reach ${upstreamSlug} to compare`);
  }

  const current = await git(ctx, ["merge-base", "--is-ancestor", sha, "HEAD"]);

  return current.code === 0
    ? done(`${label} on main, current with ${upstreamSlug}`)
    : todo(`${label} main is behind ${upstreamSlug}`);
}

async function applyCode(ctx, io) {
  const label = ctx.targetLabel;

  if (existsSync(ctx.target)) {
    const remote = await upstreamRemote(ctx);

    if (remote === undefined) {
      throw new Error(
        `${label} is in the way: it isn't a checkout of ${upstreamSlug}. Move it, then run init again.`,
      );
    }

    await ctx.exec.run("git", ["-C", ctx.target, "fetch", remote.name, UPSTREAM.branch], {
      onLine: io.line,
    });
    await ctx.exec.run("git", ["-C", ctx.target, "merge", "--ff-only", "FETCH_HEAD"], {
      onLine: io.line,
    });
    const head = (await git(ctx, ["rev-parse", "--short", "HEAD"])).stdout.trim();

    return `Fast-forwarded ${label} main to ${head}`;
  }

  const login = (await ctx.exec.capture("gh", ["api", "user", "--jq", ".login"])).stdout.trim();

  if (login === "") throw new Error("gh isn't logged in. Run gh auth login, then init again.");

  const membership = await ctx.exec.capture("gh", [
    "api",
    `orgs/${UPSTREAM.owner}/members/${login}`,
    "--silent",
  ]);

  if (membership.code === 0) {
    io.line(`${login} is in ${UPSTREAM.owner}, so this is a clone`);
    await ctx.exec.run(
      "gh",
      ["repo", "clone", upstreamSlug, ctx.target, "--", "--branch", UPSTREAM.branch],
      { onLine: io.line },
    );

    return `Cloned ${upstreamSlug} into ${label} on main`;
  }

  io.line(`${login} isn't in ${UPSTREAM.owner}, so this is a fork`);
  await ctx.exec.run("gh", ["repo", "fork", upstreamSlug, "--clone", "--remote"], {
    cwd: dirname(ctx.target),
    onLine: io.line,
  });

  if (!existsSync(ctx.target)) {
    throw new Error(
      `gh cloned your fork under another name than ${label}. Rename it to ${label} and run init again.`,
    );
  }

  await ctx.exec.run("git", ["-C", ctx.target, "checkout", UPSTREAM.branch], { onLine: io.line });

  return `Forked to ${login}/${UPSTREAM.repo}, cloned into ${label} on main`;
}

/** Tools mise.toml asks for, from its [tools] table. */
export function miseTools(toml) {
  const table = toml.split(/^\[tools\]\s*$/mu)[1]?.split(/^\[/mu)[0] ?? "";

  return [...table.matchAll(/^\s*"?([^"=\s]+)"?\s*=/gmu)].map((match) => match[1]);
}

async function checkToolchain(ctx) {
  const config = join(ctx.target, "mise.toml");

  if (!existsSync(config)) return unknown("needs the checkout");

  if (ctx.which("mise") === undefined) return unknown("needs mise");
  const trust = await ctx.exec.capture(mise(ctx), ["trust", "--show"], { cwd: ctx.target });

  if (/untrusted/u.test(trust.stdout)) return todo("mise.toml isn't trusted yet");
  const versions = [];

  for (const tool of miseTools(readFileSync(config, "utf8"))) {
    const where = await ctx.exec.capture(mise(ctx), ["where", tool], { cwd: ctx.target });

    if (where.code !== 0) return todo(`${tool} isn't installed`);

    if (["node", "pnpm", "bun"].includes(tool)) {
      versions.push(`${tool === "node" ? "Node" : tool} ${where.stdout.trim().split("/").pop()}`);
    }
  }

  return done(versions.join(", "));
}

/** The files pnpm compares against its last install to decide it is up to date. */
function manifests(target) {
  const files = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"].map((file) =>
    join(target, file),
  );

  for (const parent of ["packages", join("packages", "examples")]) {
    const directory = join(target, parent);

    if (!existsSync(directory)) continue;

    for (const entry of readdirSafe(directory)) {
      const manifest = join(directory, entry, "package.json");

      if (existsSync(manifest)) files.push(manifest);
    }
  }

  return files;
}

function readdirSafe(directory) {
  try {
    return statSync(directory).isDirectory() ? readdirSync(directory) : [];
  } catch {
    return [];
  }
}

async function checkDependencies(ctx) {
  if (!existsSync(join(ctx.target, "pnpm-lock.yaml"))) return unknown("needs the checkout");
  const statePath = join(ctx.target, "node_modules", ".pnpm-workspace-state-v1.json");

  if (!existsSync(statePath)) return todo("not installed");
  const validated = JSON.parse(readFileSync(statePath, "utf8")).lastValidatedTimestamp ?? 0;
  const stale = manifests(ctx.target).find((file) => statSync(file).mtimeMs > validated);

  return stale === undefined
    ? done(`Dependencies match pnpm-lock.yaml, icons: ${iconSet(ctx)}`)
    : todo(`${stale.slice(ctx.target.length + 1)} changed since the last install`);
}

/** Which icon set the build will use, from the module scripts/icons.mjs wrote. */
function iconSet(ctx) {
  try {
    const selected = readFileSync(join(ctx.target, "packages/ui/src/glyphs/selected.ts"), "utf8");

    return selected.includes('"./central') ? "Central" : "Lucide";
  } catch {
    return "not chosen yet";
  }
}

async function checkTerminalClient(ctx) {
  if (!existsSync(join(ctx.target, "node_modules"))) return unknown("needs the dependencies");

  if (!existsSync(join(ctx.target, "packages/tui/dist/nyte"))) return todo("not built yet");

  const dry = await ctx.exec.capture(
    mise(ctx),
    ["exec", "--", "pnpm", "exec", "turbo", "run", "build", "--filter=@nyte-ai/tui", "--dry=json"],
    { cwd: ctx.target },
  );

  if (dry.code !== 0) return todo("turbo couldn't plan the build");

  try {
    const task = JSON.parse(dry.stdout).tasks.find((t) => t.taskId === "@nyte-ai/tui#build");

    return task?.cache?.status === "HIT"
      ? done("Terminal client built (turbo cache hit)")
      : todo("sources changed since the last build");
  } catch {
    return todo("turbo's plan wasn't readable");
  }
}

function activationLines(ctx) {
  const miseBin = ctx.which("mise") ?? join(ctx.binDir, "mise");
  const needsPath = !ctx.binDirOnPath;

  if (ctx.shell.name === "fish") {
    return [
      ...(needsPath ? ["fish_add_path $HOME/.local/bin"] : []),
      `${miseBin} activate fish | source`,
    ];
  }

  return [
    ...(needsPath ? ['export PATH="$HOME/.local/bin:$PATH"'] : []),
    `eval "$(${miseBin} activate ${ctx.shell.name})"`,
  ];
}

const USERNS_SYSCTL = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";

/**
 * One AppArmor profile per checkout, so a second checkout doesn't replace the
 * first's. Ubuntu's own profiles for Chrome and other Electron apps take this shape.
 */
function sandboxProfile(ctx) {
  const id = createHash("sha256").update(ctx.target).digest("hex").slice(0, 8);
  const electron = `${ctx.target}/node_modules/.pnpm/electron@*/node_modules/electron/dist/electron`;

  return {
    path: `/etc/apparmor.d/nyte-dev-electron-${id}`,
    electron,
    text: [
      "abi <abi/4.0>,",
      "include <tunables/global>",
      "",
      `profile nyte-dev-electron-${id} "${electron}" flags=(unconfined) {`,
      "  userns,",
      `  include if exists <local/nyte-dev-electron-${id}>`,
      "}",
      "",
    ].join("\n"),
  };
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** @type {readonly import("./engine.js").Step[]} */
export const STEPS = [
  {
    id: "platform",
    title: "Platform",
    group: "setup",
    plan: () => "",
    async check(ctx) {
      return done(`${ctx.os.name} ${ctx.os.version} on ${ctx.arch}`.replace("  ", " "));
    },
    async apply() {},
  },
  {
    id: "xcode",
    title: "Xcode Command Line Tools",
    group: "install",
    applies: (ctx) => ctx.platform === "darwin",
    plan: () => "Apple's installer opens",
    person: () => "click through Apple's installer",
    manual: () => "xcode-select --install",
    async check(ctx) {
      const { code, stdout } = await ctx.exec.capture("xcode-select", ["-p"]);

      return code === 0 && existsSync(join(stdout.trim(), "usr", "bin", "git"))
        ? done("Xcode Command Line Tools")
        : todo("not installed");
    },
    async apply(ctx, io) {
      await ctx.exec.capture("xcode-select", ["--install"]);
      io.line("Waiting for Apple's installer to finish…");
      const deadline = Date.now() + 60 * 60_000;

      while (Date.now() < deadline) {
        const { code, stdout } = await ctx.exec.capture("xcode-select", ["-p"]);

        if (code === 0 && existsSync(join(stdout.trim(), "usr", "bin", "git"))) return;
        await sleep(5_000);
      }

      throw new Error("Apple's installer didn't finish within an hour.");
    },
  },
  {
    id: "packages",
    title: "System packages",
    group: "install",
    applies: (ctx) => ctx.platform === "linux",
    plan: () => "apt-get install: git, curl, Electron's libraries",
    person: (ctx) => (ctx.sudo === "password" ? "type your sudo password" : undefined),
    manual: (ctx) => `sudo apt-get install -y ${ubuntuPackages(ctx.os.version).join(" ")}`,
    async check(ctx) {
      if (ctx.which("dpkg-query") === undefined) return todo("needs apt (Ubuntu or Debian)");
      const missing = await missingPackages(ctx);

      return missing.length === 0 ? done("System packages") : todo(`missing ${missing.join(", ")}`);
    },
    async apply(ctx, io) {
      if (ctx.sudo === "missing") throw new Error("Installing packages needs root or sudo.");
      const missing = await missingPackages(ctx);
      const inherit = ctx.sudo === "password";
      const options = { onLine: io.line, inherit };

      if (inherit) io.handOver("sudo asks for your password to run apt-get.");
      await ctx.exec.run(...asRoot(ctx, "apt-get", ["update"]), options);
      await ctx.exec.run(
        ...asRoot(ctx, "apt-get", ["install", "-y", "--no-install-recommends", ...missing]),
        options,
      );

      return `Installed ${missing.length} system packages`;
    },
  },
  {
    id: "gh",
    title: "gh",
    group: "install",
    plan: (ctx) => `into ${ctx.tilde(ctx.binDir)}`,
    async check(ctx) {
      const version = await toolVersion(ctx, "gh", ["--version"], /gh version (\S+)/u);

      return version === undefined ? todo("not installed") : done(`gh ${version}`);
    },
    async apply(ctx, io) {
      const os = ctx.platform === "darwin" ? "macOS" : "linux";
      const arch = ctx.arch === "arm64" ? "arm64" : "amd64";
      const archive = ctx.platform === "darwin" ? "zip" : "tar.gz";

      const { version, directory, file } = await fetchRelease(ctx, "cli/cli", (v) => ({
        asset: `gh_${v}_${os}_${arch}.${archive}`,
        checksums: `gh_${v}_checksums.txt`,
      }));

      try {
        io.line(`Downloaded and verified gh ${version}`);

        const unpack =
          archive === "zip"
            ? ["unzip", ["-q", file, "-d", directory]]
            : ["tar", ["-xzf", file, "-C", directory]];

        await ctx.exec.run(unpack[0], unpack[1], { onLine: io.line });

        const folder = (await readdir(directory)).find(
          (name) => name.startsWith("gh_") && !name.includes("."),
        );

        await installExecutable(join(directory, folder ?? "", "bin", "gh"), join(ctx.binDir, "gh"));
      } finally {
        await removeQuietly(directory);
      }

      return `gh ${version} installed into ${ctx.tilde(ctx.binDir)}`;
    },
  },
  {
    id: "mise",
    title: "mise",
    group: "install",
    plan: (ctx) => `into ${ctx.tilde(ctx.binDir)}`,
    async check(ctx) {
      const version = await toolVersion(ctx, "mise", ["--version"], /^(\d\S*)/u);

      return version === undefined ? todo("not installed") : done(`mise ${version}`);
    },
    async apply(ctx) {
      const os = ctx.platform === "darwin" ? "macos" : "linux";
      const arch = ctx.arch === "arm64" ? "arm64" : "x64";

      const { version, directory, file } = await fetchRelease(ctx, "jdx/mise", (_, tag) => ({
        asset: `mise-${tag}-${os}-${arch}`,
        checksums: "SHASUMS256.txt",
      }));

      try {
        await installExecutable(file, join(ctx.binDir, "mise"));
      } finally {
        await removeQuietly(directory);
      }

      return `mise ${version} installed into ${ctx.tilde(ctx.binDir)}`;
    },
  },
  {
    id: "shell",
    title: "mise in your shell",
    group: "setup",
    after: ["mise"],
    plan: (ctx) => `adds ${activationLines(ctx).length} lines to ${ctx.tilde(ctx.shell.rc)}`,
    async check(ctx) {
      const rc = readText(ctx.shell.rc);
      const activated = /mise(\S*)? activate/u.test(rc);
      const onPath = ctx.binDirOnPath || rc.includes(".local/bin");

      return activated && onPath
        ? done(`mise active in ${ctx.tilde(ctx.shell.rc)}`)
        : todo(`${ctx.tilde(ctx.shell.rc)} doesn't activate mise`);
    },
    async apply(ctx) {
      const rc = readText(ctx.shell.rc);

      const lines = activationLines(ctx).filter((line) =>
        line.includes("activate") ? !/mise(\S*)? activate/u.test(rc) : !rc.includes(".local/bin"),
      );

      const block = [
        "",
        "# Added by npx nyte-ai init: gh and mise on PATH, and mise's Node, pnpm and bun.",
        ...lines,
        "",
      ].join("\n");

      await mkdir(dirname(ctx.shell.rc), { recursive: true });
      await appendFile(ctx.shell.rc, block);
      ctx.shellChanged = true;

      return `Added mise to ${ctx.tilde(ctx.shell.rc)}`;
    },
  },
  {
    id: "login",
    title: "GitHub login",
    group: "setup",
    after: ["gh"],
    // Only getting the code needs GitHub; an existing checkout doesn't.
    applies: (ctx) => !ctx.checkoutAtStart,
    plan: () => "gh auth login, in a browser",
    person: () => "log in to GitHub",
    manual: () => "gh auth login",
    async check(ctx) {
      if (ctx.which("gh") === undefined) return unknown("needs gh");
      const status = await ctx.exec.capture("gh", ["auth", "status", "--hostname", "github.com"]);

      if (status.code !== 0) return todo("not logged in");
      const login = await ctx.exec.capture("gh", ["api", "user", "--jq", ".login"]);

      return done(`Logged in to GitHub as ${login.stdout.trim() || "you"}`);
    },
    async apply(ctx, io) {
      io.handOver("Handing over to gh. Nyte never sees your GitHub token.");
      await ctx.exec.run(
        "gh",
        ["auth", "login", "--hostname", "github.com", "--web", "--git-protocol", "https"],
        { inherit: true },
      );
    },
  },
  {
    id: "code",
    title: "Get the code",
    group: "setup",
    plan: (ctx) =>
      existsSync(ctx.target)
        ? `fast-forward ${ctx.targetLabel} main`
        : `clone if you're in ${UPSTREAM.owner}, else fork, into ${ctx.targetLabel}`,
    check: checkCode,
    apply: applyCode,
  },
  {
    id: "toolchain",
    title: "Node, pnpm, bun",
    group: "setup",
    after: ["code", "mise"],
    plan: () => "mise install",
    check: checkToolchain,
    async apply(ctx, io) {
      await ctx.exec.run(mise(ctx), ["trust", join(ctx.target, "mise.toml")], { onLine: io.line });
      await ctx.exec.run(mise(ctx), ["install"], { cwd: ctx.target, onLine: io.line });
    },
  },
  {
    id: "dependencies",
    title: "Dependencies",
    group: "setup",
    after: ["code", "toolchain"],
    plan: () => "pnpm install",
    check: checkDependencies,
    async apply(ctx, io) {
      await inCheckout(ctx, io, "pnpm", ["install", "--frozen-lockfile"]);
      const set = iconSet(ctx);

      return set === "Lucide"
        ? "Dependencies installed. No Central Icons license, so the build uses Lucide."
        : `Dependencies installed. Icons: ${set}.`;
    },
  },
  {
    id: "sandbox",
    title: "Electron sandbox",
    group: "setup",
    after: ["code"],
    // Ubuntu 23.10 and later stop unprivileged user namespaces, which Electron's sandbox needs.
    applies: (ctx) => ctx.platform === "linux" && existsSync(USERNS_SYSCTL),
    plan: () => "an AppArmor profile that lets the checkout's Electron sandbox itself",
    person: (ctx) => (ctx.sudo === "password" ? "type your sudo password" : undefined),
    manual: (ctx) =>
      `sudo tee ${sandboxProfile(ctx).path} <<'EOF'\n${sandboxProfile(ctx).text}EOF\nsudo apparmor_parser -r ${sandboxProfile(ctx).path}`,
    async check(ctx) {
      if (readText(USERNS_SYSCTL).trim() === "0") return done("Electron sandbox allowed");
      const profile = sandboxProfile(ctx);

      return readText(profile.path).includes(profile.electron)
        ? done(`Electron sandbox allowed by ${profile.path}`)
        : todo("Ubuntu blocks the user namespaces Electron's sandbox needs");
    },
    async apply(ctx, io) {
      if (ctx.sudo === "missing")
        throw new Error("Installing an AppArmor profile needs root or sudo.");
      const profile = sandboxProfile(ctx);
      const directory = await mkdtemp(join(tmpdir(), "nyte-init-"));
      const draft = join(directory, "profile");
      await writeFile(draft, profile.text);
      const inherit = ctx.sudo === "password";

      if (inherit) io.handOver("sudo asks for your password to install an AppArmor profile.");

      try {
        await ctx.exec.run(...asRoot(ctx, "install", ["-m", "644", draft, profile.path]), {
          onLine: io.line,
          inherit,
        });
        await ctx.exec.run(...asRoot(ctx, "apparmor_parser", ["-r", profile.path]), {
          onLine: io.line,
          inherit,
        });
      } finally {
        await removeQuietly(directory);
      }

      return `Electron sandbox allowed by ${profile.path}`;
    },
  },
  {
    id: "tui",
    title: "Terminal client",
    group: "setup",
    after: ["code", "dependencies"],
    plan: () => "pnpm build:tui",
    check: checkTerminalClient,
    async apply(ctx, io) {
      await inCheckout(ctx, io, "pnpm", ["build:tui"]);

      return "Terminal client built";
    },
  },
];

/** The commands that start Nyte from the checkout. */
export function nextCommands(ctx) {
  return [
    ...(ctx.shellChanged ? [`exec ${ctx.shell.name}`] : []),
    ...(ctx.targetLabel === "." ? [] : [`cd ${ctx.targetLabel.slice(2)}`]),
    "pnpm dev:tui",
    "pnpm --dir packages/desktop dev",
  ];
}
