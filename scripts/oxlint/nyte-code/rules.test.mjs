import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import repositoryConfig from "../../../oxlint.config.ts";

const oxlintBin = fileURLToPath(
  new URL("../../../node_modules/oxlint/bin/oxlint", import.meta.url),
);
const pluginPath = fileURLToPath(new URL("./index.ts", import.meta.url));

const cases = [
  {
    rule: "nyte-code/no-is-helper-names",
    rejected: `function isOpen(state: State) { return state.open; }
const isClosed = (state: State) => !state.open;
const check = function isNamed() { return true; };
const isGuard = ((value: Entry) => value.ok) satisfies (value: Entry) => boolean;
class Door {
  #isLocked() { return true; }
  private isShut = () => true;
  private isAjar() { return false; }
}`,
    rejectedLines: [1, 2, 3, 4, 6, 7, 8],
    accepted: `const isOpen = state.open;
const [isLoading, setLoading] = useState(false);
const helpers = { isFile() { return true; }, isDirectory: () => false };
class Stats { isFile() { return true; } isSocket = () => false; }
function island() {}
function isolate() {}
interface Entry { isDirectory(): boolean }
declare function isExternal(value: Entry): boolean;
const open = entries.filter((isVisible) => isVisible);`,
  },
  {
    rule: "unicorn/prefer-includes",
    rejected: `const present = list.indexOf(item) !== -1;
const missing = text.indexOf(needle) === -1;
const positive = text.indexOf(needle) >= 0;
const found = text.indexOf(needle) > -1;
const absent = text.indexOf(needle) < 0;
const computed = list["indexOf"](item) !== -1;
const optional = text?.indexOf(needle) !== -1;
const later = text.indexOf(needle, from) !== -1;`,
    rejectedLines: [1, 2, 3, 4, 5, 6, 7, 8],
    accepted: `const has = list.includes(item);
const indexOf = 1;
const shape = { indexOf: 1 };
const last = list.lastIndexOf(item);
const found = list.findIndex((entry) => entry === item);
const at = list.indexOf(item);
const slash = text?.indexOf("/");
const computed = list["indexOf"](item);
const borrowed = Array.prototype.indexOf.call(list, item);
const colon = line.indexOf(":");
const field = colon === -1 ? line : line.slice(0, colon);
const next = text.indexOf("\\n", from);`,
  },
  {
    rule: "nyte-code/no-one-off-boolean-helpers",
    rejected: `function hasItems(list: string[]) { return list.length > 0; }
const ready = (state: State): boolean => state.ready;
const guard = (value: Entry): value is Item => value.kind === "item";
const known = (key: string) => keys.has(key);
export function run(list: string[], state: State, value: Entry, key: string) {
  return hasItems(list) && ready(state) && guard(value) && known(key);
}`,
    rejectedLines: [1, 2, 3, 4],
    accepted: `function twice(list: string[]) { return list.length > 0; }
export function exported(value: number) { return value > 0; }
function multi(value: number) { const next = value + 1; return next > 0; }
function named(value: Entry) { return value.name; }
const callback = (value: number) => value > 0;
function reexported(value: number) { return value > 0; }
async function later(value: number) { return value > 0; }
function recursive(value: number): boolean { return value > 0 && recursive(value - 1); }
export { reexported };
export function use(list: string[], value: number, entry: Entry) {
  twice(list);
  twice(list);
  [value].filter(callback);
  return named(entry) && multi(value) && later(value) && reexported(value);
}`,
  },
  {
    rule: "nyte-code/no-cross-package-relative-imports",
    directory: "packages/app/src",
    packageRoots: ["packages/app", "packages/app/modules/native", "packages/core"],
    rejected: `import { fold } from "../../core/src/fold.ts";
import type { Part } from "../../../packages/core/src/part.ts";
export * from "../../core/test/harness.ts";
export { main } from "../../core";
const native = await import("../modules/native/src/index.ts");
const outside = require("../../../../outside.cjs");`,
    rejectedLines: [1, 2, 3, 4, 5, 6],
    accepted: `import { join } from "node:path";
import { fold } from "@nyte-ai/core";
import { local } from "./local.ts";
import { fixture } from "../test/fixture.ts";
export * from "../package.json";
const later = await import("./later.ts");
const config = require("../app.config.cjs");`,
  },
  {
    rule: "nyte-code/declarative-comments",
    rejected: `// TODO: remove
const a = 1;

// Detached by a blank line.

const b = 2;
/* Block, not JSDoc. */
const c = 3;
// First line.
// Second line.
const d = 4;
const e = 5; // Trailing.
function f() {
  // Inside a body.
  return 1;
}
/** JSDoc on a statement. */
f();
const g = () => {
  /** JSDoc inside a body. */
  const h = 1;
  return h;
};
const j = { a: 1 };
// Above a closing brace.
/** FIXME: also in JSDoc. */
const k = 6;
// Dangling at the end.`,
    rejectedLines: [1, 4, 7, 9, 12, 14, 17, 20, 26, 28],
    accepted: `#!/usr/bin/env node
/**
 * Copyright 2026 Nyte. Licensed under MIT.
 */

/** The module overview, before any code. */

/// <reference types="node" />
import { make } from "./make";

/** Documented constant. */
export const a = [1, 2] as const;

// Why: the scale stops at 8.
const b = 8;

/** Documented type. */
// oxlint-disable-next-line no-unused-vars
type C = {
  /** Field doc. */
  readonly name: string;
  // One line on a field.
  readonly size: number;
};

type Outcome =
  /** The work finished. */
  | { kind: "done" }
  // The work stopped early.
  | { kind: "stopped" };

const levels = [
  /** Quiet. */
  "low",
  // Loud.
  "high",
] as const;

interface D {
  /** Method doc. */
  run(): void;
}

class E {
  /** Method doc. */
  method() {}
  // Field reason.
  field = 1;
}

//#region helpers
export function f(): number {
  // oxlint-disable-next-line no-console
  console.log(a);
  // @ts-expect-error -- fixture
  return b satisfies C;
}
//#endregion

/**
 * Multi-line JSDoc
 * on a declaration.
 */
export default {
  // Single line on a property.
  key: 1,
  /** JSDoc on a property. */
  other: /* @__PURE__ */ make(),
};`,
  },
  {
    rule: "nyte-code/no-of-lookup-names",
    rejected: `function indexOf(state: FoldState): Index { return indexes.get(state.messages); }
async function stopReceipt<O extends Json>(outcomeOf: (value: Json) => O) {}
const keyOf = (value: Entry) => value.id;
const childOf = ((value: Entry) => value.child) satisfies (value: Entry) => Entry;
const read = function partOf(value: Entry) { return value.part; };
const helpers = {
  modelOf(value: Entry) { return value.model; },
  "headOf": (value: Entry) => value.head,
  taskOf: function(value: Entry) { return value.task; },
};
class Helpers {
  refOf(value: Entry) { return value.ref; }
  messageOf = (value: Entry) => value.message;
  #stateOf = (value: Entry) => value.state;
}
declare function pathOf(value: Entry): string;`,
    rejectedLines: [1, 2, 3, 4, 5, 7, 8, 9, 12, 13, 14, 16],
    accepted: `function findPart(state: FoldState) { return state.parts.get("a"); }
const readChild = (value: Entry) => value.child;
function stopReceipt(decodeOutcome: (value: Json) => Json) {}
const helpers = { indexOf: 2, partOf: "part", findModel(value: Entry) { return value.model; } };
const [headOf] = tuple;
const property = "keyOf";
const computed = { [property]: (value: Entry) => value.id };
const index = messages.indexOf(message);
const proofOfConcept = (value: Entry) => value;
const instanceOf = true;`,
  },
  {
    rule: "typescript/no-explicit-any",
    rejected: `const a: any = 1;
function f(list: any[]): Array<any> { return list; }`,
    rejectedLines: [1, 2, 2],
    accepted: `const a: unknown = 1;
function f(list: readonly string[]): string[] { return [...list]; }`,
  },
  {
    rule: "typescript/consistent-type-assertions",
    rejected: `const a = value as string;
const b = <number>value;
const c = (value as unknown) as string;`,
    rejectedLines: [1, 2, 3, 3],
    accepted: `const a = [1, 2] as const;
const b = <const>["x"];
const c = { x: 1 } satisfies Record<string, number>;
const d = value!;
const e = { mode: "dark" } as const satisfies { mode: string };`,
  },
  {
    rule: "eslint/max-lines",
    rejected: Array.from(
      { length: 1001 },
      (_, line) => `export const value${line} = ${line};`,
    ).join("\n"),
    rejectedLines: [1001],
    accepted: Array.from(
      { length: 1000 },
      (_, line) => `export const value${line} = ${line};`,
    ).join("\n"),
  },
];

