import type { FilesApi, LanguageApi, ToolDefinition, ToolInvocation } from "@nyte-ai/core";
import { encodeTextFile, standard } from "@nyte-ai/schema";
import type {
  DiagnosticsFrame,
  FileVersion,
  Infer,
  LanguageLocation,
  TextEdit,
  TextEncoding,
  TextPosition,
  WorkspaceEdit,
} from "@nyte-ai/schema";
import type { Plugin } from "@nyte-ai/plugin/core";
import { Type } from "typebox";

const FRESH_DIAGNOSTICS_MS = 10_000;

const QUIET_DIAGNOSTICS_MS = 2000;

const path = Type.String({ description: "The file, relative to the workspace root." });

const at = {
  path,
  line: Type.Integer({ minimum: 1, description: "The 1-based line the symbol is on." }),
  symbol: Type.String({
    minLength: 1,
    description: "The symbol's name as written on that line; its first occurrence there is used.",
  }),
};

const SymbolAt = standard(Type.Object(at));

type SymbolAt = Infer<typeof SymbolAt>;

const InFile = standard(Type.Object({ path }));

const Rename = standard(
  Type.Object({ ...at, newName: Type.String({ minLength: 1, description: "The new name." }) }),
);

async function requireLanguage(invocation: ToolInvocation): Promise<LanguageApi> {
  const capability = await invocation.workspace.language();

  if (capability.kind !== "available") {
    throw new Error(`No language intelligence is available here: ${capability.reason}`);
  }

  return capability.api;
}

async function requireFiles(invocation: ToolInvocation): Promise<FilesApi> {
  const capability = await invocation.workspace.files();

  if (capability.kind !== "available") {
    throw new Error(`No files are available here: ${capability.reason}`);
  }

  return capability.api;
}

async function readText(
  files: FilesApi,
  file: string,
): Promise<{
  readonly contents: string;
  readonly encoding: TextEncoding;
  readonly version: FileVersion;
}> {
  const document = await files.read(file);

  if (document.kind !== "text") throw new Error(`${file} is not a text file.`);

  return { contents: document.contents, encoding: document.encoding, version: document.version };
}

async function locate(files: FilesApi, input: SymbolAt): Promise<TextPosition> {
  const text = (await readText(files, input.path)).contents;
  const line = text.split("\n")[input.line - 1];

  if (line === undefined) throw new Error(`${input.path} has no line ${input.line}.`);
  const escaped = RegExp.escape(input.symbol);

  const found =
    new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, "u").exec(line) ??
    new RegExp(escaped, "u").exec(line);

  if (found === null) {
    throw new Error(`Line ${input.line} of ${input.path} does not contain ${input.symbol}.`);
  }

  return { line: input.line - 1, utf16Column: found.index };
}

function describeLocations(locations: readonly LanguageLocation[]): string {
  return locations
    .map(
      (location) =>
        `${location.path}:${location.range.start.line + 1}:${location.range.start.utf16Column + 1}`,
    )
    .join("\n");
}

function reply(value: string) {
  return { content: [{ kind: "text" as const, text: value }] };
}

const definition: ToolDefinition<SymbolAt> = {
  name: "code_definition",
  description:
    "Find where a symbol is defined, using the workspace's language server (Go, TypeScript, JavaScript). Answers path:line:column per definition.",
  parameters: SymbolAt,
  class: (args) => ({ kind: "read", path: args.path }),
  changes: "none",
  rerun: "safe",
  async execute(args, invocation) {
    const language = await requireLanguage(invocation);
    const position = await locate(await requireFiles(invocation), args);
    const found = await language.definition({ path: args.path, position });

    return reply(
      found.length === 0 ? `No definition found for ${args.symbol}.` : describeLocations(found),
    );
  },
};

const references: ToolDefinition<SymbolAt> = {
  name: "code_references",
  description:
    "Find every reference to a symbol, its declaration included, using the workspace's language server (Go, TypeScript, JavaScript). Answers path:line:column per reference.",
  parameters: SymbolAt,
  class: (args) => ({ kind: "read", path: args.path }),
  changes: "none",
  rerun: "safe",
  async execute(args, invocation) {
    const language = await requireLanguage(invocation);
    const position = await locate(await requireFiles(invocation), args);

    const found = await language.references({
      path: args.path,
      position,
      includeDeclaration: true,
    });

    return reply(
      found.length === 0
        ? `No references found for ${args.symbol}.`
        : `${found.length} references:\n${describeLocations(found)}`,
    );
  },
};

