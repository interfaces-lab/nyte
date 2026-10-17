/**
 * The canvas compiler, pure JavaScript so every host runs it the same. A
 * canvas is a small module graph: `main.tsx` and the files it imports by
 * relative path. Sucrase strips each file's types and compiles its JSX,
 * es-module-lexer checks its imports and exports, and a second sucrase pass
 * turns it into a function the module's linker calls on first `require`.
 * Only `react`, `react/jsx-runtime`, `react-dom`, `nyte/canvas`, the
 * libraries and the canvas's own files resolve, each to a fixed list of
 * names, and `main.tsx` must export a default component. Sucrase keeps
 * every line where it was, so the files comment on the module's first line
 * maps a runtime position back to its file and line.
 */
import { init, parse } from "es-module-lexer";
import type { ImportSpecifier } from "es-module-lexer";
import { transform } from "sucrase";
import {
  CANVAS_CODE_LIMIT,
  CANVAS_ENTRY,
  CANVAS_GLOBAL,
  CANVAS_SOURCE_LIMIT,
  JSX_RUNTIME_EXPORTS,
  KIT_EXPORTS,
  KIT_SPECIFIER,
  LIBRARY_EXPORTS,
  REACT_DOM_EXPORTS,
  REACT_EXPORTS,
  canvasFilesComment,
} from "./canvas-protocol.ts";
import type { CanvasFileSpan } from "./canvas-protocol.ts";

/**
 * Returns what the compiler answers for one canvas: the ESM module to ship,
 * with the runtime it targets, or the diagnostics the model fixes.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CompileOutcome =
  | { readonly kind: "compiled"; readonly code: string; readonly runtime: number }
  | { readonly kind: "failed"; readonly errors: readonly CompileError[] };

/**
 * Returns one diagnostic, positioned in a source file when the compiler
 * knows where; `file` is null for one about the canvas as a whole.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CompileError = {
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly text: string;
};

/**
 * Returns a canvas's other files, keyed by their path from `main.tsx`'s
 * folder, such as `chart.tsx` or `lib/scale.ts`.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CanvasFiles = Readonly<Record<string, string>>;

/** The modules outside the canvas it may import, by specifier: the expression the linker reads each from, and the names it exports. */
const EXTERNAL = new Map<string, { readonly value: string; readonly names: readonly string[] }>([
  ["react", { value: `globalThis.${CANVAS_GLOBAL}.react`, names: REACT_EXPORTS }],
  [
    "react/jsx-runtime",
    { value: `globalThis.${CANVAS_GLOBAL}.jsxRuntime`, names: JSX_RUNTIME_EXPORTS },
  ],
  ["react-dom", { value: `globalThis.${CANVAS_GLOBAL}.reactDom`, names: REACT_DOM_EXPORTS }],
  [KIT_SPECIFIER, { value: `globalThis.${CANVAS_GLOBAL}.kit`, names: KIT_EXPORTS }],
  ...Object.entries(LIBRARY_EXPORTS).map(
    ([name, names]) =>
      [
        name,
        { value: `await globalThis.${CANVAS_GLOBAL}.library(${JSON.stringify(name)})`, names },
      ] as const,
  ),
]);

/** The specifiers a runtime 1 shell cannot resolve; a canvas that imports none of them targets runtime 1, so a shell from before them still renders it. */
const RUNTIME_2 = new Set(["react-dom", ...Object.keys(LIBRARY_EXPORTS)]);

const IMPORTABLE = [...EXTERNAL.keys()]
  .filter((name) => name !== "react/jsx-runtime")
  .map((name) => `"${name}"`)
  .join(", ");

const FILE_NAME = /^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.tsx?$/u;

const encoder = new TextEncoder();

/** Sucrase's "message (line:column)" trailer. */
const POSITION = /\((\d+):(\d+)\)\s*$/;

function at(file: string | null, line: number | null, column: number | null, text: string) {
  return { file, line, column, text };
}

