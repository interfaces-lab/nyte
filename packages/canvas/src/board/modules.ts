import type { ComponentType } from "react";
import type { BoardModule, Digest, SheetError } from "@nyte-ai/plugin/design/board-protocol";

type Exports = Record<string, unknown>;

type Load = (path: string) => Exports;

type Factory = (exports: Exports, load: Load) => unknown;

type Outcome =
  | { readonly kind: "defined"; readonly factory: Factory }
  | { readonly kind: "failed"; readonly error: SheetError };

interface Registered {
  readonly code: string;
  readonly digest: Digest;
  readonly revision: number;
  readonly outcome: Outcome;
}

interface Evaluation {
  readonly path: string;
  readonly url: string;
  factory: Factory | null;
  error: SheetError | null;
}

export type SheetOutcome =
  | {
      readonly kind: "drawn";
      readonly Sheet: ComponentType;
      readonly styles: ReadonlySet<string>;
    }
  | { readonly kind: "failed"; readonly error: SheetError };

export type Place = Omit<SheetError, "message">;

const NOWHERE: Place = { path: null, line: null, column: null };

class SheetFailure extends Error {
  readonly sheet: SheetError;

  constructor(sheet: SheetError) {
    super(sheet.message);
    this.sheet = sheet;
  }
}

const MESSAGE_LIMIT = 2048;

const registered = new Map<string, Registered>();

const evaluating = new Map<Element, Evaluation>();

const sources = new Map<string, string>();

let revisions = 0;

let importing: Set<string> | null = null;

export function importStyle(path: unknown): void {
  if (typeof path === "string") importing?.add(path);
}

export function define(path: unknown, factory: unknown): void {
  const script = document.currentScript;
  const evaluation = script === null ? undefined : evaluating.get(script);

  if (
    evaluation === undefined ||
    evaluation.path !== path ||
    evaluation.factory !== null ||
    !makesExports(factory)
  ) {
    return;
  }
  evaluation.factory = factory;
}

export async function registerModules(modules: readonly BoardModule[]): Promise<void> {
  const paths = new Set(modules.map((module) => module.path));

  for (const path of registered.keys()) if (!paths.has(path)) registered.delete(path);

  for (const entry of sources) if (!paths.has(entry[1])) sources.delete(entry[0]);

  await Promise.all(
    modules.flatMap((module) => {
      if (registered.get(module.path)?.code === module.code) return [];

      return [
        (async () => {
          revisions += 1;
          const revision = revisions;
          const outcome = await evaluate(module);

          registered.set(module.path, {
            code: module.code,
            digest: module.digest,
            revision,
            outcome,
          });
        })(),
      ];
    }),
  );
}

export function readRevision(path: string): number | null {
  return registered.get(path)?.revision ?? null;
}

export function readDigests(paths: readonly string[]): ReadonlyMap<string, Digest> {
  return new Map(
    paths.flatMap((path) => {
      const module = registered.get(path);

      return module === undefined ? [] : [[path, module.digest] as const];
    }),
  );
}

export function readSheet(path: string): SheetOutcome {
  const instances = new Map<string, Exports>();
  const imported = new Set<string>();

  const load = (name: string): Exports => {
    const known = instances.get(name);

    if (known !== undefined) return known;
    const module = registered.get(name);

    if (module === undefined) throw new Error(`${name} is not a design file.`);

    if (module.outcome.kind === "failed") throw new SheetFailure(module.outcome.error);
    const exports: Exports = {};
    instances.set(name, exports);
    module.outcome.factory(exports, load);

    return exports;
  };

  importing = imported;

  try {
    const Sheet = load(path)["default"];

    return drawsSheet(Sheet)
      ? { kind: "drawn", Sheet, styles: imported }
      : {
          kind: "failed",
          error: {
            message: `${path} has no default export that draws its frames.`,
            path,
            line: null,
            column: null,
          },
        };
  } catch (error) {
    if (error instanceof SheetFailure) return { kind: "failed", error: error.sheet };

    return { kind: "failed", error: readSheetError(error, locate(error)) };
  } finally {
    importing = null;
  }
}

export function readSheetError(value: unknown, place: Place): SheetError {
  if (typeof value !== "object" || value === null) {
    return { ...place, message: clip(String(value)) };
  }
  const message = "message" in value && typeof value.message === "string" ? value.message : "";

  if (!("path" in value) || typeof value.path !== "string") {
    return {
      ...place,
      message: clip(message === "" ? "A design threw a value that is not an Error." : message),
    };
  }

  return {
    message: clip(message),
    path: value.path,
    line: "line" in value ? readPosition(value.line) : null,
    column: "column" in value ? readPosition(value.column) : null,
  };
}

export function locateEvent(event: ErrorEvent): Place {
  const path = sources.get(event.filename);

  if (path === undefined) return locate(event.error);

  return { path, line: readPosition(event.lineno), column: readPosition(event.colno) };
}

export function catchEvaluation(event: ErrorEvent): boolean {
  const evaluation = [...evaluating.values()].find((found) => found.url === event.filename);

  if (evaluation === undefined) return false;
  evaluation.error = readSheetError(event.error ?? event.message, locateEvent(event));

  return true;
}

export function locate(error: unknown): Place {
  const stack = error instanceof Error ? (error.stack ?? "") : "";

  for (const match of stack.matchAll(/(?<url>blob:[^\s()]+?):(?<line>\d+):(?<column>\d+)/gu)) {
    const path = sources.get(match.groups?.["url"] ?? "");

    if (path !== undefined) {
      return {
        path,
        line: readPosition(Number(match.groups?.["line"])),
        column: readPosition(Number(match.groups?.["column"])),
      };
    }
  }

  return NOWHERE;
}

function evaluate(module: BoardModule): Promise<Outcome> {
  const url = URL.createObjectURL(new Blob([module.code], { type: "text/javascript" }));
  const script = document.createElement("script");
  const evaluation: Evaluation = { path: module.path, url, factory: null, error: null };
  const done = Promise.withResolvers<void>();

  for (const entry of sources) if (entry[1] === module.path) sources.delete(entry[0]);
  sources.set(url, module.path);
  evaluating.set(script, evaluation);
  script.addEventListener("load", () => done.resolve());
  script.addEventListener("error", () => done.resolve());
  script.src = url;
  document.head.append(script);

  return done.promise.then((): Outcome => {
    evaluating.delete(script);
    script.remove();
    URL.revokeObjectURL(url);

    if (evaluation.error !== null) return { kind: "failed", error: evaluation.error };

    if (evaluation.factory !== null) return { kind: "defined", factory: evaluation.factory };

    return {
      kind: "failed",
      error: {
        message: `${module.path} did not load.`,
        path: module.path,
        line: null,
        column: null,
      },
    };
  });
}

function readPosition(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

function clip(message: string): string {
  return message.length > MESSAGE_LIMIT ? `${message.slice(0, MESSAGE_LIMIT - 1)}…` : message;
}

// oxlint-disable-next-line nyte-code/no-one-off-boolean-helpers -- typeof narrows a module's factory only to Function, not to a callable factory
function makesExports(value: unknown): value is Factory {
  return typeof value === "function";
}

// oxlint-disable-next-line nyte-code/no-one-off-boolean-helpers -- typeof narrows a default export only to Function, not to a component
function drawsSheet(value: unknown): value is ComponentType {
  return typeof value === "function";
}
