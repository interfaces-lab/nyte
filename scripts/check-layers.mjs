/**
 * `pnpm layers` fails when a folder of packages/app/src imports a folder in a higher layer.
 *
 * A folder is the first path segment under `src/`. Folders in one layer may import each
 * other; a folder may import any lower layer and never a higher one. Every static
 * `import` and `export … from` counts, type-only ones too, because the layers describe
 * where a reader finds a concept, not only what loads at run time; TYPE_REACH lists the
 * few files whose type-only imports may reach up. Tests, browser-test
 * fixtures and `fixtures/` folders are left out: they may reach any layer to drive
 * what they test. A folder missing from LAYERS, or a root file other than the entry
 * points, fails the check so a new one is placed on purpose.
 *
 * Usage: node scripts/check-layers.mjs [--report]
 *   --report prints the violations and exits 0.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { ScriptKind, SyntaxKind } from "@typescript/native/ast";
import { isExportDeclaration, isImportDeclaration } from "@typescript/native/ast/is";
import { API } from "@typescript/native/sync";

const root = resolve(import.meta.dirname, "..");

const source = join(root, "packages/app/src");

/** Lowest first. See docs/chat-experience/audit/structure.md for what each folder owns. */
const LAYERS = [
  ["contract"],
  ["lib", "data"],
  ["theme", "preferences", "components", "chats"],
  ["diff", "references"],
  [
    "chat",
    "canvas",
    "workbench",
    "sidebar",
    "settings",
    "environments",
    "customize",
    "account",
    "panes",
    "tabs",
    "window",
  ],
  ["commands"],
  ["shell"],
  ["boot", "web", "app.tsx", "index.ts"],
];

/**
 * Files whose type-only imports may reach a higher layer, with the reason. Their value
 * imports still follow the layers.
 */
const TYPE_REACH = new Map([
  [
    "lib/deferred-entries.ts",
    "The deferred-chunk manifest names each entry's runtime type; the entries load later by URL.",
  ],
]);

/** Root files that are not modules of any folder. */
const UNPLACED = new Set(["vite-env.d.ts"]);

const TEST = /\.(?:test|browser-test)\.tsx?$|\.fixtures?\.ts$|\/fixtures\//;

const report = process.argv.includes("--report");

const layers = new Map(LAYERS.flatMap((names, index) => names.map((name) => [name, index])));

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: source,
  encoding: "utf8",
})
  .split("\n")
  .filter((path) => /\.tsx?$/.test(path) && !TEST.test(path) && !UNPLACED.has(path))
  .map((path) => join(source, path))
  .filter((path) => existsSync(path));

/** The folder a file of src belongs to: its first segment, or the file itself at the root. */
function readFolder(file) {
  return relative(source, file).split("/")[0];
}

const api = new API();

const problems = [];

for (const file of files) {
  const folder = readFolder(file);

  if (!layers.has(folder)) {
    problems.push(
      `${relative(root, file)}: ${folder} has no layer; add it to LAYERS in scripts/check-layers.mjs`,
    );
    continue;
  }

  using retained = api.createSourceFile(file, readFileSync(file, "utf8"), {
    scriptKind: file.endsWith("x") ? ScriptKind.TSX : ScriptKind.TS,
  });

  const parsed = retained.sourceFile;

  const typesReach = TYPE_REACH.has(relative(source, file));

  for (const statement of parsed.statements) {
    if (!isImportDeclaration(statement) && !isExportDeclaration(statement)) continue;

    const specifier = statement.moduleSpecifier?.text;

    if (specifier === undefined || !specifier.startsWith(".")) continue;

    const target = resolve(dirname(file), specifier);

    if (!target.startsWith(`${source}/`)) continue;

    const targetFolder = readFolder(target);

    if (targetFolder === folder || UNPLACED.has(targetFolder)) continue;

    const targetLayer = layers.get(targetFolder);

    if (targetLayer !== undefined && targetLayer <= layers.get(folder)) continue;

    const typeOnly = isImportDeclaration(statement)
      ? statement.importClause?.phaseModifier === SyntaxKind.TypeKeyword
      : statement.isTypeOnly;

    if (typesReach && typeOnly) continue;

    const line = parsed.getLineAndCharacterOfPosition(statement.getStart(parsed)).line + 1;

    problems.push(
      targetLayer === undefined
        ? `${relative(root, file)}:${line} imports ${targetFolder}, which has no layer`
        : `${relative(root, file)}:${line} imports ${relative(root, target)}: ${folder} (layer ${layers.get(folder)}) is below ${targetFolder} (layer ${targetLayer})`,
    );
  }
}

api.close();

for (const problem of problems.toSorted()) process.stdout.write(`${problem}\n`);

process.stdout.write(`${files.length} files, ${problems.length} layer violations.\n`);

process.exitCode = problems.length > 0 && !report ? 1 : 0;