/** Returns a file's position for an output offset, in the source's lines: sucrase keeps the line breaks and only prepends its jsx-runtime import on the first line. */
function locate(
  output: string,
  offset: number,
  prefix: number,
): { readonly line: number; readonly column: number } {
  const before = output.slice(0, offset);
  const line = before.split("\n").length;
  const column =
    offset - (before.lastIndexOf("\n") + 1) - (line === 1 ? Math.min(prefix, offset) : 0);

  return { line, column };
}

type Binding = { readonly imported: string; readonly local: string };

/** Reads an import clause (`X`, `* as X`, `{ a, b as c }`, or `X, { … }`) into its bindings, or undefined when it is not one of those. */
function bindings(clause: string): readonly Binding[] | undefined {
  const text = clause.trim();

  if (text === "") return [];
  const match =
    /^(?:([A-Za-z_$][\w$]*)\s*(?:,\s*)?)?(?:\*\s*as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})?$/u.exec(
      text,
    );

  if (match === null) return undefined;
  const [, defaultName, namespace, named] = match;
  const found: Binding[] = [];

  if (defaultName !== undefined) found.push({ imported: "default", local: defaultName });

  if (namespace !== undefined) found.push({ imported: "*", local: namespace });

  for (const entry of (named ?? "").split(",")) {
    const piece = entry.trim();

    if (piece === "") continue;
    const pair = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u.exec(piece);

    if (pair === null) return undefined;
    found.push({ imported: pair[1] ?? "", local: pair[2] ?? pair[1] ?? "" });
  }

  return found;
}

/** Returns the canvas file a relative specifier names from `importer`, trying `.tsx`, `.ts` and `index` after the literal path, or undefined when none is a file. */
function resolveFile(
  importer: string,
  specifier: string,
  names: ReadonlySet<string>,
): string | undefined {
  const segments = importer.split("/").slice(0, -1);

  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;

    if (segment !== "..") {
      segments.push(segment);
      continue;
    }

    if (segments.pop() === undefined) return undefined;
  }

  const path = segments.join("/");
  const bare = path.replace(/\.jsx?$/u, "");

  return [path, `${bare}.tsx`, `${bare}.ts`, `${path}/index.tsx`, `${path}/index.ts`].find(
    (candidate) => names.has(candidate),
  );
}

type Unit = {
  readonly file: string;
  readonly output: string;
  readonly exports: readonly string[];
  readonly edits: { readonly start: number; readonly end: number; readonly text: string }[];
  readonly wants: {
    readonly target: string;
    readonly specifier: string;
    readonly names: readonly string[];
    readonly line: number;
    readonly column: number;
  }[];
};

/** Strips one file's types and JSX, then checks its imports: each must name an allowed module or a canvas file, by a literal specifier. */
function checkFile(
  file: string,
  source: string,
  names: ReadonlySet<string>,
  errors: CompileError[],
  externals: Set<string>,
): Unit | undefined {
  let output: string;

  try {
    output = transform(source, {
      transforms: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
      jsxRuntime: "automatic",
      production: true,
      filePath: file,
    }).code;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.replace(`Error transforming ${file}: `, "")
        : String(error);
    const position = POSITION.exec(message);

    errors.push(
      at(
        file,
        position === null ? null : Number(position[1]),
        position === null ? null : Number(position[2]),
        message.replace(POSITION, "").trim(),
      ),
    );

    return undefined;
  }

  const [imports, exports] = parse(output, file);
  const injected = imports[0];
  const prefix =
    injected !== undefined &&
    injected.ss === 0 &&
    injected.n === "react/jsx-runtime" &&
    !source.startsWith(output.slice(0, injected.se))
      ? injected.se + (output[injected.se] === ";" ? 1 : 0)
      : 0;
  const unit: Unit = {
    file,
    output,
    exports: exports.map((entry) => entry.n),
    edits: [],
    wants: [],
  };

  for (const entry of imports) checkImport(unit, entry, prefix, names, errors, externals);

  for (const found of findLinkerNames(output)) {
    const { line, column } = locate(output, found.offset, prefix);
    errors.push(
      at(
        file,
        line,
        column,
        `Rename \`${found.name}\`: the module linker owns that name in a canvas file.`,
      ),
    );
  }

  return unit;
}

