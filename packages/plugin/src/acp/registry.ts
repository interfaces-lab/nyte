import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { basename, delimiter, dirname, join } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

/** The ACP registry's current agent list. */
export const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

/** An ACP agent this machine can start without downloading anything. */
export interface AcpAgent {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

const launch = {
  args: Type.Optional(Type.Array(Type.String())),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
};

const registryAgent = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  distribution: Type.Object({
    binary: Type.Optional(
      Type.Record(Type.String(), Type.Object({ cmd: Type.String({ minLength: 1 }), ...launch })),
    ),
    npx: Type.Optional(Type.Object({ package: Type.String({ minLength: 1 }), ...launch })),
  }),
});

type RegistryAgent = Static<typeof registryAgent>;

const registry = Type.Object({ agents: Type.Array(Type.Unknown()) });

const packageBin = Type.Object({
  bin: Type.Union([Type.String(), Type.Record(Type.String(), Type.String())]),
});

const PACKAGE = /^(@?[^@]+)@[^@]+$/;

/** The agent entries of a registry document, as fetched; anything else is no entries. */
export function registryEntries(document: unknown): readonly unknown[] {
  return Value.Check(registry, document) ? document.agents : [];
}

function platformTarget(): string {
  const os = process.platform === "win32" ? "windows" : process.platform;

  const arch =
    process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;

  return `${os}-${arch}`;
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);

    return true;
  } catch {
    return false;
  }
}

async function findOnPath(name: string, path: string): Promise<string | undefined> {
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];

  for (const dir of path.split(delimiter))
    for (const candidate of names)
      if (dir !== "" && (await executable(join(dir, candidate)))) return join(dir, candidate);

  return undefined;
}

async function globalBin(spec: string, path: string): Promise<string | undefined> {
  const name = PACKAGE.exec(spec)?.[1] ?? spec;
  const npx = await findOnPath("npx", path);

  if (npx === undefined) return undefined;
  const bin = dirname(npx);

  const modules =
    process.platform === "win32"
      ? join(bin, "node_modules")
      : join(dirname(bin), "lib", "node_modules");

  let manifest: unknown;

  try {
    manifest = JSON.parse(await readFile(join(modules, name, "package.json"), "utf8"));
  } catch {
    return undefined;
  }

  if (!Value.Check(packageBin, manifest)) return undefined;

  const command =
    typeof manifest.bin === "string"
      ? basename(name)
      : Object.keys(manifest.bin).find((key) => key !== "");

  return command === undefined ? undefined : findOnPath(command, path);
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
      };
  }

  const npx = agent.distribution.npx;

  if (npx === undefined) return undefined;
  const command = await globalBin(npx.package, path);

  return command === undefined
    ? undefined
    : { id: agent.id, name: agent.name, command, args: npx.args ?? [], env: npx.env ?? {} };
}

/**
 * The registry agents installed on this machine, in registry order: a binary
 * agent whose command is on `path`, or an npx agent whose package is
 * installed globally beside `npx`, run with the registry's arguments. An
 * agent only the registry can download is left out, so choosing a model
 * never downloads one.
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
