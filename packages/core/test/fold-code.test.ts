import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import {
  createSourceFile,
  forEachChild,
  isCallExpression,
  isExportDeclaration,
  isImportDeclaration,
  isNamedExports,
  isNamedImports,
  isStringLiteral,
  ScriptTarget,
  SyntaxKind,
} from "typescript";
import type { Expression, Node, SourceFile } from "typescript";
import { expect, it } from "vitest";
import { FOLD_CODE } from "../src/fold/code.ts";

const SOURCE = new URL("../src/", import.meta.url);

const ROOTS = ["fold/fold.ts", "fold/checkpoint.ts"];

const VALIDATES =
  "Validates a checkpoint field on restore. A narrower schema rejects the checkpoint and the log replays; it never changes a field.";

const OUTSIDE = new Map([
  ["contract/fold.ts#INDEX", "A symbol the state's index is keyed by; only its identity counts."],
  [
    "contract/parts.ts#text",
    "Only its `kind`, a part kind stored in every part record; renaming it is a store migration.",
  ],
  [
    "contract/parts.ts#thinking",
    "Only its `kind`, a part kind stored in every part record; renaming it is a store migration.",
  ],
  ["contract/records.ts#STORED_RECORD_TYPES", VALIDATES],
  ["store/log.ts#decodeObject", "JSON.parse of the checkpoint body."],
  [
    "store/migrations.ts#STORE_VERSION",
    "Stamps every checkpoint, which restores only at its own value.",
  ],
  [
    "store/session.ts#readPositionCommit",
    "Reads the commit out of a stored `Position`, the inverse of `createPosition`; its result is fixed by the stored value.",
  ],
  ["store/session.ts#START", "The stored `Position` of a head with no commits."],
  [
    "store/session.ts#NO_BACKGROUND",
    "Zero background work, the only correct count for a head the fold creates.",
  ],
  ["util/dev-log.ts#dev", "Logs; returns nothing."],
  [
    "util/usage.ts#addUsage",
    "Sums path usage, which a checkpoint doesn't store: decoding sums it again.",
  ],
  [
    "util/usage.ts#ZERO_USAGE",
    "Starts path usage, which a checkpoint doesn't store: decoding sums it again.",
  ],
  ["@nyte-ai/schema#asId", "Brands a string; returns its input."],
  ["@nyte-ai/schema#asSeq", "Brands a number; returns its input."],
  [
    "@nyte-ai/schema#backgroundRowKey",
    "Keys touched background rows, which a checkpoint doesn't store.",
  ],
  ["@nyte-ai/schema#compile", "Compiles the TypeBox schemas listed here."],
  [
    "@nyte-ai/schema#isJsonObject",
    "Tells a JSON object from other JSON; a change would break every reader of stored JSON.",
  ],
  [
    "@nyte-ai/schema#ToolClassType",
    "Gates a call's class, which tool part states must already match when written.",
  ],
  ["@nyte-ai/schema#ConfigurationType", VALIDATES],
  ["@nyte-ai/schema#ContextViewType", VALIDATES],
  ["@nyte-ai/schema#cyclicWithJson", VALIDATES],
  ["@nyte-ai/schema#DeliveryType", VALIDATES],
  ["@nyte-ai/schema#FileChangeType", VALIDATES],
  ["@nyte-ai/schema#HeadInfoType", VALIDATES],
  ["@nyte-ai/schema#idSchema", VALIDATES],
  ["@nyte-ai/schema#MessageSourceType", VALIDATES],
  ["@nyte-ai/schema#MessageType", VALIDATES],
  ["@nyte-ai/schema#PartViewType", VALIDATES],
  ["@nyte-ai/schema#RunViewType", VALIDATES],
  ["@nyte-ai/schema#ScheduleType", VALIDATES],
  ["@nyte-ai/schema#SeqType", VALIDATES],
  ["@nyte-ai/schema#TurnInfoType", VALIDATES],
  ["@nyte-ai/schema#UserContentType", VALIDATES],
  ["@nyte-ai/schema#WaitOutcomeType", VALIDATES],
  ["@nyte-ai/schema#WaitTargetType", VALIDATES],
  ["typebox#Type", "Builds the TypeBox schemas listed here."],
]);

