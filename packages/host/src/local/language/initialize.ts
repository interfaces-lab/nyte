import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { compile, isJsonObject } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { Type } from "typebox";

export interface Capabilities {
  readonly incremental: boolean;
  readonly save: "none" | "uri" | "text";
  readonly resolvesCompletion: boolean;
  readonly resolvesCodeAction: boolean;
  readonly formats: boolean;
}

export const NO_CAPABILITIES: Capabilities = {
  incremental: false,
  save: "none",
  resolvesCompletion: false,
  resolvesCodeAction: false,
  formats: false,
};

const CAPABILITIES = {
  general: { positionEncodings: ["utf-16"] },
  window: { workDoneProgress: true, showMessage: {} },
  workspace: {
    applyEdit: true,
    workspaceEdit: { documentChanges: true, resourceOperations: [], failureHandling: "abort" },
    configuration: true,
    workspaceFolders: true,
    didChangeConfiguration: { dynamicRegistration: false },
    didChangeWatchedFiles: { dynamicRegistration: false },
    executeCommand: {},
  },
  textDocument: {
    synchronization: { didSave: true, willSave: false, willSaveWaitUntil: false },
    completion: {
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
    hover: { contentFormat: ["markdown", "plaintext"] },
    signatureHelp: {
      signatureInformation: {
        documentationFormat: ["markdown", "plaintext"],
        parameterInformation: { labelOffsetSupport: true },
        activeParameterSupport: true,
      },
    },
    definition: { linkSupport: true },
    typeDefinition: { linkSupport: true },
    references: {},
    documentSymbol: {
      hierarchicalDocumentSymbolSupport: true,
      symbolKind: { valueSet: Array.from({ length: 26 }, (_, index) => index + 1) },
    },
    codeAction: {
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
    formatting: {},
    rename: { prepareSupport: true },
    publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
    inlayHint: {},
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
      completionProvider: Type.Optional(
        Type.Object({ resolveProvider: Type.Optional(Type.Boolean()) }),
      ),
      codeActionProvider: Type.Optional(
        Type.Union([
          Type.Boolean(),
          Type.Object({ resolveProvider: Type.Optional(Type.Boolean()) }),
        ]),
      ),
      documentFormattingProvider: Type.Optional(Type.Union([Type.Boolean(), Type.Object({})])),
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

/** The capabilities this client uses and the server's version, or null for an answer that is not an `InitializeResult`. */
export function readInitialize(
  answer: unknown,
): { readonly capabilities: Capabilities; readonly version: string | null } | null {
  if (!InitializeAnswer.Check(answer)) return null;
  const sync = answer.capabilities.textDocumentSync;
  const save = typeof sync === "object" ? sync.save : undefined;
  const actions = answer.capabilities.codeActionProvider;
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
      resolvesCompletion: answer.capabilities.completionProvider?.resolveProvider === true,
      resolvesCodeAction: typeof actions === "object" && actions.resolveProvider === true,
      formats: (answer.capabilities.documentFormattingProvider ?? false) !== false,
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
