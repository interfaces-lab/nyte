import { execFile } from "node:child_process";
import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import type { BundledCli } from "@nyte-ai/app/contract/bridge.ts";

const execute = promisify(execFile);

const MACH_O_CPUS = new Map([
  [0x0100000c, "arm64"],
  [0x01000007, "x64"],
]);

const ELF_MACHINES = new Map([
  [183, "arm64"],
  [62, "x64"],
]);

function commandLink(home: string): string {
  return join(home, ".nyte", "bin", "nyte");
}

type PathChange =
  | { readonly kind: "present"; readonly file: string }
  | { readonly kind: "added"; readonly file: string }
  | { readonly kind: "manual"; readonly line: string };

export async function stageCli(options: {
  readonly resources: string;
  readonly stages: string;
}): Promise<string> {
  const version = (await readFile(join(options.resources, "nyte.version"), "utf8")).trim();
  const directory = join(options.stages, `${version}-${process.arch}`.replace(/[^\w.-]/gu, "-"));
  const staged = join(directory, "nyte");

  if ((await stat(staged).catch(() => undefined))?.isFile() === true) return staged;
  await mkdir(directory, { recursive: true });
  const temporary = `${staged}.tmp`;

  try {
    await copyFile(join(options.resources, "nyte"), temporary);
    await chmod(temporary, 0o755);
    await rename(temporary, staged);
  } catch (cause) {
    await rm(temporary, { force: true });

    throw cause;
  }

  return staged;
}

/** Checks the CLI in `resources` the way packaging does: present, native to this machine, running at Nyte's version, and on macOS validly signed. */
export async function inspectBundledCli(options: {
  readonly resources: string;
  readonly packaged: boolean;
  readonly appVersion: string;
}): Promise<BundledCli> {
  if (!options.packaged)
    return { kind: "unavailable", problem: "Development builds don't include the CLI." };

  if (process.platform === "win32")
    return { kind: "unavailable", problem: "Nyte for Windows doesn't include the CLI." };
  const path = join(options.resources, "nyte");

  const file = await stat(path).catch((cause: unknown) => {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined;

    throw cause;
  });

  if (file?.isFile() !== true)
    return { kind: "unavailable", problem: `${path} is missing. Reinstall Nyte to restore it.` };
  const architecture = await nativeArchitecture(path);

  if (architecture === undefined)
    return {
      kind: "unavailable",
      problem: `${path} isn't a native executable. Reinstall Nyte to restore it.`,
    };

  if (architecture !== process.arch)
    return {
      kind: "unavailable",
      problem: `The included CLI is built for ${architecture}, but Nyte runs as ${process.arch}. Reinstall Nyte.`,
    };

  const ran = await execute(path, ["--version"], { timeout: 10_000 }).catch(
    (cause: unknown) => new Error(failure(cause)),
  );

  if (ran instanceof Error)
    return { kind: "unavailable", problem: `The included CLI doesn't run: ${ran.message}` };
  const version = ran.stdout.trim();

  if (version !== options.appVersion)
    return {
      kind: "unavailable",
      problem: `The included CLI is ${version}, but Nyte is ${options.appVersion}. Reinstall Nyte to match them.`,
    };
  const signature = await codeSignature(path);

  if (signature instanceof Error)
    return {
      kind: "unavailable",
      problem: `The included CLI's signature isn't valid: ${signature.message}`,
    };

  return { kind: "ready", version, path, architecture, signature };
}

async function nativeArchitecture(path: string): Promise<string | undefined> {
  const file = await open(path);
  const { buffer } = await file.read(Buffer.alloc(20), 0, 20, 0).finally(() => file.close());

  if (buffer.readUInt32BE(0) === 0xcffaedfe) return MACH_O_CPUS.get(buffer.readUInt32LE(4));

  if (buffer.readUInt32BE(0) === 0x7f454c46 && buffer[5] === 1)
    return ELF_MACHINES.get(buffer.readUInt16LE(18));

  return undefined;
}

async function codeSignature(path: string): Promise<string | Error> {
  if (process.platform !== "darwin") return "Not signed";

  const verified = await execute("codesign", ["--verify", "--strict", path]).catch(
    (cause: unknown) => new Error(failure(cause)),
  );

  if (verified instanceof Error) return verified;
  const described = await execute("codesign", ["--display", "--verbose=2", path]);
  const lines = described.stderr.split("\n");
  const authority = lines.find((line) => line.startsWith("Authority="));

  if (authority !== undefined) return authority.slice("Authority=".length);

  return lines.includes("Signature=adhoc") ? "Ad hoc" : "Signed";
}

/** Node words a failed command as `Command failed: <command>` and its stderr; the stderr says why. */
function failure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const stderr = message.split("\n").slice(1).join(" ").trim();

  return stderr === "" ? message : stderr;
}

export async function adoptStagedCli(home: string, staged: string): Promise<void> {
  const current = dirname(staged);
  const stages = dirname(current);
  const linked = await readlink(commandLink(home)).catch(() => undefined);

  if (linked?.startsWith(`${stages}/`) === true) await linkCli(home, staged);

  for (const entry of await readdir(stages))
    if (join(stages, entry) !== current)
      await rm(join(stages, entry), { recursive: true, force: true });
}

export async function installCli(
  home: string,
  staged: string,
  shell: string | undefined,
): Promise<string> {
  await linkCli(home, staged);
  const link = commandLink(home);
  const change = await addToPath(home, shell);

  switch (change.kind) {
    case "present":
      return `${link} runs this app's nyte, and ${change.file} puts it on your PATH.`;
    case "added":
      return `${link} runs this app's nyte. Nyte put it on your PATH in ${change.file}; open a new terminal to use it.`;
    case "manual":
      return `${link} runs this app's nyte. To put it on your PATH, add this line to your shell's startup file:\n\n${change.line}`;
    default: {
      const _exhaustive: never = change;

      return _exhaustive;
    }
  }
}

async function linkCli(home: string, staged: string): Promise<void> {
  const link = commandLink(home);

  if ((await readlink(link).catch(() => undefined)) === staged) return;
  await mkdir(dirname(link), { recursive: true });
  const temporary = `${link}.${String(process.pid)}.tmp`;
  await rm(temporary, { force: true });
  await symlink(staged, temporary);
  await rename(temporary, link);
}

async function addToPath(home: string, shell: string | undefined): Promise<PathChange> {
  const directory = dirname(commandLink(home));
  const name = basename(shell ?? "sh");
  const line = name === "fish" ? `fish_add_path ${directory}` : `export PATH="${directory}:$PATH"`;

  const candidates =
    name === "fish"
      ? [".config/fish/config.fish"]
      : name === "zsh"
        ? [".zshrc", ".zshenv"]
        : name === "bash"
          ? [".bashrc", ".bash_profile", ".profile"]
          : [".profile"];

  for (const candidate of candidates) {
    const file = join(home, candidate);
    const text = await readFile(file, "utf8").catch(() => undefined);

    if (text === undefined) continue;

    if (text.split("\n").includes(line)) return { kind: "present", file };
    await appendFile(file, `\n# nyte\n${line}\n`);

    return { kind: "added", file };
  }

  return { kind: "manual", line };
}
