/**
 * `pnpm layers` fails when a folder of packages/app/src imports a folder in a higher layer.
 * Type-only imports count too: the layers say where a reader finds a concept, not only what
 * loads at run time. Tests and fixtures are left out so they can drive any layer.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { ScriptKind, SyntaxKind } from "@typescript/native/ast";
import { isExportDeclaration, isImportDeclaration } from "@typescript/native/ast/is";
import { API } from "@typescript/native/sync";

const root = resolve(import.meta.dirname, "..");

const source = join(root, "packages/app/src");

/** Lowest first. docs/app-structure.md says what each folder owns. */
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

/** Type-only imports in these files may reach a higher layer; their value imports may not. */
const TYPE_REACH = new Map([
  [
    "lib/deferred-entries.ts",
    "The deferred-chunk manifest names each entry's runtime type; the entries load later by URL.",
  ],
]);

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

if (problems.length > 0)
  process.stdout.write("The layer rules and what each folder owns: docs/app-structure.md\n");

process.exitCode = problems.length > 0 && !report ? 1 : 0;
