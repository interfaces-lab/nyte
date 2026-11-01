import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { executable, findOnPath } from "../find-on-path.ts";

/** An ACP agent this machine can start without downloading anything. */
export interface AcpAgent {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** The ACP session mode each new session is set to, so the agent's permission asks reach Nyte; else the agent's own default. */
  readonly mode?: string;
}

const launch = {
  args: Type.Optional(Type.Array(Type.String())),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
};

const mode = Type.Optional(Type.String({ minLength: 1 }));

const registryAgent = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  mode,
  distribution: Type.Object({
    binary: Type.Optional(
      Type.Record(Type.String(), Type.Object({ cmd: Type.String({ minLength: 1 }), ...launch })),
    ),
    npx: Type.Optional(Type.Object({ package: Type.String({ minLength: 1 }), ...launch })),
  }),
});

type RegistryAgent = Static<typeof registryAgent>;

const registry = Type.Object({ agents: Type.Array(Type.Unknown()) });

const userAgentsFile = Type.Object({
  agents: Type.Array(
    Type.Object({
      id: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1 }),
      command: Type.String({ minLength: 1 }),
      mode,
      ...launch,
    }),
  ),
});

const packageBin = Type.Object({
  bin: Type.Union([Type.String(), Type.Record(Type.String(), Type.String())]),
});

const PACKAGE = /^(@?[^@]+)@[^@]+$/;

/** The agent entries of a registry document; anything else is no entries. */
export function registryEntries(document: unknown): readonly unknown[] {
  return Value.Check(registry, document) ? document.agents : [];
}

function platformTarget(): string {
  const os = process.platform === "win32" ? "windows" : process.platform;

  const arch =
    process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;

  return `${os}-${arch}`;
}

async function resolved(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

/** The command a global install of package `spec` put beside `npx`, when it is that package's own bin: on Windows the `.cmd` shim that names the package, elsewhere a link that resolves into the package. A command of the same name from anywhere else is not the package. */
async function globalBin(spec: string, path: string): Promise<string | undefined> {
  const name = PACKAGE.exec(spec)?.[1] ?? spec;
  const npx = await findOnPath("npx", path);

  if (npx === undefined) return undefined;
  const bin = dirname(npx);
  const windows = process.platform === "win32";
  const modules = windows ? join(bin, "node_modules") : join(dirname(bin), "lib", "node_modules");
  const root = join(modules, name);

  let manifest: unknown;

  try {
    manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  } catch {
    return undefined;
  }

  if (!Value.Check(packageBin, manifest)) return undefined;

  const [command, target] =
    typeof manifest.bin === "string"
      ? [basename(name), manifest.bin]
      : (Object.entries(manifest.bin).find(([key]) => key !== "") ?? []);

  if (command === undefined || target === undefined) return undefined;

  if (windows) {
    const shim = join(bin, `${command}.cmd`);
    const text = await readFile(shim, "utf8").catch(() => "");

    return text.includes(`node_modules\\${name.replaceAll("/", "\\")}\\`) ? shim : undefined;
  }

  const linked = join(bin, command);
  const [from, to] = await Promise.all([resolved(linked), resolved(join(root, target))]);

  return from !== undefined && from === to && (await executable(linked)) ? linked : undefined;
}

async function installed(agent: RegistryAgent, path: string): Promise<AcpAgent | undefined> {
  const binary = agent.distribution.binary?.[platformTarget()];

  if (binary !== undefined) {
    const command = await findOnPath(basename(binary.cmd).replace(/\.exe$/, ""), path);

    if (command !== undefined)
      return {
        id: agent.id,
        name: agent.name,
        command,
        args: binary.args ?? [],
        env: binary.env ?? {},
        mode: agent.mode,
      };
  }

  const npx = agent.distribution.npx;

  if (npx === undefined) return undefined;
  const command = await globalBin(npx.package, path);

  return command === undefined
    ? undefined
    : {
        id: agent.id,
        name: agent.name,
        command,
        args: npx.args ?? [],
        env: npx.env ?? {},
        mode: agent.mode,
      };
}

/**
 * The registry agents installed on this machine, in registry order: a binary
 * agent whose command is on `path`, or an npx agent whose package is
 * installed globally beside `npx` (its own bin, not another command of the
 * same name), run with the registry's arguments. An agent only the registry
 * can download is left out, so choosing a model never downloads one.
 */
export async function installedAgents(
  entries: readonly unknown[],
  path: string,
): Promise<readonly AcpAgent[]> {
  const agents = entries.filter((entry): entry is RegistryAgent =>
    Value.Check(registryAgent, entry),
  );

  const found = await Promise.all(agents.map((agent) => installed(agent, path)));

  return found.filter((agent): agent is AcpAgent => agent !== undefined);
}

/**
 * The agents the user lists in `file` (`{ "agents": [{ id, name, command,
 * args?, env?, mode? }] }`), none when there is no file. Each is listed as
 * written, installed or not, and its command runs without shell expansion.
 * The file is the host's alone, so no client or project picks what runs.
 */
export async function userAgents(file: string): Promise<readonly AcpAgent[]> {
  const text = await readFile(file, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });

  if (text === undefined) return [];
  let document: unknown;

  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON.`, { cause: error });
  }

  if (!Value.Check(userAgentsFile, document)) {
    const [first] = Value.Errors(userAgentsFile, document);

    throw new Error(`${file}: ${first?.instancePath || "/"} ${first?.message ?? "is invalid"}.`);
  }

  return document.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    command: agent.command,
    args: agent.args ?? [],
    env: agent.env ?? {},
    mode: agent.mode,
  }));
}
