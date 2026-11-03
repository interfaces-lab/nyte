import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { format } from "oxfmt";
import {
  API_REVISION,
  OPERATIONS,
  describeOperations,
  isJson,
  isJsonObject,
} from "@nyte-ai/schema";
import type { Declaration, Json, OperationDescription } from "@nyte-ai/schema";

type Lock = { readonly revision: number; readonly operations: { readonly [name: string]: Json } };

type Operation = {
  readonly name: string;
  readonly row: Declaration<unknown, unknown>;
  readonly description: OperationDescription;
  readonly path: string;
};

const root = resolve(import.meta.dirname, "..");

const lockPath = join(root, "packages/schema/src/wire/operations/operations.lock.json");

const revisionPath = "packages/schema/src/wire/operations/index.ts";

const docsPath = join(root, "packages/docs/content/docs/reference/operations");

const START = "{/* generated:start */}";

const END = "{/* generated:end */}";

const TODO =
  "TODO: write what this operation does, when a client calls it, who may call it and on what, an example input and output, and the errors it raises.";

const rows: { readonly [name: string]: Declaration<unknown, unknown> } = OPERATIONS;

const operations: readonly Operation[] = describeOperations().flatMap((description) => {
  const row = rows[description.name];

  if (row === undefined) return [];

  return [{ name: description.name, row, description, path: pagePath(description.name) }];
});

const digests: Readonly<Record<string, string>> = Object.fromEntries(
  operations.map((operation) => [operation.name, digestRow(operation)]),
);

const flags = new Set(process.argv.slice(2));

if (flags.has("--update")) updateLock();

if (flags.has("--write-docs")) await writeDocs();

const failures = [...checkLock(), ...(await checkDocs())];

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n\n")}\n`);
  process.exit(1);
}

process.stdout.write(
  `${operations.length} operations match the lock at revision ${API_REVISION} and their pages.\n`,
);

function checkLock(): string[] {
  const lock = readLock();

  if (lock === undefined)
    return [`${relative(root, lockPath)} is missing. Run \`pnpm operations --update\`.`];

  if (API_REVISION < lock.revision)
    return [
      `API_REVISION is ${API_REVISION}, older than the lock's revision ${lock.revision}. Revisions only go up.`,
    ];

  const moved = changes(lock);

  if (API_REVISION === lock.revision && moved.length > 0)
    return [
      [
        `These operations changed while API_REVISION is still ${lock.revision}:`,
        ...moved.map((line) => `  ${line}`),
        `Bump API_REVISION in ${revisionPath} and run \`pnpm operations --update\`.`,
      ].join("\n"),
    ];

  if (API_REVISION > lock.revision)
    return [
      `API_REVISION is ${API_REVISION} but the lock records revision ${lock.revision}. Run \`pnpm operations --update\`.`,
    ];

  return [];
}

function updateLock(): void {
  const lock = readLock();

  if (
    lock !== undefined &&
    (API_REVISION < lock.revision || (API_REVISION === lock.revision && changes(lock).length > 0))
  )
    return;
  const next: Lock = { revision: API_REVISION, operations: digests };
  writeFileSync(lockPath, `${JSON.stringify(next, null, 2)}\n`);
}

function changes(lock: Lock): string[] {
  const added = operations.flatMap((operation) =>
    lock.operations[operation.name] === undefined ? [`${operation.name} (added)`] : [],
  );

  const removed = Object.keys(lock.operations).flatMap((name) =>
    digests[name] === undefined ? [`${name} (removed)`] : [],
  );

  const changed = operations.flatMap((operation) => {
    const locked = lock.operations[operation.name];

    return locked !== undefined && locked !== digests[operation.name]
      ? [`${operation.name} (changed)`]
      : [];
  });

  return [...added, ...removed, ...changed];
}

function readLock(): Lock | undefined {
  if (!existsSync(lockPath)) return undefined;
  const value: unknown = JSON.parse(readFileSync(lockPath, "utf8"));

  if (!isJson(value) || !isJsonObject(value)) throw new Error("The lock is not a JSON object.");
  const revision = Number(value.revision);
  const locked = value.operations;

  if (!Number.isInteger(revision) || !isJsonObject(locked))
    throw new Error("The lock needs an integer revision and an operations object.");

  return { revision, operations: locked };
}

function digestRow(operation: Operation): string {
  const row = operation.row;

  const fields = [
    operation.name,
    row.kind,
    row.authority,
    row.scope,
    row.capability ?? null,
    row.recovery ?? null,
    row.wait ?? null,
    row.local ?? null,
    row.input["~standard"].jsonSchema.input({ target: "draft-2020-12" }),
    row.output["~standard"].jsonSchema.input({ target: "draft-2020-12" }),
  ];

  return createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 16);
}

