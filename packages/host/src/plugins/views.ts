import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ViewBuild } from "@nyte-ai/core";
import { compileCanvas, localImports } from "@nyte-ai/plugin/core/canvas-compile";
import type { CompileError } from "@nyte-ai/plugin/core/canvas-compile";
import { sha256 } from "../hash.ts";

/** Each file a build read, with its sha256; null when it couldn't be read. */
type Read = ReadonlyMap<string, string | null>;

/** An unchanged file graph answers the previous build. */
export function createViewCompiler(): (view: URL) => Promise<ViewBuild> {
  const remembered = new Map<string, { readonly read: Read; readonly build: ViewBuild }>();

  return async (view) => {
    if (view.protocol !== "file:")
      return { kind: "failed", message: `${view.href} is not a file on this machine.` };
    const entry = fileURLToPath(view);
    const known = remembered.get(entry);

    if (known !== undefined && (await unchanged(known.read))) return known.build;
    const graph = await readGraph(entry);

    const build =
      graph.kind === "failed"
        ? graph
        : await compile(graph.entry, graph.sources).catch((cause: unknown): ViewBuild => ({
            kind: "failed",
            message: cause instanceof Error ? cause.message : String(cause),
          }));

    remembered.set(entry, { read: graph.read, build });

    return build;
  };
}

/** Every file must sit inside the view's folder. A file that doesn't parse adds no imports; the compiler reports it. */
async function readGraph(entry: string): Promise<
  | {
      readonly kind: "read";
      readonly entry: string;
      readonly sources: ReadonlyMap<string, string>;
      readonly read: Read;
    }
  | { readonly kind: "failed"; readonly message: string; readonly read: Read }
> {
  const root = dirname(entry);
  const sources = new Map<string, string>();
  const read = new Map<string, string | null>();
  const queue = [entry];

  for (const path of queue) {
    const name = relative(root, path).split(sep).join("/");

    if (sources.has(name)) continue;
    const text = await readFile(path, "utf8").catch(() => null);
    read.set(path, text === null ? null : sha256(text));

    if (text === null) return { kind: "failed", message: `${name} could not be read.`, read };
    sources.set(name, text);

    for (const specifier of await localImports(name, text).catch(() => [])) {
      const target = await resolveLocal(dirname(path), specifier);

      if (target === null) continue;
      const inside = relative(root, target);

      if (inside.startsWith("..") || isAbsolute(inside))
        return {
          kind: "failed",
          message: `${name} imports ${specifier}, outside the view's folder.`,
          read,
        };
      queue.push(target);
    }
  }

  return { kind: "read", entry: relative(root, entry).split(sep).join("/"), sources, read };
}

/** Resolves as the compiler does: as written, then `.tsx`, `.ts` and `index`. */
async function resolveLocal(from: string, specifier: string): Promise<string | null> {
  const path = join(from, specifier);
  const bare = path.replace(/\.jsx?$/u, "");

  for (const candidate of [
    path,
    `${bare}.tsx`,
    `${bare}.ts`,
    join(path, "index.tsx"),
    join(path, "index.ts"),
  ])
    if ((await stat(candidate).catch(() => null))?.isFile() === true) return candidate;

  return null;
}

async function compile(entry: string, sources: ReadonlyMap<string, string>): Promise<ViewBuild> {
  const outcome = await compileCanvas(
    sources.get(entry) ?? "",
    Object.fromEntries([...sources].filter(([name]) => name !== entry)),
    { entry },
  );

  if (outcome.kind === "compiled")
    return { kind: "compiled", code: outcome.code, runtime: outcome.runtime };

  return { kind: "failed", message: outcome.errors.map(describeError).join("; ") };
}

function describeError(error: CompileError): string {
  const where = [error.file, error.line, error.column].filter((part) => part !== null).join(":");

  return where === "" ? error.text : `${where}: ${error.text}`;
}

async function unchanged(read: Read): Promise<boolean> {
  const entries = [...read];

  const now = await Promise.all(
    entries.map((entry) =>
      readFile(entry[0], "utf8").then(
        (text) => sha256(text),
        () => null,
      ),
    ),
  );

  return entries.every((entry, index) => now[index] === entry[1]);
}
