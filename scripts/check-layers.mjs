import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { ScriptKind, SyntaxKind } from "@typescript/native/ast";
import { isExportDeclaration, isImportDeclaration } from "@typescript/native/ast/is";
import { API } from "@typescript/native/sync";

const root = resolve(import.meta.dirname, "..");

const ENTRIES = [
  {
    source: "packages/app/src",
    doc: "docs/app-structure.md",
    layers: [
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
        "projects",
        "tabs",
        "window",
      ],
      ["commands"],
      ["shell"],
      ["boot", "web", "app.tsx", "index.ts"],
    ],
    typeReach: new Map([
      [
        "lib/deferred-entries.ts",
        "The deferred-chunk manifest names each entry's runtime type; the entries load later by URL.",
      ],
    ]),
    unplaced: new Set(["vite-env.d.ts"]),
  },
  {
    source: "packages/core/src",
    doc: "docs/core-structure.md",
    layers: [
      ["util"],
      ["contract"],
      ["store"],
      ["fold"],
      ["engine"],
      ["env"],
      ["extend"],
      ["builtins"],
      ["agent"],
      ["drive"],
      ["api"],
      ["compose.ts", "harness.ts", "index.ts", "server.ts", "store.ts", "testing.ts"],
    ],
    typeReach: new Map(),
    unplaced: new Set(),
  },
];

const TEST = /\.(?:test|browser-test)\.tsx?$|\.fixtures?\.ts$|\/fixtures\//;

const report = process.argv.includes("--report");

const api = new API();

let failed = false;

for (const entry of ENTRIES) {
  const source = join(root, entry.source);

  const layers = new Map(
    entry.layers.flatMap((names, index) => names.map((name) => [name, index])),
  );

  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: source,
    encoding: "utf8",
  })
    .split("\n")
    .filter((path) => /\.tsx?$/.test(path) && !TEST.test(path) && !entry.unplaced.has(path))
    .map((path) => join(source, path))
    .filter((path) => existsSync(path));

  const readFolder = (file) => relative(source, file).split("/")[0];

  const problems = [];

  for (const file of files) {
    const folder = readFolder(file);

    if (!layers.has(folder)) {
      problems.push(
        `${relative(root, file)}: ${folder} has no layer; add it to the layers of ${entry.source} in scripts/check-layers.mjs`,
      );
      continue;
    }

    using retained = api.createSourceFile(file, readFileSync(file, "utf8"), {
      scriptKind: file.endsWith("x") ? ScriptKind.TSX : ScriptKind.TS,
    });

    const parsed = retained.sourceFile;

    const typesReach = entry.typeReach.has(relative(source, file));

    for (const statement of parsed.statements) {
      if (!isImportDeclaration(statement) && !isExportDeclaration(statement)) continue;

      const specifier = statement.moduleSpecifier?.text;

      if (specifier === undefined || !specifier.startsWith(".")) continue;

      const target = resolve(dirname(file), specifier);

      if (!target.startsWith(`${source}/`)) continue;

      const targetFolder = readFolder(target);

      if (targetFolder === folder || entry.unplaced.has(targetFolder)) continue;

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

  for (const problem of problems.toSorted()) process.stdout.write(`${problem}\n`);

  process.stdout.write(
    `${entry.source}: ${files.length} files, ${problems.length} layer violations.\n`,
  );

  if (problems.length === 0) continue;

  process.stdout.write(`The layer rules and what each folder owns: ${entry.doc}\n`);

  failed = true;
}

api.close();

process.exitCode = failed && !report ? 1 : 0;
