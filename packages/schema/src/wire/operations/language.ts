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
  DocumentSymbolType,
  FormatOptionsType,
  HoverType,
  LanguageLocationType,
  LanguageFormatOutcomeType,
  LanguageServerViewType,
  RenameOutcomeType,
  RenameTargetType,
  TextChangeType,
  TextPositionType,
  TextRangeType,
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
  "language.references": {
    ...LANGUAGE,
    summary: "Finds every reference to the symbol at a position.",
    kind: "query",
    input: wireObject({ ...AT, includeDeclaration: Type.Boolean() }),
    output: LOCATIONS,
  },
  "language.symbols": {
    ...LANGUAGE,
    summary: "Lists a document's symbols in document order with their depth.",
    kind: "query",
    input: ON_DOCUMENT,
    output: wireSchema(Type.Array(DocumentSymbolType)),
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
    summary:
      "Computes the edits that format a document, or a range of it, or why no server formatted it.",
    kind: "query",
    input: wireObject({
      ...DOCUMENT,
      options: FormatOptionsType,
      range: Type.Optional(TextRangeType),
    }),
    output: wireSchema(LanguageFormatOutcomeType),
  },
} as const satisfies OperationRows;