const diagnostics: ToolDefinition<Infer<typeof InFile>> = {
  name: "code_diagnostics",
  description:
    "List the compiler and analyzer errors and warnings for a file as it is on disk, from the workspace's language server (Go, TypeScript, JavaScript).",
  parameters: InFile,
  class: (args) => ({ kind: "read", path: args.path }),
  changes: "none",
  rerun: "safe",
  async execute(args, invocation) {
    const language = await requireLanguage(invocation);
    const frame = await diagnosticsFor(language, args.path);

    if (frame === null) return reply(`No language server reported on ${args.path}.`);

    return reply(
      frame.diagnostics.length === 0
        ? `${args.path} has no diagnostics.`
        : frame.diagnostics
            .map(
              (diagnostic) =>
                `${args.path}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.utf16Column + 1} ${diagnostic.severity}: ${diagnostic.message}`,
            )
            .join("\n"),
    );
  },
};

async function diagnosticsFor(
  language: LanguageApi,
  file: string,
): Promise<DiagnosticsFrame | null> {
  const stream = language.diagnostics()[Symbol.asyncIterator]();
  const first = await stream.next();
  let latest =
    first.done === true ? null : (first.value.find((frame) => frame.path === file) ?? null);
  let heard = false;
  let pending = stream.next();
  await language.symbols({ path: file });
  const deadline = Date.now() + FRESH_DIAGNOSTICS_MS;

  try {
    for (;;) {
      const wait = Math.min(
        deadline - Date.now(),
        heard ? QUIET_DIAGNOSTICS_MS : Number.POSITIVE_INFINITY,
      );

      if (wait <= 0) return latest;
      const next = await Promise.race([
        pending,
        new Promise<null>((resolve) => {
          setTimeout(resolve, wait, null);
        }),
      ]);

      if (next === null || next.done === true) return latest;
      pending = stream.next();
      const frame = next.value.find((entry) => entry.path === file);

      if (frame !== undefined) {
        latest = frame;
        heard = true;
      }
    }
  } finally {
    await stream.return?.();
  }
}

const rename: ToolDefinition<Infer<typeof Rename>> = {
  name: "code_rename",
  description:
    "Rename a symbol everywhere the workspace's language server (Go, TypeScript, JavaScript) finds it, and write the edited files. Refuses, changing nothing, when a file changed since the server read it.",
  parameters: Rename,
  class: (args) => ({ kind: "edit", path: args.path }),
  rerun: "never",
  async execute(args, invocation) {
    const language = await requireLanguage(invocation);
    const files = await requireFiles(invocation);
    const position = await locate(files, args);
    const outcome = await language.rename({ path: args.path, position, name: args.newName });

    if (outcome.kind === "refused") throw new Error(`The rename was refused: ${outcome.reason}`);
    const written = await applyEdit(files, outcome.edit, args.symbol);
    const count = outcome.edit.files.reduce((total, file) => total + file.edits.length, 0);

    return reply(
      `Renamed ${args.symbol} to ${args.newName}: ${count} edits in ${written.join(", ")}.`,
    );
  },
};

async function applyEdit(
  files: FilesApi,
  edit: WorkspaceEdit,
  old: string,
): Promise<readonly string[]> {
  const planned = await Promise.all(
    edit.files.map(async (file) => {
      const read = await readText(files, file.path);
      const offsets = lineOffsets(read.contents);

      const ranges = file.edits.map((change) => ({
        change,
        start: offset(offsets, change.range.start),
        end: offset(offsets, change.range.end),
      }));

      if (ranges.some((range) => !read.contents.slice(range.start, range.end).includes(old))) {
        throw new Error(
          `${file.path} changed since the language server read it; nothing was renamed.`,
        );
      }

      return {
        path: file.path,
        read,
        contents: encodeTextFile(replaceRanges(read.contents, ranges), read.encoding),
      };
    }),
  );

  for (const file of planned) {
    const outcome = await files.write(file.path, file.contents, { expect: file.read.version });

    if (outcome.kind !== "saved") {
      const done = planned.slice(0, planned.indexOf(file)).map((entry) => entry.path);

      throw new Error(
        `${file.path} changed while renaming, so it was left as it was${done.length === 0 ? "" : `; these were already renamed: ${done.join(", ")}`}.`,
      );
    }
  }

  return planned.map((file) => file.path);
}

function lineOffsets(contents: string): readonly number[] {
  return [0, ...[...contents.matchAll(/\n/g)].map((match) => match.index + 1)];
}

function offset(offsets: readonly number[], position: TextPosition): number {
  return (offsets[position.line] ?? Number.POSITIVE_INFINITY) + position.utf16Column;
}

function replaceRanges(
  contents: string,
  ranges: readonly { readonly change: TextEdit; readonly start: number; readonly end: number }[],
): string {
  return ranges
    .toSorted((left, right) => right.start - left.start)
    .reduce(
      (current, range) =>
        current.slice(0, range.start) + range.change.text + current.slice(range.end),
      contents,
    );
}

export default {
  id: "language-tools",
  contribute: { tools: [definition, references, diagnostics, rename] },
} satisfies Plugin;