it("stamps fold checkpoints with the hash of the fold code", async () => {
  const folder = new URL("fold/", SOURCE);
  const hash = createHash("sha256");
  const names = (await readdir(folder)).filter(
    (name) => name.endsWith(".ts") && name !== "code.ts",
  );

  for (const name of names.toSorted())
    hash
      .update(`${name}\0`)
      .update(await readFile(new URL(name, folder)))
      .update("\0");

  expect(
    hash.digest("hex").slice(0, 16),
    "The fold code changed, so checkpoints it wrote before may fold differently. Update FOLD_CODE in src/fold/code.ts to this hash.",
  ).toBe(FOLD_CODE);
});

it("keeps the code that shapes fold checkpoints in src/fold/, which FOLD_CODE hashes", async () => {
  const pending = [...ROOTS];
  const read = new Set<string>();
  const outside = new Set<string>();
  const dynamic: string[] = [];

  while (pending.length > 0) {
    const file = pending.pop();

    if (file === undefined || read.has(file)) continue;
    read.add(file);

    const source = createSourceFile(
      file,
      await readFile(new URL(file, SOURCE), "utf8"),
      ScriptTarget.Latest,
      true,
    );

    if (importsDynamically(source)) dynamic.push(file);

    for (const used of valueImports(source)) {
      const target = resolveImport(file, used.from);

      if (target.startsWith("fold/")) pending.push(target);
      else for (const name of used.names) outside.add(`${target}#${name}`);
    }
  }

  expect(
    dynamic,
    "The fold's checkpointed code imports dynamically, which this check can't follow.",
  ).toEqual([]);
  expect(
    [...outside].toSorted(),
    "The fold's checkpointed code imports a value from outside src/fold/, which FOLD_CODE doesn't hash. Move it into src/fold/ if it can change a checkpointed field, or list it in OUTSIDE with why it can't.",
  ).toEqual([...OUTSIDE.keys()].toSorted());
});

function valueImports(
  source: SourceFile,
): readonly { readonly from: string; readonly names: readonly string[] }[] {
  return source.statements.flatMap((statement) => {
    if (isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const from = readSpecifier(statement.moduleSpecifier);

      if (clause === undefined) return [{ from, names: ["*"] }];

      if (clause.isTypeOnly) return [];
      const bindings = clause.namedBindings;

      const names = [
        ...(clause.name === undefined ? [] : ["default"]),
        ...(bindings === undefined
          ? []
          : isNamedImports(bindings)
            ? bindings.elements
                .filter((element) => !element.isTypeOnly)
                .map((element) => (element.propertyName ?? element.name).text)
            : ["*"]),
      ];

      return names.length === 0 ? [] : [{ from, names }];
    }

    if (
      !isExportDeclaration(statement) ||
      statement.moduleSpecifier === undefined ||
      statement.isTypeOnly
    )
      return [];
    const from = readSpecifier(statement.moduleSpecifier);
    const clause = statement.exportClause;

    const names =
      clause !== undefined && isNamedExports(clause)
        ? clause.elements
            .filter((element) => !element.isTypeOnly)
            .map((element) => (element.propertyName ?? element.name).text)
        : ["*"];

    return names.length === 0 ? [] : [{ from, names }];
  });
}

function readSpecifier(specifier: Expression): string {
  if (!isStringLiteral(specifier)) throw new Error("An import names its module with a string.");

  return specifier.text;
}

function resolveImport(file: string, from: string): string {
  if (!from.startsWith(".")) return from;

  return new URL(from, new URL(file, SOURCE)).href.slice(SOURCE.href.length);
}

function importsDynamically(node: Node): boolean {
  return (
    (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) ||
    (forEachChild(node, importsDynamically) ?? false)
  );
}
