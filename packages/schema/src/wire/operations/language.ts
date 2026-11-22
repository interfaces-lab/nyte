import { Type } from "typebox";
import {
  CodeActionKindType,
  CodeActionOutcomeType,
  CodeActionResolveTokenType,
  CodeActionType,
  CompletionItemType,
  CompletionListType,
  CompletionResolveTokenType,
  CompletionTriggerType,
  DiagnosticsFrameType,
  DocumentHighlightType,
  DocumentSymbolType,
  FoldingRangeType,
  FormatOptionsType,
  HierarchyCallType,
  HierarchyItemType,
  HierarchyTokenType,
  HoverType,
  InlayHintType,
  LanguageLocationType,
  LanguageFormatOutcomeType,
  LanguageRefreshType,
  LanguageServerViewType,
  RenameOutcomeType,
  RenameTargetType,
  SemanticTokensType,
  SignatureHelpType,
  TextChangeType,
  TextPositionType,
  TextRangeType,
  WorkspaceSymbolType,
} from "../../language.ts";
import { nullable } from "../nullable.ts";
import { NOTHING, ON_WORKSPACE, wireObject, wireSchema, WORKSPACE } from "./fields.ts";
import type { OperationRows } from "./fields.ts";

const LANGUAGE = { authority: "participant", scope: "workspace", capability: "language" } as const;

const DOCUMENT = { ...WORKSPACE, path: Type.String() };

const AT = { ...DOCUMENT, position: TextPositionType };

const ON_DOCUMENT = wireObject(DOCUMENT);

const ON_POSITION = wireObject(AT);

const SERVERS = wireSchema(Type.Array(LanguageServerViewType));

const LOCATIONS = wireSchema(Type.Array(LanguageLocationType));

const ON_HIERARCHY_ITEM = wireObject({ ...WORKSPACE, token: HierarchyTokenType });

const HIERARCHY_ITEMS = wireSchema(Type.Array(HierarchyItemType));

const HIERARCHY_CALLS = wireSchema(Type.Array(HierarchyCallType));