/**
 * Finds the identifiers `exports` and `require` in a file's code outside
 * strings, comments and property names. The second sucrase pass reads an
 * exported binding through `exports.name` and an import through `require`,
 * so a local of either name would capture the linker's.
 */
function findLinkerNames(
  code: string,
): readonly { readonly name: string; readonly offset: number }[] {
  const found: { readonly name: string; readonly offset: number }[] = [];
  const scan =
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`|(?<!\.\s*)(?<![\w$])(exports|require)(?![\w$])(?!\s*:)/gu;

  for (const match of code.matchAll(scan))
    if (match[1] !== undefined) found.push({ name: match[1], offset: match.index });

  return found;
}

function checkImport(
  unit: Unit,
  entry: ImportSpecifier,
  prefix: number,
  names: ReadonlySet<string>,
  errors: CompileError[],
  externals: Set<string>,
): void {
  if (entry.d === -2) return;
  const { file, output } = unit;
  const { line, column } = locate(output, entry.ss, prefix);
  const statement = output.slice(entry.ss, entry.se);
  const fail = (text: string): void => {
    errors.push(at(file, line, column, text));
  };

  if (statement.startsWith("export")) {
    fail("A canvas cannot re-export from a module; import, then export your own names.");

    return;
  }

  const specifier = entry.n;

  if (specifier === undefined) {
    fail(
      `A computed import() is not available; import ${IMPORTABLE} or a canvas file by a literal name.`,
    );

    return;
  }

  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  const target = relative ? resolveFile(file, specifier, names) : undefined;
  const external = relative ? undefined : EXTERNAL.get(specifier);

  if (relative && target === undefined) {
    fail(`"${specifier}" is not one of this canvas's files; pass it in \`files\`.`);

    return;
  }

  if (external === undefined && target === undefined) {
    fail(
      `"${specifier}" is not available. A canvas can import ${IMPORTABLE} and its own files by relative path.`,
    );

    return;
  }

  if (external !== undefined) externals.add(specifier);

  if (target !== undefined) {
    const quoted = output[entry.s] === '"' || output[entry.s] === "'";
    unit.edits.push({
      start: quoted ? entry.s + 1 : entry.s,
      end: quoted ? entry.e - 1 : entry.e,
      text: target,
    });
  }

  if (entry.d >= 0) return;
  const from = statement.lastIndexOf("from");
  const bound = bindings(from === -1 ? "" : statement.slice("import".length, from));

  if (bound === undefined) {
    fail(
      "This import could not be read; write it as `import X from`, `import * as X from` or `import { a, b as c } from`.",
    );

    return;
  }

  const named = bound
    .filter((binding) => binding.imported !== "default" && binding.imported !== "*")
    .map((binding) => binding.imported);

  if (target !== undefined) {
    unit.wants.push({
      target,
      specifier,
      names: bound.some((binding) => binding.imported === "default")
        ? [...named, "default"]
        : named,
      line,
      column,
    });

    return;
  }

  for (const name of named)
    if (!(external?.names ?? []).includes(name))
      fail(`"${specifier}" has no export named "${name}".`);
}

/** Turns a checked file into CommonJS over the linker's `require`, its relative specifiers rewritten to canvas file names; sucrase keeps the lines. */
function link(unit: Unit): string {
  let code = unit.output;

  for (const edit of unit.edits.toSorted((left, right) => right.start - left.start))
    code = `${code.slice(0, edit.start)}${edit.text}${code.slice(edit.end)}`;

  return transform(code, { transforms: ["imports"], production: true, filePath: unit.file }).code;
}

/**
 * Compiles a canvas, `source` as `main.tsx` plus the `files` it imports,
 * to the one module the shell imports. The caps default to the contract's;
 * a test narrows them.
 *
 * @category plugins
 * @since 0.1.0
 */
