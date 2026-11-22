import { Type } from "typebox";
import { idSchema } from "./ids.ts";
import type { Id } from "./ids.ts";
import type { Decoded } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

export type LanguageServerId = Id<"language-server">;

/** A zero-based line and a column counted in UTF-16 code units, as JavaScript strings and LSP count them. */
export const TextPositionType = Type.Object({ line: Type.Number(), utf16Column: Type.Number() });

export type TextPosition = Decoded<typeof TextPositionType>;

export const TextRangeType = Type.Object({ start: TextPositionType, end: TextPositionType });

export type TextRange = Decoded<typeof TextRangeType>;

/** A change to an open document: `range` null replaces the whole text. */
export const TextChangeType = Type.Object({ range: nullable(TextRangeType), text: Type.String() });

export type TextChange = Decoded<typeof TextChangeType>;

/** The text after one change; a position past its line's end or the text's end is clamped there. */
export function applyTextChange(text: string, change: TextChange): string {
  if (change.range === null) return change.text;

  return (
    text.slice(0, textOffset(text, change.range.start)) +
    change.text +
    text.slice(textOffset(text, change.range.end))
  );
}

/** The string index of a position, its column clamped to its line and its line to the text. */
export function textOffset(text: string, position: TextPosition): number {
  let start = 0;

  for (let line = 0; line < position.line; line += 1) {
    const next = text.indexOf("\n", start);

    if (next < 0) return text.length;
    start = next + 1;
  }

  const end = text.indexOf("\n", start);

  return Math.min(start + position.utf16Column, end < 0 ? text.length : end);
}

export const TextEditType = Type.Object({ range: TextRangeType, text: Type.String() });

export type TextEdit = Decoded<typeof TextEditType>;

/** Edits per file, each file's edits against the text the server saw; paths are workspace-relative inside the workspace and absolute outside it. */
export const WorkspaceEditType = Type.Object({
  files: Type.Array(Type.Object({ path: Type.String(), edits: Type.Array(TextEditType) })),
});

export type WorkspaceEdit = Decoded<typeof WorkspaceEditType>;

export const LanguageLocationType = Type.Object({ path: Type.String(), range: TextRangeType });

export type LanguageLocation = Decoded<typeof LanguageLocationType>;

export const LanguageNameType = Type.Enum([
  "bash",
  "c",
  "csharp",
  "css",
  "elixir",
  "go",
  "html",
  "java",
  "json",
  "kotlin",
  "lua",
  "markdown",
  "php",
  "python",
  "ruby",
  "rust",
  "sql",
  "swift",
  "toml",
  "typescript",
  "yaml",
  "zig",
]);

export type LanguageName = Decoded<typeof LanguageNameType>;

export const LANGUAGES: Readonly<
  Record<LanguageName, { readonly label: string; readonly ids: Readonly<Record<string, string>> }>
> = {
  bash: { label: "Shell", ids: { ".sh": "shellscript", ".bash": "shellscript" } },
  c: {
    label: "C and C++",
    ids: {
      ".c": "c",
      ".h": "c",
      ".cc": "cpp",
      ".cpp": "cpp",
      ".cxx": "cpp",
      ".hh": "cpp",
      ".hpp": "cpp",
      ".hxx": "cpp",
      ".m": "objective-c",
      ".mm": "objective-cpp",
    },
  },
  csharp: { label: "C#", ids: { ".cs": "csharp" } },
  css: { label: "CSS", ids: { ".css": "css", ".scss": "scss", ".less": "less" } },
  elixir: { label: "Elixir", ids: { ".ex": "elixir", ".exs": "elixir" } },
  go: { label: "Go", ids: { ".go": "go" } },
  html: { label: "HTML", ids: { ".html": "html", ".htm": "html" } },
  java: { label: "Java", ids: { ".java": "java" } },
  json: { label: "JSON", ids: { ".json": "json", ".jsonc": "jsonc" } },
  kotlin: { label: "Kotlin", ids: { ".kt": "kotlin", ".kts": "kotlin" } },
  lua: { label: "Lua", ids: { ".lua": "lua" } },
  markdown: { label: "Markdown", ids: { ".md": "markdown", ".markdown": "markdown" } },
  php: { label: "PHP", ids: { ".php": "php" } },
  python: { label: "Python", ids: { ".py": "python", ".pyi": "python" } },
  ruby: { label: "Ruby", ids: { ".rb": "ruby", ".rake": "ruby", ".gemspec": "ruby" } },
  rust: { label: "Rust", ids: { ".rs": "rust" } },
  sql: { label: "SQL", ids: { ".sql": "sql" } },
  swift: { label: "Swift", ids: { ".swift": "swift" } },
  toml: { label: "TOML", ids: { ".toml": "toml" } },
  typescript: {
    label: "TypeScript and JavaScript",
    ids: {
      ".ts": "typescript",
      ".mts": "typescript",
      ".cts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".jsx": "javascriptreact",
    },
  },
  yaml: { label: "YAML", ids: { ".yaml": "yaml", ".yml": "yaml" } },
  zig: { label: "Zig", ids: { ".zig": "zig", ".zon": "zig" } },
};