export const LANGUAGE_OPERATIONS = {
  "language.status": {
    ...LANGUAGE,
    summary: "Lists the workspace's language servers and their state.",
    kind: "query",
    input: ON_WORKSPACE,
    output: SERVERS,
  },
  "language.watchStatus": {
    ...LANGUAGE,
    summary: "Streams the workspace's language servers each time one changes state.",
    kind: "watch",
    input: ON_WORKSPACE,
    output: SERVERS,
  },
  "language.open": {
    ...LANGUAGE,
    summary:
      "Opens a document with the client's text and version in every language server that takes it, starting the ones not running.",
    kind: "command",
    input: wireObject({ ...DOCUMENT, text: Type.String(), version: Type.Number() }),
    output: SERVERS,
  },
  "language.change": {
    ...LANGUAGE,
    summary: "Applies the client's edits to an open document and moves it to a newer version.",
    kind: "command",
    input: wireObject({ ...DOCUMENT, version: Type.Number(), changes: Type.Array(TextChangeType) }),
    output: NOTHING,
  },
  "language.close": {
    ...LANGUAGE,
    summary: "Closes a document the client opened; its server reads it from disk again.",
    kind: "command",
    input: ON_DOCUMENT,
    output: NOTHING,
  },
  "language.diagnostics": {
    ...LANGUAGE,
    summary:
      "Streams the diagnostics of each file whose list changed, starting with every file's known list.",
    kind: "watch",
    input: ON_WORKSPACE,
    output: wireSchema(Type.Array(DiagnosticsFrameType)),
  },
  "language.completion": {
    ...LANGUAGE,
    summary: "Lists completions at a position, each with a token to resolve its details.",
    kind: "query",
    input: wireObject({ ...AT, trigger: CompletionTriggerType }),
    output: wireSchema(CompletionListType),
  },
  "language.resolveCompletion": {
    ...LANGUAGE,
    summary: "Fills in a completion's documentation and edits, or answers null for a stale token.",
    kind: "query",
    input: wireObject({ ...WORKSPACE, token: CompletionResolveTokenType }),
    output: wireSchema(nullable(CompletionItemType)),
  },
  "language.hover": {
    ...LANGUAGE,
    summary: "Reads the documentation and type at a position as markdown.",
    kind: "query",
    input: ON_POSITION,
    output: wireSchema(nullable(HoverType)),
  },
  "language.definition": {
    ...LANGUAGE,
    summary: "Finds where the symbol at a position is defined.",
    kind: "query",
    input: ON_POSITION,
    output: LOCATIONS,
  },
  "language.typeDefinition": {
    ...LANGUAGE,
    summary: "Finds where the type of the symbol at a position is defined.",
    kind: "query",
    input: ON_POSITION,
    output: LOCATIONS,
  },
  "language.implementation": {
    ...LANGUAGE,
    summary: "Finds the implementations of the interface or abstract member at a position.",
    kind: "query",
    input: ON_POSITION,
    output: LOCATIONS,
  },
  "language.declaration": {
    ...LANGUAGE,
    summary:
      "Finds where the symbol at a position is declared, where a language tells that from its definition.",
    kind: "query",
    input: ON_POSITION,
    output: LOCATIONS,
  },
  "language.references": {
    ...LANGUAGE,
    summary: "Finds every reference to the symbol at a position.",
    kind: "query",
    input: wireObject({ ...AT, includeDeclaration: Type.Boolean() }),
    output: LOCATIONS,
  },
  "language.documentHighlights": {
    ...LANGUAGE,
    summary: "Lists the ranges in a document that read or write the symbol at a position.",
    kind: "query",
    input: ON_POSITION,
    output: wireSchema(Type.Array(DocumentHighlightType)),
  },
  "language.symbols": {
    ...LANGUAGE,
    summary: "Lists a document's symbols in document order with their depth.",
    kind: "query",
    input: ON_DOCUMENT,
    output: wireSchema(Type.Array(DocumentSymbolType)),
  },
  "language.workspaceSymbols": {
    ...LANGUAGE,
    summary: "Finds symbols by name across the projects of the language servers now running.",
    kind: "query",
    input: wireObject({ ...WORKSPACE, query: Type.String() }),
    output: wireSchema(Type.Array(WorkspaceSymbolType)),
  },
  "language.prepareRename": {
    ...LANGUAGE,
    summary: "Answers the range and name a rename at a position would change, or null.",
    kind: "query",
    input: ON_POSITION,
    output: wireSchema(nullable(RenameTargetType)),
  },
  "language.rename": {
    ...LANGUAGE,
    summary: "Computes the edits that rename the symbol at a position, without applying them.",
    kind: "query",
    input: wireObject({ ...AT, name: Type.String() }),
    output: wireSchema(RenameOutcomeType),
  },
  "language.codeActions": {
    ...LANGUAGE,
    summary: "Lists the quick fixes and refactorings for a range, with the diagnostics on it.",
    kind: "query",
    input: wireObject({
      ...DOCUMENT,
      range: TextRangeType,
      only: Type.Optional(Type.Array(CodeActionKindType)),
    }),
    output: wireSchema(Type.Array(CodeActionType)),
  },
  "language.resolveCodeAction": {
    ...LANGUAGE,
    summary:
      "Resolves a code action to its edit, running its server command if it has one, without applying the edit.",
    kind: "command",
    input: wireObject({ ...WORKSPACE, token: CodeActionResolveTokenType }),
    output: wireSchema(CodeActionOutcomeType),
  },
  "language.format": {
    ...LANGUAGE,
    summary: "Computes the edits that format a document, or why no server formatted it.",
    kind: "query",
    input: wireObject({ ...DOCUMENT, options: FormatOptionsType }),
    output: wireSchema(LanguageFormatOutcomeType),
  },
  "language.signatureHelp": {
    ...LANGUAGE,
    summary: "Reads the signature of the call at a position and its active parameter.",
    kind: "query",
    input: ON_POSITION,
    output: wireSchema(nullable(SignatureHelpType)),
  },
  "language.inlayHints": {
    ...LANGUAGE,
    summary: "Lists the inlay hints, such as parameter names and inferred types, in a range.",
    kind: "query",
    input: wireObject({ ...DOCUMENT, range: TextRangeType }),
    output: wireSchema(Type.Array(InlayHintType)),
  },
  "language.foldingRanges": {
    ...LANGUAGE,
    summary: "Lists the line ranges of a document that fold.",
    kind: "query",
    input: ON_DOCUMENT,
    output: wireSchema(Type.Array(FoldingRangeType)),
  },
  "language.selectionRanges": {
    ...LANGUAGE,
    summary:
      "Lists, for each position, the ranges a growing selection steps through, innermost first.",
    kind: "query",
    input: wireObject({ ...DOCUMENT, positions: Type.Array(TextPositionType) }),
    output: wireSchema(Type.Array(Type.Array(TextRangeType))),
  },
  "language.semanticTokens": {
    ...LANGUAGE,
    summary:
      "Reads a document's semantic tokens, or those in a range, with the legend that names them.",
    kind: "query",
    input: wireObject({ ...DOCUMENT, range: Type.Optional(TextRangeType) }),
    output: wireSchema(nullable(SemanticTokensType)),
  },
  "language.callHierarchy": {
    ...LANGUAGE,
    summary: "Finds the function at a position as the root of a call hierarchy.",
    kind: "query",
    input: ON_POSITION,
    output: HIERARCHY_ITEMS,
  },
  "language.incomingCalls": {
    ...LANGUAGE,
    summary: "Lists the callers of a call hierarchy item, each with its call sites.",
    kind: "query",
    input: ON_HIERARCHY_ITEM,
    output: HIERARCHY_CALLS,
  },
  "language.outgoingCalls": {
    ...LANGUAGE,
    summary: "Lists what a call hierarchy item calls, each with its call sites.",
    kind: "query",
    input: ON_HIERARCHY_ITEM,
    output: HIERARCHY_CALLS,
  },
  "language.typeHierarchy": {
    ...LANGUAGE,
    summary: "Finds the type at a position as the root of a type hierarchy.",
    kind: "query",
    input: ON_POSITION,
    output: HIERARCHY_ITEMS,
  },
  "language.supertypes": {
    ...LANGUAGE,
    summary: "Lists the types a type hierarchy item extends or implements.",
    kind: "query",
    input: ON_HIERARCHY_ITEM,
    output: HIERARCHY_ITEMS,
  },
  "language.subtypes": {
    ...LANGUAGE,
    summary: "Lists the types that extend or implement a type hierarchy item.",
    kind: "query",
    input: ON_HIERARCHY_ITEM,
    output: HIERARCHY_ITEMS,
  },
  "language.refreshes": {
    ...LANGUAGE,
    summary:
      "Streams what a language server asked clients to compute again, such as semantic tokens after a project loads.",
    kind: "watch",
    input: ON_WORKSPACE,
    output: wireSchema(Type.Array(LanguageRefreshType)),
  },
} as const satisfies OperationRows;
