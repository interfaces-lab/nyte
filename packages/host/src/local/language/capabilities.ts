import { isAbsolute, relative, sep } from "node:path";
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
  formatRange: {
    capability: "documentRangeFormattingProvider",
    method: "textDocument/rangeFormatting",
  },
  rename: { capability: "renameProvider", method: "textDocument/rename" },
  renameFiles: {
    capability: "workspace.fileOperations.willRename",
    method: "workspace/willRenameFiles",
  },
  documentLinks: { capability: "documentLinkProvider", method: "textDocument/documentLink" },
  documentColors: { capability: "colorProvider", method: "textDocument/documentColor" },
  linkedEditingRanges: {
    capability: "linkedEditingRangeProvider",
    method: "textDocument/linkedEditingRange",
  },
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
  filesCreated: {
    capability: "workspace.fileOperations.didCreate",
    method: "workspace/didCreateFiles",
  },
  filesDeleted: {
    capability: "workspace.fileOperations.didDelete",
    method: "workspace/didDeleteFiles",
  },
} as const satisfies Record<
  LanguageFeature | "diagnostics" | "filesCreated" | "filesDeleted",
  { readonly capability: string; readonly method: string }
>;

const WATCHED_FILES = "workspace/didChangeWatchedFiles";

const GLOB_TOKEN = /\*\*\/|\*\*|\*|\?|\{|\}|,|\[!?[^\]]+\]|[^*?{},[]+|\[/gu;

const NO_MATCH = /^(?!)/u;

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

  const declared = provider.capability
    .split(".")
    .reduce<Json | undefined>(
      (found, key) => (isJsonObject(found) ? found[key] : undefined),
      run.capabilities.declared,
    );

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

        return (
          !inside.startsWith("..") &&
          !isAbsolute(inside) &&
          compileGlob(glob.pattern).test(slashed(inside))
        );
      }),
  );
}

const FileFilters = compile(
  Type.Object({
    filters: Type.Array(
      Type.Object({
        scheme: Type.Optional(Type.String()),
        pattern: Type.Object({ glob: Type.String() }),
      }),
    ),
  }),
);

export function operatesOn(provider: JsonSchema, path: string): boolean {
  return (
    !FileFilters.Check(provider) ||
    provider.filters.some(
      (filter) =>
        (filter.scheme === undefined || filter.scheme === "file") &&
        matches(path, "/", filter.pattern.glob),
    )
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
  const pattern = compileGlob(glob);

  return pattern.test(slashed(path)) || pattern.test(slashed(relative(base, path)));
}

function slashed(path: string): string {
  return path.split(sep).join("/");
}

function compileGlob(glob: string): RegExp {
  let depth = 0;

  const source = glob.replaceAll(GLOB_TOKEN, (token) => {
    if (token === "**/") return "(?:.*/)?";

    if (token === "**") return ".*";

    if (token === "*") return "[^/]*";

    if (token === "?") return "[^/]";

    if (token === "{") {
      depth += 1;

      return "(?:";
    }

    if (token === "}" && depth > 0) {
      depth -= 1;

      return ")";
    }

    if (token === "," && depth > 0) return "|";

    if (token.length > 1 && token.startsWith("[")) {
      return token.startsWith("[!") ? `[^${token.slice(2)}` : token;
    }

    return RegExp.escape(token);
  });

  try {
    return new RegExp(`^${source}${")".repeat(depth)}$`, "u");
  } catch {
    return NO_MATCH;
  }
}
