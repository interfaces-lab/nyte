/**
 * Import rules that keep internals unreachable, checked by reading sources:
 * - src/model/** imports only @nyte-ai/* types, @nyte-ai/plugin/question, src/lib/**, src/model/**;
 *   never solid-js, @opentui/*, node:*, src/effects, src/services, src/ui, src/app.
 * - src/ui/** never imports src/effects or src/services, and imports @nyte-ai/sdk only as types.
 * - Only src/effects/host-port.ts imports SDK values.
 * - No source registers `setFrameCallback` or adds a raw `keyInput` listener.
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Glob } from "bun";
import { expect, test } from "bun:test";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");

const DIRS = ["app", "model", "effects", "ui", "lib", "services"] as const;

interface Import {
  readonly file: string;
  readonly spec: string;
  /** Some binding survives type erasure. */
  readonly value: boolean;
  /** The `src/`-relative target of a relative import, else null. */
  readonly target: string | null;
}

const STATEMENT = /^\s*(import|export)\s+(type\s+)?(?:([^"';]*?)\s+from\s+)?["']([^"']+)["']/gmu;

function sources(dir: string): readonly string[] {
  return [...new Glob(`${dir}/**/*.{ts,tsx}`).scanSync(SRC)];
}

function importsOf(file: string): readonly Import[] {
  const code = readFileSync(join(SRC, file), "utf8");

  return [...code.matchAll(STATEMENT)].map((match) => {
    const [, , typeOnly, clause = "", spec = ""] = match;
    const named = /\{([^}]*)\}/u.exec(clause)?.[1];
    const outside = clause
      .replace(/\{[^}]*\}/u, "")
      .replaceAll(",", "")
      .trim();

    const value =
      typeOnly === undefined &&
      (clause === "" ||
        outside !== "" ||
        (named ?? "")
          .split(",")
          .map((binding) => binding.trim())
          .some((binding) => binding !== "" && !binding.startsWith("type ")));

    const target = spec.startsWith(".")
      ? relative(SRC, resolve(dirname(join(SRC, file)), spec))
      : null;

    return { file, spec, value, target };
  });
}

function all(dirs: readonly string[]): readonly Import[] {
  return dirs.flatMap((dir) => sources(dir).flatMap(importsOf));
}

const describe = (entry: Import): string => `${entry.file} → ${entry.spec}`;

test("model imports only lib, model and @nyte-ai types (question rule values)", () => {
  const offending = all(["model"]).filter((entry) => {
    if (entry.target !== null)
      return !(entry.target.startsWith("lib/") || entry.target.startsWith("model/"));

    if (entry.spec === "@nyte-ai/plugin/question") return false;

    return !entry.spec.startsWith("@nyte-ai/") || entry.value;
  });

  expect(offending.map(describe)).toEqual([]);
});

test("ui imports no effects or services, and the SDK only as types", () => {
  const offending = all(["ui"]).filter(
    (entry) =>
      entry.target?.startsWith("effects/") === true ||
      entry.target?.startsWith("services/") === true ||
      (entry.spec === "@nyte-ai/sdk" && entry.value),
  );

  expect(offending.map(describe)).toEqual([]);
});

test("only effects/host-port.ts imports SDK values", () => {
  const offending = all(DIRS).filter(
    (entry) =>
      entry.spec.startsWith("@nyte-ai/sdk") && entry.value && entry.file !== "effects/host-port.ts",
  );

  expect(offending.map(describe)).toEqual([]);
});

test("no frame callbacks and no raw keyInput listeners", () => {
  const offending = DIRS.flatMap(sources).filter((file) =>
    /setFrameCallback\s*\(|keyInput\s*\.\s*(on|once|addListener|prependListener)\s*\(/u.test(
      readFileSync(join(SRC, file), "utf8"),
    ),
  );

  expect(offending).toEqual([]);
});
