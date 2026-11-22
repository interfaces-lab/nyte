import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { compile, isJson, isJsonObject } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { ServerCapabilities } from "./capabilities.ts";

const SYMBOL_KINDS = { valueSet: Array.from({ length: 26 }, (_, index) => index + 1) };

const DYNAMIC = { dynamicRegistration: true } as const;

const CAPABILITIES = {
  general: { positionEncodings: ["utf-16"] },
  window: { workDoneProgress: true, showMessage: {} },
  workspace: {
    applyEdit: true,
    workspaceEdit: { documentChanges: true, resourceOperations: [], failureHandling: "abort" },
    configuration: true,
    workspaceFolders: true,
    didChangeConfiguration: DYNAMIC,
    didChangeWatchedFiles: { ...DYNAMIC, relativePatternSupport: true },
    executeCommand: DYNAMIC,
    symbol: { ...DYNAMIC, symbolKind: SYMBOL_KINDS },
    semanticTokens: { refreshSupport: true },
    inlayHint: { refreshSupport: true },
    diagnostics: { refreshSupport: true },
  },
  textDocument: {
    synchronization: { didSave: true, willSave: false, willSaveWaitUntil: false },
    completion: {
      ...DYNAMIC,
      completionItem: {
        snippetSupport: true,
        labelDetailsSupport: true,
        documentationFormat: ["markdown", "plaintext"],
        deprecatedSupport: true,
        preselectSupport: true,
        tagSupport: { valueSet: [1] },
        resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] },
      },
      completionItemKind: { valueSet: Array.from({ length: 25 }, (_, index) => index + 1) },
      completionList: { itemDefaults: ["editRange", "insertTextFormat", "commitCharacters"] },
      contextSupport: true,
    },
    hover: { ...DYNAMIC, contentFormat: ["markdown", "plaintext"] },
    signatureHelp: {
      ...DYNAMIC,
      signatureInformation: {
        documentationFormat: ["markdown", "plaintext"],
        parameterInformation: { labelOffsetSupport: true },
        activeParameterSupport: true,
      },
    },
    definition: { ...DYNAMIC, linkSupport: true },
    typeDefinition: { ...DYNAMIC, linkSupport: true },
    implementation: { ...DYNAMIC, linkSupport: true },
    declaration: { ...DYNAMIC, linkSupport: true },
    references: DYNAMIC,
    documentHighlight: DYNAMIC,
    documentSymbol: {
      ...DYNAMIC,
      hierarchicalDocumentSymbolSupport: true,
      symbolKind: SYMBOL_KINDS,
    },
    codeAction: {
      ...DYNAMIC,
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: [
            "quickfix",
            "refactor",
            "refactor.extract",
            "refactor.inline",
            "refactor.rewrite",
            "source",
            "source.organizeImports",
            "source.fixAll",
          ],
        },
      },
      isPreferredSupport: true,
      disabledSupport: true,
      dataSupport: true,
      resolveSupport: { properties: ["edit"] },
    },
    formatting: DYNAMIC,
    rename: { ...DYNAMIC, prepareSupport: true },
    publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
    diagnostic: { ...DYNAMIC, relatedDocumentSupport: true },
    inlayHint: DYNAMIC,
    foldingRange: { ...DYNAMIC, lineFoldingOnly: true },
    selectionRange: DYNAMIC,
    callHierarchy: DYNAMIC,
    typeHierarchy: DYNAMIC,
    semanticTokens: {
      ...DYNAMIC,
      requests: { full: true, range: true },
      tokenTypes: [
        "namespace",
        "type",
        "class",
        "enum",
        "interface",
        "struct",
        "typeParameter",
        "parameter",
        "variable",
        "property",
        "enumMember",
        "event",
        "function",
        "method",
        "macro",
        "keyword",
        "modifier",
        "comment",
        "string",
        "number",
        "regexp",
        "operator",
        "decorator",
      ],
      tokenModifiers: [
        "declaration",
        "definition",
        "readonly",
        "static",
        "deprecated",
        "abstract",
        "async",
        "modification",
        "documentation",
        "defaultLibrary",
      ],
      formats: ["relative"],
      overlappingTokenSupport: false,
      multilineTokenSupport: false,
      augmentsSyntaxTokens: true,
    },
  },
} as const;

const InitializeAnswer = compile(
  Type.Object({
    capabilities: Type.Object({
      textDocumentSync: Type.Optional(
        Type.Union([
          Type.Number(),
          Type.Object({
            change: Type.Optional(Type.Number()),
            save: Type.Optional(
              Type.Union([
                Type.Boolean(),
                Type.Object({ includeText: Type.Optional(Type.Boolean()) }),
              ]),
            ),
          }),
        ]),
      ),
    }),
    serverInfo: Type.Optional(
      Type.Object({ name: Type.String(), version: Type.Optional(Type.String()) }),
    ),
  }),
);

const ConfigurationRequest = compile(
  Type.Object({ items: Type.Array(Type.Object({ section: Type.Optional(Type.String()) })) }),
);

export function initializeParams(root: string, options: Json): Json {
  const folder = { uri: pathToFileURL(root).href, name: basename(root) };

  return {
    processId: process.pid,
    clientInfo: { name: "Nyte" },
    rootUri: folder.uri,
    rootPath: root,
    workspaceFolders: [folder],
    initializationOptions: options,
    capabilities: CAPABILITIES,
  };
}

export function readInitialize(
  answer: unknown,
): { readonly capabilities: ServerCapabilities; readonly version: string | null } | null {
  if (!InitializeAnswer.Check(answer)) return null;
  const declared = answer.capabilities;
  const sync = declared.textDocumentSync;
  const save = typeof sync === "object" ? sync.save : undefined;
  const version = answer.serverInfo?.version;

  return {
    capabilities: {
      incremental: (typeof sync === "number" ? sync : sync?.change) === 2,
      save:
        typeof save === "object" && save.includeText === true
          ? "text"
          : save === undefined || save === false
            ? "none"
            : "uri",
      declared: isJson(declared) && isJsonObject(declared) ? declared : {},
    },
    version: version === undefined ? null : (readGoVersion(version) ?? version),
  };
}

/** Answers `workspace/configuration`: each item's dotted section of the server's settings, or all of them. */
export function answerConfiguration(settings: Json, params: unknown): Json {
  if (!ConfigurationRequest.Check(params)) return [];

  return params.items.map((item) =>
    (item.section ?? "")
      .split(".")
      .filter((key) => key !== "")
      .reduce<Json>((found, key) => (isJsonObject(found) ? (found[key] ?? null) : null), settings),
  );
}

function readGoVersion(text: string): string | null {
  try {
    const value: unknown = JSON.parse(text);

    return typeof value === "object" &&
      value !== null &&
      "Version" in value &&
      typeof value.Version === "string"
      ? value.Version
      : null;
  } catch {
    return null;
  }
}