const LANGUAGE_BY_EXTENSION = new Map(
  LanguageNameType.enum.flatMap((name) =>
    Object.entries(LANGUAGES[name].ids).map((entry) => [entry[0], { name, id: entry[1] }] as const),
  ),
);

export function findLanguage(
  path: string,
): { readonly name: LanguageName; readonly id: string } | null {
  const dot = path.lastIndexOf(".");

  if (dot < 0 || path.includes("/", dot)) return null;

  return LANGUAGE_BY_EXTENSION.get(path.slice(dot).toLowerCase()) ?? null;
}

export const LanguageFeatureType = Type.Enum([
  "completion",
  "hover",
  "signatureHelp",
  "definition",
  "typeDefinition",
  "implementation",
  "declaration",
  "references",
  "documentHighlights",
  "symbols",
  "workspaceSymbols",
  "codeActions",
  "format",
  "rename",
  "foldingRanges",
  "selectionRanges",
  "semanticTokens",
  "inlayHints",
  "callHierarchy",
  "typeHierarchy",
]);

export type LanguageFeature = Decoded<typeof LanguageFeatureType>;

export const LanguageServerStateType = Type.Union([
  Type.Object({ kind: Type.Literal("starting") }),
  Type.Object({ kind: Type.Literal("ready") }),
  Type.Object({
    kind: Type.Literal("busy"),
    title: Type.String(),
    percent: nullable(Type.Number()),
  }),
  Type.Object({ kind: Type.Literal("missing"), hint: Type.String() }),
  Type.Object({ kind: Type.Literal("installing"), percent: nullable(Type.Number()) }),
  Type.Object({ kind: Type.Literal("untrusted") }),
  Type.Object({ kind: Type.Literal("failed"), reason: Type.String() }),
  Type.Object({ kind: Type.Literal("idle") }),
]);

export type LanguageServerState = Decoded<typeof LanguageServerStateType>;

/** One language server for one project root: `installing` while its pinned version downloads; `idle` after it shut down for want of use, until the next request starts it again; `untrusted` while the user has not trusted the folder, since a server runs project code. `features` lists what it answers, and is empty until it is ready. */
export const LanguageServerViewType = Type.Object({
  languages: Type.Array(LanguageNameType),
  server: Type.String(),
  root: Type.String(),
  state: LanguageServerStateType,
  version: nullable(Type.String()),
  executable: nullable(Type.String()),
  features: Type.Array(LanguageFeatureType),
});

export type LanguageServerView = Decoded<typeof LanguageServerViewType>;

export const DiagnosticSeverityType = Type.Enum(["error", "warning", "information", "hint"]);

export type DiagnosticSeverity = Decoded<typeof DiagnosticSeverityType>;

export const LanguageDiagnosticType = Type.Object({
  range: TextRangeType,
  severity: DiagnosticSeverityType,
  message: Type.String(),
  source: nullable(Type.String()),
  code: nullable(Type.String()),
  tags: Type.Array(Type.Enum(["unnecessary", "deprecated"])),
  related: Type.Array(Type.Object({ location: LanguageLocationType, message: Type.String() })),
});

export type LanguageDiagnostic = Decoded<typeof LanguageDiagnosticType>;

/** A file's whole diagnostic list, each server's last report after the other's; `version` is the document version it describes, null for a file no client opened. */
export const DiagnosticsFrameType = Type.Object({
  path: Type.String(),
  version: nullable(Type.Number()),
  diagnostics: Type.Array(LanguageDiagnosticType),
});

export type DiagnosticsFrame = Decoded<typeof DiagnosticsFrameType>;

export const CompletionTriggerType = Type.Union([
  Type.Object({ kind: Type.Literal("invoked") }),
  Type.Object({ kind: Type.Literal("character"), character: Type.String() }),
  Type.Object({ kind: Type.Literal("incomplete") }),
]);

export type CompletionTrigger = Decoded<typeof CompletionTriggerType>;

