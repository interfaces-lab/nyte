import { isAbsolute, matchesGlob, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, isJson, isJsonObject, LanguageFeatureType } from "@nyte-ai/schema";
import type { Json, JsonSchema, LanguageFeature } from "@nyte-ai/schema";
import { Type } from "typebox";

/** Keys follow `serverCapability` and `registrationMethod` in the LSP meta model: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/metaModel/metaModel.json */
export const PROVIDERS = {
  completion: { capability: "completionProvider", method: "textDocument/completion" },
  hover: { capability: "hoverProvider", method: "textDocument/hover" },
  signatureHelp: { capability: "signatureHelpProvider", method: "textDocument/signatureHelp" },
  definition: { capability: "definitionProvider", method: "textDocument/definition" },
  typeDefinition: { capability: "typeDefinitionProvider", method: "textDocument/typeDefinition" },
  implementation: { capability: "implementationProvider", method: "textDocument/implementation" },
  declaration: { capability: "declarationProvider", method: "textDocument/declaration" },
  references: { capability: "referencesProvider", method: "textDocument/references" },
  documentHighlights: {
    capability: "documentHighlightProvider",
    method: "textDocument/documentHighlight",
  },
  symbols: { capability: "documentSymbolProvider", method: "textDocument/documentSymbol" },
  workspaceSymbols: { capability: "workspaceSymbolProvider", method: "workspace/symbol" },
  codeActions: { capability: "codeActionProvider", method: "textDocument/codeAction" },
  format: { capability: "documentFormattingProvider", method: "textDocument/formatting" },
  rename: { capability: "renameProvider", method: "textDocument/rename" },
  foldingRanges: { capability: "foldingRangeProvider", method: "textDocument/foldingRange" },
  selectionRanges: { capability: "selectionRangeProvider", method: "textDocument/selectionRange" },
  semanticTokens: { capability: "semanticTokensProvider", method: "textDocument/semanticTokens" },
  inlayHints: { capability: "inlayHintProvider", method: "textDocument/inlayHint" },
  callHierarchy: {
    capability: "callHierarchyProvider",
    method: "textDocument/prepareCallHierarchy",
  },
  typeHierarchy: {
    capability: "typeHierarchyProvider",
    method: "textDocument/prepareTypeHierarchy",
  },
  diagnostics: { capability: "diagnosticProvider", method: "textDocument/diagnostic" },
} as const satisfies Record<
  LanguageFeature | "diagnostics",
  { readonly capability: string; readonly method: string }
>;

const WATCHED_FILES = "workspace/didChangeWatchedFiles";

export interface ServerCapabilities {
  readonly incremental: boolean;
  readonly save: "none" | "uri" | "text";
  readonly declared: JsonSchema;
}

export const NO_CAPABILITIES: ServerCapabilities = {
  incremental: false,
  save: "none",
  declared: {},
};

export interface Registration {
  readonly method: string;
  readonly options: JsonSchema;
}

export interface Provides {
  readonly capabilities: ServerCapabilities;
  readonly registrations: ReadonlyMap<string, Registration>;
}

const Registrations = compile(
  Type.Object({
    registrations: Type.Array(
      Type.Object({
        id: Type.String(),
        method: Type.String(),
        registerOptions: Type.Optional(Type.Unknown()),
      }),
    ),
  }),
);

const Unregistrations = compile(
  Type.Object({ unregisterations: Type.Array(Type.Object({ id: Type.String() })) }),
);

const Watchers = compile(
  Type.Object({
    watchers: Type.Array(
      Type.Object({
        globPattern: Type.Union([
          Type.String(),
          Type.Object({
            baseUri: Type.Union([Type.String(), Type.Object({ uri: Type.String() })]),
            pattern: Type.String(),
          }),
        ]),
      }),
    ),
  }),
);

const Selector = compile(
  Type.Array(
    Type.Union([
      Type.String(),
      Type.Object({
        language: Type.Optional(Type.String()),
        scheme: Type.Optional(Type.String()),
        pattern: Type.Optional(Type.String()),
      }),
    ]),
  ),
);

export function findProvider(
  run: Provides,
  feature: keyof typeof PROVIDERS,
  document: { readonly path: string; readonly languageId: string } | null,
): JsonSchema | null {
  const provider = PROVIDERS[feature];
  const declared = run.capabilities.declared[provider.capability];

  const offered: readonly Json[] = [
    declared === true ? {} : (declared ?? null),
    ...[...run.registrations.values()].flatMap((registration) =>
      registration.method === provider.method ? [registration.options] : [],
    ),
  ];

  return (
    offered.filter(isJsonObject).find((options) => selects(options.documentSelector, document)) ??
    null
  );
}

export function listFeatures(run: Provides): readonly LanguageFeature[] {
  return LanguageFeatureType.enum.filter((feature) => findProvider(run, feature, null) !== null);
}

export function register(registrations: Map<string, Registration>, params: unknown): void {
  if (!Registrations.Check(params)) return;

  for (const entry of params.registrations) {
    registrations.set(entry.id, {
      method: entry.method,
      options:
        isJson(entry.registerOptions) && isJsonObject(entry.registerOptions)
          ? entry.registerOptions
          : {},
    });
  }
}

export function unregister(registrations: Map<string, Registration>, params: unknown): void {
  if (!Unregistrations.Check(params)) return;

  for (const entry of params.unregisterations) registrations.delete(entry.id);
}

export function watches(run: Provides, path: string, root: string): boolean {
  return [...run.registrations.values()].some(
    (registration) =>
      registration.method === WATCHED_FILES &&
      Watchers.Check(registration.options) &&
      registration.options.watchers.some((watcher) => {
        const glob = watcher.globPattern;

        if (typeof glob === "string") return matches(path, root, glob);
        const base = typeof glob.baseUri === "string" ? glob.baseUri : glob.baseUri.uri;
        const inside = base.startsWith("file:") ? relative(fileURLToPath(base), path) : "..";

        return !inside.startsWith("..") && !isAbsolute(inside) && matchesGlob(inside, glob.pattern);
      }),
  );
}

function selects(
  selector: Json | undefined,
  document: { readonly path: string; readonly languageId: string } | null,
): boolean {
  if (document === null || !Selector.Check(selector)) return true;

  return selector.some((filter) =>
    typeof filter === "string"
      ? filter === document.languageId
      : (filter.language === undefined || filter.language === document.languageId) &&
        (filter.scheme === undefined || filter.scheme === "file") &&
        (filter.pattern === undefined || matches(document.path, "/", filter.pattern)),
  );
}

function matches(path: string, base: string, glob: string): boolean {
  return matchesGlob(path, glob) || matchesGlob(relative(base, path), glob);
}