export async function compileCanvas(
  source: string,
  files: CanvasFiles = {},
  limits: { readonly source?: number; readonly code?: number } = {},
): Promise<CompileOutcome> {
  const sourceLimit = limits.source ?? CANVAS_SOURCE_LIMIT;
  const codeLimit = limits.code ?? CANVAS_CODE_LIMIT;
  const sources = [
    [CANVAS_ENTRY, source],
    ...Object.entries(files).map(([name, text]) => [name.replace(/^\.\//u, ""), text]),
  ];
  const bytes = sources.reduce((sum, [, text]) => sum + encoder.encode(text).byteLength, 0);

  if (bytes > sourceLimit)
    return failed([
      at(null, null, null, `The source is over ${kb(sourceLimit)}; render less at once.`),
    ]);
  const errors: CompileError[] = [];
  const names = new Set<string>();

  for (const [name = ""] of sources) {
    if (names.has(name))
      errors.push(
        at(
          name,
          null,
          null,
          name === CANVAS_ENTRY
            ? `\`files\` cannot hold ${CANVAS_ENTRY}; that is \`source\`.`
            : "This file is named twice.",
        ),
      );
    else if (!FILE_NAME.test(name))
      errors.push(
        at(
          name,
          null,
          null,
          "A canvas file is a path inside the canvas, such as `chart.tsx` or `lib/scale.ts`.",
        ),
      );
    names.add(name);
  }

  if (errors.length > 0) return failed(errors);
  await init;
  const externals = new Set<string>();
  const units = sources.flatMap(([name = "", text = ""]) => {
    const unit = checkFile(name, text, names, errors, externals);

    return unit === undefined ? [] : [unit];
  });
  const exported = new Map(units.map((unit) => [unit.file, unit.exports]));

  for (const unit of units)
    for (const want of unit.wants)
      for (const name of want.names)
        if (exported.get(want.target)?.includes(name) === false)
          errors.push(
            at(
              unit.file,
              want.line,
              want.column,
              name === "default"
                ? `"${want.specifier}" has no default export.`
                : `"${want.specifier}" has no export named "${name}".`,
            ),
          );

  if (exported.get(CANVAS_ENTRY)?.includes("default") === false)
    errors.push(at(CANVAS_ENTRY, null, null, "The module must `export default` a component."));

  if (errors.length > 0) return failed(errors);
  const code = bundle(units, externals);

  if (encoder.encode(code).byteLength > codeLimit)
    return failed([
      at(null, null, null, `The compiled canvas is over ${kb(codeLimit)}; render less at once.`),
    ]);

  return {
    kind: "compiled",
    code,
    runtime: [...externals].some((name) => RUNTIME_2.has(name)) ? 2 : 1,
  };
}

/**
 * Lays the files out as one ES module: the files comment and the external
 * modules the files import on line one, then each file's function with its code starting on
 * a line of its own, then the linker, which runs each file once on first
 * `require`, and the entry's default export.
 */
function bundle(units: readonly Unit[], imported: ReadonlySet<string>): string {
  const externals = [...EXTERNAL]
    .filter(([name]) => imported.has(name))
    .map(([name, external]) => `${JSON.stringify(name)}: ${external.value}`);
  const spans: CanvasFileSpan[] = [];
  const body: string[] = [];
  let line = 2;

  for (const unit of units) {
    const code = link(unit);
    const lines = code.split("\n").length;
    spans.push([unit.file, line + 1, lines]);
    body.push(`${JSON.stringify(unit.file)}: function (exports, require) {`, code, "},");
    line += lines + 2;
  }

  return [
    `${canvasFilesComment(spans)}const __external = { ${externals.join(", ")} }; const __files = {`,
    ...body,
    "}; const __modules = new Map();",
    "function __require(name) { if (Object.hasOwn(__external, name)) return __external[name]; let found = __modules.get(name); if (found === undefined) { found = {}; __modules.set(name, found); __files[name](found, __require); } return found; }",
    `export default __require(${JSON.stringify(CANVAS_ENTRY)}).default;`,
    "",
  ].join("\n");
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

function failed(errors: readonly CompileError[]): CompileOutcome {
  return { kind: "failed", errors };
}
