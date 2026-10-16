/**
 * The canvas compiler, pure JavaScript so every host runs it the same:
 * sucrase strips the types and compiles the JSX, es-module-lexer finds the
 * imports and exports, and the import statements are rewritten to read from
 * the shell's runtime global. Only `react`, `react/jsx-runtime` and
 * `nyte/canvas` resolve, each to a fixed list of names, and the module must
 * export a default component.
 */
import { init, parse } from "es-module-lexer";
import { transform } from "sucrase";
import {
  CANVAS_CODE_LIMIT,
  CANVAS_GLOBAL,
  CANVAS_RUNTIME,
  CANVAS_SOURCE_LIMIT,
  JSX_RUNTIME_EXPORTS,
  KIT_EXPORTS,
  KIT_SPECIFIER,
  REACT_EXPORTS,
} from "./canvas-protocol.ts";

/**
 * Returns what the compiler answers for one TSX source: the ESM module to
 * ship, with the runtime it targets, or the diagnostics the model fixes.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CompileOutcome =
  | { readonly kind: "compiled"; readonly code: string; readonly runtime: number }
  | { readonly kind: "failed"; readonly errors: readonly CompileError[] };

/**
 * Returns one diagnostic, positioned in the TSX source when the compiler
 * knows where.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CompileError = {
  readonly line: number | null;
  readonly column: number | null;
  readonly text: string;
};

const SOURCE_FILE = "canvas.tsx";

const MODULES: Readonly<
  Record<string, { readonly field: string; readonly names: readonly string[] }>
> = {
  react: { field: "react", names: REACT_EXPORTS },
  "react/jsx-runtime": { field: "jsxRuntime", names: JSX_RUNTIME_EXPORTS },
  [KIT_SPECIFIER]: { field: "kit", names: KIT_EXPORTS },
};

const encoder = new TextEncoder();

/** Sucrase's "message (line:column)" trailer. */
const POSITION = /\((\d+):(\d+)\)\s*$/;

function at(line: number | null, column: number | null, text: string): CompileError {
  return { line, column, text };
}

/** Returns a module's position for an output offset, in the source's lines: sucrase keeps the line breaks and only prepends its jsx-runtime import on the first line. */
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

/**
 * Compiles one canvas source to the module the shell imports. The caps
 * default to the contract's; a test narrows them.
 *
 * @category plugins
 * @since 0.1.0
 */
export async function compileCanvas(
  source: string,
  limits: { readonly source?: number; readonly code?: number } = {},
): Promise<CompileOutcome> {
  const sourceLimit = limits.source ?? CANVAS_SOURCE_LIMIT;
  const codeLimit = limits.code ?? CANVAS_CODE_LIMIT;

  if (encoder.encode(source).byteLength > sourceLimit)
    return failed([at(null, null, `The source is over ${kb(sourceLimit)}; render less at once.`)]);
  let output: string;

  try {
    output = transform(source, {
      transforms: ["typescript", "jsx"],
      jsxRuntime: "automatic",
      production: true,
      filePath: SOURCE_FILE,
    }).code;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.replace(`Error transforming ${SOURCE_FILE}: `, "")
        : String(error);
    const position = POSITION.exec(message);

    return failed([
      at(
        position === null ? null : Number(position[1]),
        position === null ? null : Number(position[2]),
        message.replace(POSITION, "").trim(),
      ),
    ]);
  }

  await init;
  const [imports, exports] = parse(output, SOURCE_FILE);
  const injected = imports[0];
  const prefix =
    injected !== undefined &&
    injected.ss === 0 &&
    injected.n === "react/jsx-runtime" &&
    !source.startsWith(output.slice(0, injected.se))
      ? injected.se + (output[injected.se] === ";" ? 1 : 0)
      : 0;
  const errors: CompileError[] = [];
  const edits: { readonly start: number; readonly end: number; readonly text: string }[] = [];

  for (const entry of imports) {
    if (entry.d === -2) continue;
    const { line, column } = locate(output, entry.ss, prefix);
    const statement = output.slice(entry.ss, entry.se);

    if (statement.startsWith("export")) {
      errors.push(
        at(
          line,
          column,
          "A canvas cannot re-export from a module; import, then export your own names.",
        ),
      );

      continue;
    }

    const specifier = entry.n;

    if (specifier === undefined) {
      errors.push(
        at(
          line,
          column,
          `Only "react" and "${KIT_SPECIFIER}" can be imported, by name: a computed import() is not available.`,
        ),
      );

      continue;
    }

    const module = MODULES[specifier];

    if (module === undefined) {
      errors.push(
        at(
          line,
          column,
          `Only "react" and "${KIT_SPECIFIER}" can be imported; "${specifier}" is not available.`,
        ),
      );

      continue;
    }

    const global = `globalThis.${CANVAS_GLOBAL}.${module.field}`;

    if (entry.d >= 0) {
      edits.push({ start: entry.ss, end: entry.se, text: `Promise.resolve(${global})` });

      continue;
    }

    const from = statement.lastIndexOf("from");
    const clause = from === -1 ? "" : statement.slice("import".length, from);
    const bound = bindings(clause);

    if (bound === undefined) {
      errors.push(
        at(
          line,
          column,
          "This import could not be read; write it as `import X from`, `import * as X from` or `import { a, b as c } from`.",
        ),
      );

      continue;
    }

    const unknown = bound.filter(
      (binding) =>
        binding.imported !== "default" &&
        binding.imported !== "*" &&
        !module.names.includes(binding.imported),
    );

    for (const binding of unknown)
      errors.push(at(line, column, `"${specifier}" has no export named "${binding.imported}".`));

    if (unknown.length > 0) continue;

    const whole = bound
      .filter((binding) => binding.imported === "default" || binding.imported === "*")
      .map((binding) => `const ${binding.local} = ${global};`);
    const named = bound
      .filter((binding) => binding.imported !== "default" && binding.imported !== "*")
      .map((binding) =>
        binding.local === binding.imported
          ? binding.imported
          : `${binding.imported}: ${binding.local}`,
      );

    edits.push({
      start: entry.ss,
      end: entry.se,
      text: [
        ...whole,
        ...(named.length === 0 ? [] : [`const { ${named.join(", ")} } = ${global};`]),
      ].join(" "),
    });
  }

  if (!exports.some((entry) => entry.n === "default"))
    errors.push(at(null, null, "The module must `export default` a component."));

  if (errors.length > 0) return failed(errors);
  let code = output;

  for (const edit of edits.toSorted((left, right) => right.start - left.start))
    code = `${code.slice(0, edit.start)}${edit.text}${code.slice(edit.end)}`;

  if (encoder.encode(code).byteLength > codeLimit)
    return failed([
      at(null, null, `The compiled canvas is over ${kb(codeLimit)}; render less at once.`),
    ]);

  return { kind: "compiled", code, runtime: CANVAS_RUNTIME };
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

function failed(errors: readonly CompileError[]): CompileOutcome {
  return { kind: "failed", errors };
}
