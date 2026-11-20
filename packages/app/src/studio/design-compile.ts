import { transform } from "sucrase";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  BOARD_GLOBAL,
  DESIGN_ATTRIBUTE,
  spanKey,
  textDigest,
} from "@nyte-ai/plugin/design/board-protocol";
import type { AppMessage, BoardModule } from "@nyte-ai/plugin/design/board-protocol";
import { parseDesign } from "./design-source.ts";
import type { DesignSource } from "./design-source.ts";
import type { Designs } from "./designs.ts";

export type BoardLoad = Extract<AppMessage, { kind: "load" }>;

interface File {
  readonly path: string;
  readonly text: string;
  readonly source: DesignSource;
}

type Compiled =
  | { readonly kind: "code"; readonly code: string }
  | {
      readonly kind: "failed";
      readonly message: string;
      readonly line: number | null;
      readonly column: number | null;
    };

type Target =
  | { readonly kind: "module"; readonly path: string }
  | { readonly kind: "style"; readonly path: string }
  | { readonly kind: "missing"; readonly message: string };

const RUNTIME = { react: "react", "react/jsx-runtime": "jsxRuntime" } as const;

const LOAD = "__nyteBoardLoad";

const PositionedType = Type.Object({ pos: Type.Integer({ minimum: 0 }) });

const compiled = new Map<string, { readonly text: string; readonly body: Compiled }>();

let last: { readonly sent: string; readonly load: BoardLoad } | undefined;

export async function buildBoard(designs: Designs): Promise<BoardLoad> {
  const files = (
    await Promise.all(
      designs.paths
        .filter((path) => path.endsWith(".jsx"))
        .map(async (path): Promise<File | undefined> => {
          const text = designs.texts.get(path);

          return text === undefined
            ? undefined
            : { path, text, source: await parseDesign(path, text) };
        }),
    )
  ).filter((file) => file !== undefined);

  const styles = designs.paths.flatMap((path) => {
    const text = designs.texts.get(path);

    return path.endsWith(".css") && text !== undefined ? [{ path, text }] : [];
  });

  const known = new Set([...files, ...styles].map((file) => file.path));

  const linked = files.map((file) => ({
    file,
    targets: new Map(
      file.source.imports
        .filter((specifier) => !Object.hasOwn(RUNTIME, specifier))
        .map((specifier) => [specifier, resolveImport({ from: file.path, specifier, known })]),
    ),
  }));

  const imports = new Map(
    linked.map((link) => [
      link.file.path,
      [...link.targets.values()].flatMap((target) =>
        target.kind === "missing" ? [] : [target.path],
      ),
    ]),
  );

  const shown = {
    modules: linked.map((link): BoardModule => ({
      path: link.file.path,
      code: writeModule(link.file.path, compileFile(link.file), link.targets),
      digest: textDigest(link.file.text),
    })),
    sheets: files
      .filter((file) => file.source.sheet)
      .map((file) => ({ path: file.path, reads: readGraph(file.path, imports) })),
    styles,
    texts: files.flatMap((file) =>
      file.source.elements
        .filter((element) => element.host && element.words !== null)
        .map((element) => spanKey({ path: file.path, start: element.start, end: element.end })),
    ),
    frames: files.flatMap((file) =>
      file.source.frames.map((frame) => ({
        key: spanKey({ path: file.path, start: frame.element.start, end: frame.element.end }),
        movable: frame.x !== null && frame.y !== null,
        pinned: frame.element.pinned,
      })),
    ),
  };

  const sent = JSON.stringify(shown);

  if (last?.sent === sent) return last.load;
  const load: BoardLoad = { kind: "load", build: (last?.load.build ?? 0) + 1, ...shown };
  last = { sent, load };

  return load;
}

export async function readPageAddresses(designs: Designs): Promise<ReadonlyMap<string, string>> {
  const files = await Promise.all(
    designs.paths
      .filter((path) => path.endsWith(".jsx"))
      .map(async (path) => {
        const text = designs.texts.get(path);

        return text === undefined ? [] : [{ path, source: await parseDesign(path, text) }];
      }),
  );

  return new Map(
    files.flat().flatMap((file) =>
      file.source.frames.flatMap((frame) =>
        frame.page === null
          ? []
          : [
              [
                spanKey({
                  path: file.path,
                  start: frame.element.start,
                  end: frame.element.end,
                }),
                frame.page,
              ] as const,
            ],
      ),
    ),
  );
}

function resolvePath(from: string, specifier: string): string {
  const parts = from.split("/").slice(0, -1);

  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;

    if (part === "..") parts.pop();
    else parts.push(part);
  }

  return parts.join("/");
}

