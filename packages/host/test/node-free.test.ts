import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };

const root = resolve(import.meta.dirname, "..");

const ENTRIES = [
  "src/serve/listen-fetch.ts",
  "src/store/durable-object.ts",
  "src/providers.ts",
  "src/keys/credentials.ts",
  "src/keys/identity.ts",
];

const SPECIFIER = /^(?:import|export)\s(?!type\s)[^;]*?from\s+"([^"]+)"|^import\s+"([^"]+)"/gm;

const exported: Readonly<Record<string, string>> = manifest.exports;

function resolveSpecifier(from: string, specifier: string): string | null {
  if (specifier.startsWith(".")) return resolve(dirname(from), specifier);
  const subpath =
    specifier === "@nyte-ai/host" ? "." : specifier.replace(/^@nyte-ai\/host\//, "./");

  return specifier.startsWith("@nyte-ai/host") && subpath in exported
    ? join(root, exported[subpath])
    : null;
}

function reachable(entry: string): ReadonlyMap<string, readonly string[]> {
  const seen = new Map<string, readonly string[]>();
  const queue = [join(root, entry)];

  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file) || !file.endsWith(".ts")) continue;
    const specifiers = [...readFileSync(file, "utf8").matchAll(SPECIFIER)].flatMap((match) => {
      const specifier = match[1] ?? match[2];

      return specifier === undefined ? [] : [specifier];
    });

    seen.set(file, specifiers);

    for (const specifier of specifiers) {
      const next = resolveSpecifier(file, specifier);

      if (next !== null) queue.push(next);
    }
  }

  return seen;
}

describe("node-free subpaths", () => {
  it.each(ENTRIES)("%s reaches no node: import", (entry) => {
    const files = reachable(entry);
    const offending = [...files].flatMap(([file, specifiers]) =>
      specifiers
        .filter((specifier) => specifier.startsWith("node:"))
        .map((specifier) => `${file.slice(root.length + 1)} imports ${specifier}`),
    );

    expect(files.size).toBeGreaterThan(0);
    expect(offending).toEqual([]);
  });
});