/** Names one item of one completion answer of one server run; any later completion or restart makes it stale. */
export const CompletionResolveTokenType = Type.Object({
  kind: Type.Literal("completion"),
  server: idSchema<"language-server">(),
  answer: Type.Number(),
  item: Type.Number(),
});

export type CompletionResolveToken = Decoded<typeof CompletionResolveTokenType>;

export const CompletionKindType = Type.Enum([
  "text",
  "method",
  "function",
  "constructor",
  "field",
  "variable",
  "class",
  "interface",
  "module",
  "property",
  "unit",
  "value",
  "enum",
  "keyword",
  "snippet",
  "color",
  "file",
  "reference",
  "folder",
  "enumMember",
  "constant",
  "struct",
  "event",
  "operator",
  "typeParameter",
]);

export type CompletionKind = Decoded<typeof CompletionKindType>;

/** A tab stop in `insert.text`, counted in UTF-16 code units from its start; `$0` comes last. */
export const SnippetStopType = Type.Object({
  utf16Start: Type.Number(),
  utf16Length: Type.Number(),
});

export type SnippetStop = Decoded<typeof SnippetStopType>;

/** `tail` follows the label (parameters), `type` sits at the row's end; `insert.replace` null inserts at the caret. */
export const CompletionItemType = Type.Object({
  label: Type.String(),
  kind: CompletionKindType,
  tail: Type.String(),
  type: Type.String(),
  documentation: Type.String(),
  filter: Type.String(),
  sort: Type.String(),
  insert: Type.Object({
    text: Type.String(),
    stops: Type.Array(SnippetStopType),
    replace: nullable(TextRangeType),
  }),
  additionalEdits: Type.Array(TextEditType),
  commitCharacters: Type.Array(Type.String()),
  preselect: Type.Boolean(),
  deprecated: Type.Boolean(),
  invocation: Type.Enum(["none", "withoutArguments", "withArguments"]),
  resolve: nullable(CompletionResolveTokenType),
});

export type CompletionItem = Decoded<typeof CompletionItemType>;

export const CompletionListType = Type.Object({
  items: Type.Array(CompletionItemType),
  incomplete: Type.Boolean(),
});

export type CompletionList = Decoded<typeof CompletionListType>;

export const HoverType = Type.Object({ markdown: Type.String(), range: nullable(TextRangeType) });

export type Hover = Decoded<typeof HoverType>;

/** Each parameter is a span of `label` in UTF-16 code units. */
export const SignatureHelpType = Type.Object({
  signatures: Type.Array(
    Type.Object({
      label: Type.String(),
      documentation: Type.String(),
      parameters: Type.Array(Type.Object({ utf16Start: Type.Number(), utf16End: Type.Number() })),
    }),
  ),
  activeSignature: Type.Number(),
  activeParameter: nullable(Type.Number()),
});

export type SignatureHelp = Decoded<typeof SignatureHelpType>;

export const SymbolKindType = Type.Enum([
  "file",
  "module",
  "namespace",
  "package",
  "class",
  "method",
  "property",
  "field",
  "constructor",
  "enum",
  "interface",
  "function",
  "variable",
  "constant",
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "key",
  "null",
  "enumMember",
  "struct",
  "event",
  "operator",
  "typeParameter",
]);

export type SymbolKind = Decoded<typeof SymbolKindType>;

/** One row of a document's outline in document order; `depth` 0 is top level and a child follows its parent. */
export const DocumentSymbolType = Type.Object({
  name: Type.String(),
  detail: Type.String(),
  kind: SymbolKindType,
  range: TextRangeType,
  selection: TextRangeType,
  depth: Type.Number(),
  deprecated: Type.Boolean(),
});

export type DocumentSymbol = Decoded<typeof DocumentSymbolType>;

export const RenameTargetType = Type.Object({ range: TextRangeType, placeholder: Type.String() });

export type RenameTarget = Decoded<typeof RenameTargetType>;

/** `refused` carries the server's reason, or ours for an edit that would create, rename or delete a file. */
export const RenameOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("edit"), edit: WorkspaceEditType }),
  Type.Object({ kind: Type.Literal("refused"), reason: Type.String() }),
]);

export type RenameOutcome = Decoded<typeof RenameOutcomeType>;

/** Names one action of one code-action answer of one server run; any later answer or restart makes it stale. */
export const CodeActionResolveTokenType = Type.Object({
  kind: Type.Literal("codeAction"),
  server: idSchema<"language-server">(),
  answer: Type.Number(),
  item: Type.Number(),
});

export type CodeActionResolveToken = Decoded<typeof CodeActionResolveTokenType>;

