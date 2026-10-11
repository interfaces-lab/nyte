import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packages = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const WALKED: Readonly<Record<string, string>> = {
  "@nyte-ai/core": "core/src/index.ts",
  "@nyte-ai/protocol": "protocol/src/index.ts",
  "@nyte-ai/schema": "schema/src/index.ts",
};

const SPECIFIER = /^(?:import|export)\s[^;]*?from\s+"([^"]+)"|^import\s+"([^"]+)"/gm;

/** Returns the file a specifier names when the walk follows it: a relative path, or the root of core, protocol or schema; null for anything else. */
function fileOf(from: string, specifier: string): string | null {
  if (specifier.startsWith(".")) return resolve(dirname(from), specifier);
  const entry = WALKED[specifier];

  return entry === undefined ? null : join(packages, entry);
}

/** Returns every specifier the files reachable from `entry` import, type-only ones included (a DOM program must not see Node's types either), walking the sdk's files and the core, protocol and schema roots. */
function reachable(entry: string): ReadonlyMap<string, readonly string[]> {
  const seen = new Map<string, readonly string[]>();
  const queue = [join(packages, entry)];

  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file) || !file.endsWith(".ts")) continue;

    const specifiers = [...readFileSync(file, "utf8").matchAll(SPECIFIER)].flatMap((match) => {
      const specifier = match[1] ?? match[2];

      return specifier === undefined ? [] : [specifier];
    });

    seen.set(file, specifiers);

    for (const specifier of specifiers) {
      const next = fileOf(file, specifier);

      if (next !== null) queue.push(next);
    }
  }

  return seen;
}

describe("the web entry", () => {
  it("reaches no node: import and not @nyte-ai/host, not even as a type", () => {
    const files = reachable("sdk/src/index.web.ts");

    const offending = [...files].flatMap(([file, specifiers]) =>
      specifiers
        .filter(
          (specifier) => specifier.startsWith("node:") || specifier.startsWith("@nyte-ai/host"),
        )
        .map((specifier) => `${file.slice(packages.length + 1)} imports ${specifier}`),
    );

    expect(files.size).toBeGreaterThan(10);
    expect(offending).toEqual([]);
  });

  it("is what react-native and browser resolve", () => {
    const manifest: unknown = JSON.parse(readFileSync(join(packages, "sdk/package.json"), "utf8"));

    expect(manifest).toMatchObject({
      exports: {
        ".": {
          "react-native": "./src/index.web.ts",
          browser: "./src/index.web.ts",
          default: "./src/index.ts",
        },
      },
    });
  });
});