function lintWith(directory, rule, files) {
  const result = spawnSync(
    process.execPath,
    [
      oxlintBin,
      "--config",
      join(directory, `${rule.replaceAll("/", "-")}.json`),
      "-f",
      "json",
      ...files,
    ],
    { encoding: "utf8" },
  );

  equal(result.error, undefined);
  return JSON.parse(result.stdout).diagnostics;
}

await test("code-shape rules reject their targets and accept the idioms around them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-code-lint-"));

  try {
    for (const { rule, rejected, rejectedLines, accepted, ...layout } of cases) {
      const ruleName = rule.split("/").at(-1);
      const fixtureDirectory = join(directory, ruleName, layout.directory ?? "");
      const rejectedFile = join(fixtureDirectory, `${ruleName}.rejected.ts`);
      const acceptedFile = join(fixtureDirectory, `${ruleName}.accepted.ts`);
      const config = {
        categories: { correctness: "off" },
        plugins: ["typescript", "eslint", "unicorn"],
        jsPlugins: [pluginPath],
        rules: { [rule]: repositoryConfig.rules[rule] ?? "error" },
      };

      await writeFile(join(directory, `${rule.replaceAll("/", "-")}.json`), JSON.stringify(config));
      await mkdir(fixtureDirectory, { recursive: true });

      for (const root of layout.packageRoots ?? []) {
        await mkdir(join(directory, ruleName, root), { recursive: true });
        await writeFile(join(directory, ruleName, root, "package.json"), "{}");
      }

      await writeFile(rejectedFile, rejected);
      await writeFile(acceptedFile, accepted);

      const diagnostics = lintWith(directory, rule, [rejectedFile, acceptedFile]);
      const lines = (file) =>
        diagnostics
          .filter((diagnostic) => diagnostic.filename === file)
          .map((diagnostic) => diagnostic.labels[0]?.span.line ?? 0)
          .toSorted((left, right) => left - right);

      deepEqual(lines(rejectedFile), rejectedLines, `${rule} rejected`);
      deepEqual(lines(acceptedFile), [], `${rule} accepted`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