export const CodeActionKindType = Type.Enum([
  "quickfix",
  "refactor",
  "refactor.extract",
  "refactor.inline",
  "refactor.rewrite",
  "source",
  "source.organizeImports",
  "source.fixAll",
  "other",
]);

export type CodeActionKind = Decoded<typeof CodeActionKindType>;

export const CodeActionType = Type.Object({
  title: Type.String(),
  kind: CodeActionKindType,
  preferred: Type.Boolean(),
  disabled: nullable(Type.String()),
  token: CodeActionResolveTokenType,
});

export type CodeAction = Decoded<typeof CodeActionType>;

/** The edit an action makes, with any edit the server asked to apply while running its command; nothing is written to disk. */
export const CodeActionOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("edit"), edit: WorkspaceEditType }),
  Type.Object({ kind: Type.Literal("stale") }),
  Type.Object({ kind: Type.Literal("refused"), reason: Type.String() }),
]);

export type CodeActionOutcome = Decoded<typeof CodeActionOutcomeType>;

export const InlayHintType = Type.Object({
  position: TextPositionType,
  label: Type.String(),
  kind: Type.Enum(["type", "parameter", "other"]),
  padLeft: Type.Boolean(),
  padRight: Type.Boolean(),
});

export type InlayHint = Decoded<typeof InlayHintType>;

export const FormatOptionsType = Type.Object({
  tabSize: Type.Number(),
  insertSpaces: Type.Boolean(),
});

export type FormatOptions = Decoded<typeof FormatOptionsType>;

/** `unavailable` when no server for the file formats documents, `failed` when its server errored. */
export const LanguageFormatOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("edits"), edits: Type.Array(TextEditType) }),
  Type.Object({ kind: Type.Literal("unavailable"), reason: Type.String() }),
  Type.Object({ kind: Type.Literal("failed"), reason: Type.String() }),
]);

export type LanguageFormatOutcome = Decoded<typeof LanguageFormatOutcomeType>;

export const DocumentHighlightType = Type.Object({
  range: TextRangeType,
  kind: Type.Enum(["text", "read", "write"]),
});

export type DocumentHighlight = Decoded<typeof DocumentHighlightType>;

/** A symbol found by name across the workspace; `container` is the symbol it sits in, empty at top level. */
export const WorkspaceSymbolType = Type.Object({
  name: Type.String(),
  kind: SymbolKindType,
  container: Type.String(),
  location: LanguageLocationType,
  deprecated: Type.Boolean(),
});

export type WorkspaceSymbol = Decoded<typeof WorkspaceSymbolType>;

/** Lines `startLine` through `endLine` fold, the first staying visible. */
export const FoldingRangeType = Type.Object({
  startLine: Type.Number(),
  endLine: Type.Number(),
  kind: nullable(Type.Enum(["comment", "imports", "region"])),
});

export type FoldingRange = Decoded<typeof FoldingRangeType>;

/** A document's tokens as LSP encodes them: five numbers per token in `data` (lines since the last token, UTF-16 columns since the last token on that line or the line's start, UTF-16 length, index into `types`, bit set over `modifiers`). */
export const SemanticTokensType = Type.Object({
  types: Type.Array(Type.String()),
  modifiers: Type.Array(Type.String()),
  data: Type.Array(Type.Number()),
});

export type SemanticTokens = Decoded<typeof SemanticTokensType>;

/** Names one item of one call or type hierarchy of one server run; preparing that hierarchy again or a restart makes it stale. */
export const HierarchyTokenType = Type.Object({
  kind: Type.Enum(["callHierarchy", "typeHierarchy"]),
  server: idSchema<"language-server">(),
  answer: Type.Number(),
  item: Type.Number(),
});

export type HierarchyToken = Decoded<typeof HierarchyTokenType>;

export const HierarchyItemType = Type.Object({
  name: Type.String(),
  detail: Type.String(),
  kind: SymbolKindType,
  location: LanguageLocationType,
  selection: TextRangeType,
  deprecated: Type.Boolean(),
  token: HierarchyTokenType,
});

export type HierarchyItem = Decoded<typeof HierarchyItemType>;

/** A caller or callee of the item asked about; `ranges` are the call sites, in the caller's file. */
export const HierarchyCallType = Type.Object({
  item: HierarchyItemType,
  ranges: Type.Array(TextRangeType),
});

export type HierarchyCall = Decoded<typeof HierarchyCallType>;

export const LanguageRefreshType = Type.Enum(["semanticTokens", "inlayHints"]);

export type LanguageRefresh = Decoded<typeof LanguageRefreshType>;