async function checkDocs(): Promise<string[]> {
  const expected = await expectedDocs();
  const known = new Set(expected.keys());

  const orphans = listPages(docsPath)
    .filter((path) => !known.has(path))
    .map((path) => `${relative(root, path)} documents no operation. Delete it.`);

  const pages = [...expected].flatMap((entry) => {
    const path = entry[0];
    const shown = relative(root, path);

    if (!existsSync(path))
      return [
        path.endsWith(".mdx")
          ? `${shown} is missing. Run \`pnpm operations --write-docs\`, then write its page.`
          : `${shown} is missing. Run \`pnpm operations --write-docs\`.`,
      ];
    const content = readFileSync(path, "utf8");

    if (content !== entry[1])
      return [`${shown} is out of date. Run \`pnpm operations --write-docs\`.`];

    if (content.includes(TODO)) return [`${shown} still has its TODO section. Write it by hand.`];

    return [];
  });

  return [...pages, ...orphans];
}

async function writeDocs(): Promise<void> {
  const expected = await expectedDocs();

  for (const entry of expected) {
    mkdirSync(dirname(entry[0]), { recursive: true });
    writeFileSync(entry[0], entry[1]);
  }
}

async function expectedDocs(): Promise<Map<string, string>> {
  const namespaces = [...new Set(operations.map((operation) => namespace(operation.name)))];

  const metas = namespaces.map((space) => ({
    path: join(docsPath, space, "meta.json"),
    content: metaJson(
      space,
      operations.flatMap((operation) =>
        namespace(operation.name) === space ? [slug(operation.name)] : [],
      ),
    ),
  }));

  const top = {
    path: join(docsPath, "meta.json"),
    content: metaJson("Host operations", [
      "index",
      ...namespaces.flatMap((space) => [`---${space}---`, `...${space}`]),
    ]),
  };

  const files = [
    top,
    ...metas,
    ...operations.map((operation) => ({ path: operation.path, content: renderPage(operation) })),
  ];

  const formatted = await Promise.all(
    files.map(async (file) => ({
      path: file.path,
      content: await formatFile(file.path, file.content),
    })),
  );

  return new Map(formatted.map((file) => [file.path, file.content]));
}

function metaJson(title: string, pages: readonly string[]): string {
  return `${JSON.stringify({ title, pages })}\n`;
}

function renderPage(operation: Operation): string {
  const existing = existsSync(operation.path) ? readFileSync(operation.path, "utf8") : "";
  const written = handWritten(existing).trim();
  const row = operation.row;

  return [
    "---",
    `title: ${operation.name}`,
    `description: ${yamlText(row.summary)}`,
    "---",
    "",
    written === "" ? TODO : written,
    "",
    START,
    "",
    "## Declaration",
    "",
    `- Kind: \`${row.kind}\``,
    `- Authority: \`${row.authority}\``,
    `- Scope: \`${row.scope}\``,
    `- Capability: ${row.capability === undefined ? "none" : `\`${row.capability}\``}`,
    `- Recovery: ${row.recovery === undefined ? "none" : `\`${row.recovery}\``}`,
    `- Wait: ${row.wait === true ? "yes" : "no"}`,
    "",
    "### Input schema",
    "",
    "```json",
    JSON.stringify(operation.description.input, null, 2),
    "```",
    "",
    "### Output schema",
    "",
    "```json",
    JSON.stringify(operation.description.output, null, 2),
    "```",
    "",
    END,
    "",
  ].join("\n");
}

function handWritten(content: string): string {
  const close = content.startsWith("---\n") ? content.indexOf("\n---\n", 4) : -1;
  const body = close === -1 ? content : content.slice(close + 5);
  const start = body.indexOf(START);

  return start === -1 ? body : body.slice(0, start);
}

async function formatFile(path: string, text: string): Promise<string> {
  const result = await format(path, text);

  if (result.errors.length > 0)
    throw new Error(`oxfmt could not format ${relative(root, path)}: ${result.errors[0]?.message}`);

  return result.code;
}

function listPages(folder: string): string[] {
  if (!existsSync(folder)) return [];

  return readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".mdx") && path !== "index.mdx")
    .map((path) => join(folder, path));
}

function yamlText(text: string): string {
  return /^[\w(]/.test(text) && !/: | #/.test(text) ? text : JSON.stringify(text);
}

function pagePath(name: string): string {
  return join(docsPath, namespace(name), `${slug(name)}.mdx`);
}

function namespace(name: string): string {
  return name.slice(0, name.indexOf("."));
}

function slug(name: string): string {
  return name
    .slice(name.indexOf(".") + 1)
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
