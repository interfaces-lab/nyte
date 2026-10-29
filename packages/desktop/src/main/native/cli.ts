import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
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