function readGraph(start: string, imports: ReadonlyMap<string, readonly string[]>): string[] {
  const seen = [start];

  for (const path of seen)
    for (const next of imports.get(path) ?? []) if (!seen.includes(next)) seen.push(next);

  return seen;
}

function resolveImport(input: {
  readonly from: string;
  readonly specifier: string;
  readonly known: ReadonlySet<string>;
}): Target {
  if (!input.specifier.startsWith("./") && !input.specifier.startsWith("../"))
    return {
      kind: "missing",
      message: `${input.from} imports ${JSON.stringify(input.specifier)}: a design imports react and its own .jsx and .css files, nothing else.`,
    };
  const path = resolvePath(input.from, input.specifier);

  if (path.endsWith(".css"))
    return input.known.has(path)
      ? { kind: "style", path }
      : {
          kind: "missing",
          message: `${input.from} imports ${input.specifier}, which is not a stylesheet under design/.`,
        };

  return path.endsWith(".jsx") && input.known.has(path)
    ? { kind: "module", path }
    : { kind: "missing", message: `${path} is not a design file.` };
}

function compileFile(file: File): Compiled {
  const known = compiled.get(file.path);

  if (known?.text === file.text) return known.body;

  const stamps = file.source.elements
    .map((element) => ({
      at: element.stampAt,
      text: ` ${DESIGN_ATTRIBUTE.source}={${JSON.stringify(
        spanKey({ path: file.path, start: element.start, end: element.end }),
      )}}`,
    }))
    .toSorted((left, right) => left.at - right.at);

  const stamped = stamps.reduceRight(
    (text, stamp) => `${text.slice(0, stamp.at)}${stamp.text}${text.slice(stamp.at)}`,
    file.text,
  );

  const body = compileText({ path: file.path, text: file.text, stamped, stamps });
  compiled.set(file.path, { text: file.text, body });

  return body;
}

function compileText(input: {
  readonly path: string;
  readonly text: string;
  readonly stamped: string;
  readonly stamps: readonly { readonly at: number; readonly text: string }[];
}): Compiled {
  try {
    return {
      kind: "code",
      code: transform(input.stamped, {
        transforms: ["jsx", "imports"],
        jsxRuntime: "automatic",
        production: true,
        filePath: input.path,
      }).code,
    };
  } catch (error) {
    const prefix = `Error transforming ${input.path}: `;
    const raw = error instanceof Error ? error.message : String(error);

    const message = (raw.startsWith(prefix) ? raw.slice(prefix.length) : raw).replace(
      / \(\d+:\d+\)$/u,
      "",
    );

    if (!Value.Check(PositionedType, error))
      return { kind: "failed", message, line: null, column: null };
    const lines = input.text.slice(0, unstamp(error.pos, input.stamps)).split("\n");

    return {
      kind: "failed",
      message,
      line: lines.length,
      column: (lines.at(-1)?.length ?? 0) + 1,
    };
  }
}

function unstamp(
  at: number,
  stamps: readonly { readonly at: number; readonly text: string }[],
): number {
  let shift = 0;

  for (const stamp of stamps) {
    const from = stamp.at + shift;

    if (at < from) break;

    if (at < from + stamp.text.length) return stamp.at;
    shift += stamp.text.length;
  }

  return at - shift;
}

function writeModule(path: string, body: Compiled, targets: ReadonlyMap<string, Target>): string {
  const board = `globalThis.${BOARD_GLOBAL}`;
  const open = `${board}.define(${JSON.stringify(path)}, function (exports, ${LOAD}) {`;

  if (body.kind === "failed")
    return `${open} throw Object.assign(new Error(${JSON.stringify(body.message)}), ${JSON.stringify(
      { path, line: body.line, column: body.column },
    )});\n});\n`;

  const cases = [
    ...Object.entries(RUNTIME).map(
      (entry) => `case ${JSON.stringify(entry[0])}: return ${board}.${entry[1]};`,
    ),
    ...[...targets].map((entry) => `case ${JSON.stringify(entry[0])}: ${writeTarget(entry[1])}`),
  ];

  return [
    `${open}${body.code}`,
    `function require(specifier) { switch (specifier) { ${cases.join(" ")} default: throw new Error(${JSON.stringify(
      `${path} imports `,
    )} + JSON.stringify(specifier) + ": a design imports react and its own .jsx and .css files, nothing else."); } }`,
    "});",
    "",
  ].join("\n");
}

function writeTarget(target: Target): string {
  switch (target.kind) {
    case "module":
      return `return ${LOAD}(${JSON.stringify(target.path)});`;
    case "style":
      return `globalThis.${BOARD_GLOBAL}.style(${JSON.stringify(target.path)}); return {};`;
    case "missing":
      return `throw new Error(${JSON.stringify(target.message)});`;
    default: {
      const _exhaustive: never = target;

      return _exhaustive;
    }
  }
}
