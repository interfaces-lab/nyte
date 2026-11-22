import type {
  LanguageApi,
  LanguageLocation,
  LanguageServerView,
  TextPosition,
  TextRange,
} from "@nyte-ai/sdk";
import { findLanguage } from "@nyte-ai/schema";
import { workspaceFile } from "../paths.ts";

/** A place a navigation can land: an absolute path and the range of the name there. */
export interface Landing {
  readonly path: string;
  readonly range: TextRange;
}

/** `declaration` is Go to Declaration or Usages, `type` Go to Type Declaration, and `definition` the declaration alone, as Quick Definition shows it. */
export type DeclarationQuery = "declaration" | "type" | "definition";

export type DeclarationOutcome =
  | { readonly kind: "go"; readonly landing: Landing }
  | { readonly kind: "choose"; readonly title: string; readonly landings: readonly Landing[] }
  | { readonly kind: "none"; readonly message: string; readonly detail?: string };

/** GoLand's words, from the IntelliJ platform's `CodeInsightBundle`. */
export const NOWHERE = "Cannot find declaration to go to";

/** The identifier around a column of a line, as a range on that line, or undefined off one. */
export function identifierAt(
  line: string,
  at: TextPosition,
): { readonly name: string; readonly range: TextRange } | undefined {
  const word = /[\p{L}\p{N}_$]/u;
  let start = at.utf16Column;
  let end = at.utf16Column;

  while (start > 0 && word.test(line.charAt(start - 1))) start -= 1;

  while (end < line.length && word.test(line.charAt(end))) end += 1;

  if (start === end || /\p{N}/u.test(line.charAt(start))) return undefined;

  return {
    name: line.slice(start, end),
    range: {
      start: { line: at.line, utf16Column: start },
      end: { line: at.line, utf16Column: end },
    },
  };
}

/**
 * Go to Declaration as GoLand does it: a reference goes to its declaration, one target directly and
 * several through a chooser; a declaration goes to its usages instead; nothing found says why.
 */
export async function findDeclaration(
  api: LanguageApi,
  input: {
    readonly root: string;
    readonly path: string;
    readonly position: TextPosition;
    readonly name: string;
    readonly query: DeclarationQuery;
  },
): Promise<DeclarationOutcome> {
  const at = { path: input.path, position: input.position };

  const found = unique(
    (input.query === "type" ? await api.typeDefinition(at) : await api.definition(at)).map(
      (location) => landing(input.root, location),
    ),
  );

  if (found.length === 0) return nothing(api, input.path, input.root);

  if (input.query === "declaration" && found.some((place) => covers(place, input))) {
    const usages = unique(
      (await api.references({ ...at, includeDeclaration: false })).map((location) =>
        landing(input.root, location),
      ),
    );

    return choose(usages, `Usages of ${input.name}`, `No usages of ${input.name} found`);
  }

  return choose(found, input.query === "type" ? "Choose Type" : "Choose Declaration", NOWHERE);
}

/** Whether the language server for a file has an answer at a position, for the modifier-hover link. */
export async function navigable(
  api: LanguageApi,
  path: string,
  position: TextPosition,
): Promise<boolean> {
  return (await api.definition({ path, position })).length > 0;
}

function choose(landings: readonly Landing[], title: string, none: string): DeclarationOutcome {
  const only = landings[0];

  if (only === undefined) return { kind: "none", message: none };

  return landings.length === 1
    ? { kind: "go", landing: only }
    : { kind: "choose", title, landings };
}

export function servesFile(view: LanguageServerView, path: string, root: string): boolean {
  const name = findLanguage(path)?.name;
  const relative = workspaceFile(path, [root])?.relative;

  return (
    view.languages.some((language) => language === name) &&
    relative !== undefined &&
    (view.root === "" || relative.startsWith(`${view.root}/`))
  );
}

async function nothing(api: LanguageApi, path: string, root: string): Promise<DeclarationOutcome> {
  const servers = (await api.status()).filter((view) => servesFile(view, path, root));

  const answering = servers.some((view) => view.state.kind === "ready");

  return { kind: "none", ...explain(answering ? undefined : servers[0]) };
}

function explain(server: LanguageServerView | undefined) {
  switch (server?.state.kind) {
    case "missing":
      return { message: `${server.server} isn't installed.`, detail: server.state.hint };
    case "failed":
      return { message: `${server.server} stopped.`, detail: server.state.reason };
    case "untrusted":
      return {
        message: `${server.server} doesn't run in untrusted folders.`,
        detail: "Trust the folder to turn it on.",
      };
    case "installing":
      return {
        message: `${server.server} is downloading.`,
        detail: "Try again when it has started.",
      };
    case "starting":
      return {
        message: `${server.server} is starting.`,
        detail: "Try again when it has loaded the project.",
      };
    case "busy":
      return {
        message: `${server.server} is still loading.`,
        detail:
          server.state.percent === null
            ? server.state.title
            : `${server.state.title} ${String(Math.round(server.state.percent))}%`,
      };
    default:
      return { message: NOWHERE };
  }
}

function landing(root: string, location: LanguageLocation): Landing {
  return { path: absolutePath(root, location.path), range: location.range };
}

export function absolutePath(root: string, path: string): string {
  return /^(?:[A-Za-z]:)?[\\/]/u.test(path) ? path : `${root}/${path}`;
}

function covers(
  place: Landing,
  input: { readonly path: string; readonly position: TextPosition },
): boolean {
  const start = place.range.start;
  const end = place.range.end;
  const at = input.position;

  return (
    place.path === input.path &&
    start.line <= at.line &&
    at.line <= end.line &&
    (at.line > start.line || at.utf16Column >= start.utf16Column) &&
    (at.line < end.line || at.utf16Column <= end.utf16Column)
  );
}

function unique(landings: readonly Landing[]): readonly Landing[] {
  return landings.filter(
    (place, index) =>
      landings.findIndex(
        (other) =>
          other.path === place.path &&
          other.range.start.line === place.range.start.line &&
          other.range.start.utf16Column === place.range.start.utf16Column,
      ) === index,
  );
}
