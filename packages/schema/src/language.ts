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
  "css",
  "go",
  "html",
  "java",
  "json",
  "lua",
  "markdown",
  "python",
  "ruby",
  "rust",
  "sql",
  "swift",
  "toml",
  "typescript",
  "yaml",
]);

export type LanguageName = Decoded<typeof LanguageNameType>;

export const LANGUAGES: Readonly<
  Record<
    LanguageName,
    {
      readonly label: string;
      readonly ids: Readonly<Record<string, string>>;
      readonly fileNames?: Readonly<Record<string, string>>;
    }
  >
> = {
  bash: {
    label: "Shell",
    ids: {
      ".sh": "shellscript",
      ".bash": "shellscript",
      ".zsh": "shellscript",
      ".ksh": "shellscript",
      ".ebuild": "shellscript",
      ".eclass": "shellscript",
      ".zsh-theme": "shellscript",
    },
    fileNames: {
      ".bashrc": "shellscript",
      ".bash_aliases": "shellscript",
      ".bash_profile": "shellscript",
      ".bash_login": "shellscript",
      ".bash_logout": "shellscript",
      ".profile": "shellscript",
      ".xprofile": "shellscript",
      ".xsession": "shellscript",
      ".xsessionrc": "shellscript",
      ".zshrc": "shellscript",
      ".zprofile": "shellscript",
      ".zlogin": "shellscript",
      ".zlogout": "shellscript",
      ".zshenv": "shellscript",
      ".envrc": "shellscript",
      APKBUILD: "shellscript",
      PKGBUILD: "shellscript",
      zshrc: "shellscript",
      zshenv: "shellscript",
      zlogin: "shellscript",
      zprofile: "shellscript",
      zlogout: "shellscript",
      bashrc_Apple_Terminal: "shellscript",
      zshrc_Apple_Terminal: "shellscript",
    },
  },
  c: {
    label: "C and C++",
    ids: {
      ".c": "c",
      ".h": "c",
      ".i": "c",
      ".cc": "cpp",
      ".ccm": "cpp",
      ".cpp": "cpp",
      ".cppm": "cpp",
      ".cxx": "cpp",
      ".cxxm": "cpp",
      ".c++": "cpp",
      ".c++m": "cpp",
      ".hh": "cpp",
      ".hpp": "cpp",
      ".hxx": "cpp",
      ".h++": "cpp",
      ".ii": "cpp",
      ".inl": "cpp",
      ".ino": "cpp",
      ".ipp": "cpp",
      ".ixx": "cpp",
      ".mpp": "cpp",
      ".mxx": "cpp",
      ".tpp": "cpp",
      ".txx": "cpp",
      ".cu": "cuda-cpp",
      ".cuh": "cuda-cpp",
      ".m": "objective-c",
      ".mm": "objective-cpp",
    },
  },
  css: { label: "CSS", ids: { ".css": "css", ".scss": "scss", ".less": "less" } },
  go: {
    label: "Go",
    ids: { ".go": "go", ".tmpl": "gotmpl", ".gotmpl": "gotmpl" },
    fileNames: { "go.mod": "go.mod", "go.work": "go.work", "go.sum": "go.sum" },
  },
  html: {
    label: "HTML",
    ids: {
      ".html": "html",
      ".htm": "html",
      ".shtml": "html",
      ".xhtml": "html",
      ".xht": "html",
      ".mdoc": "html",
      ".jsp": "html",
      ".asp": "html",
      ".aspx": "html",
      ".jshtm": "html",
      ".volt": "html",
      ".ejs": "html",
      ".rhtml": "html",
      ".handlebars": "handlebars",
      ".hbs": "handlebars",
      ".hjs": "handlebars",
    },
  },
  java: { label: "Java", ids: { ".java": "java" } },
  json: {
    label: "JSON",
    ids: {
      ".json": "json",
      ".bowerrc": "json",
      ".jscsrc": "json",
      ".webmanifest": "json",
      ".har": "json",
      ".jslintrc": "json",
      ".jsonld": "json",
      ".geojson": "json",
      ".ipynb": "json",
      ".vuerc": "json",
      ".jsonc": "jsonc",
      ".eslintrc": "jsonc",
      ".jsfmtrc": "jsonc",
      ".jshintrc": "jsonc",
      ".swcrc": "jsonc",
      ".hintrc": "jsonc",
      ".babelrc": "jsonc",
      ".code-snippets": "jsonc",
    },
    fileNames: {
      "composer.lock": "json",
      ".watchmanconfig": "json",
      "*.js.map": "json",
      "*.css.map": "json",
      "*.ts.map": "json",
      "tsconfig.json": "jsonc",
      "tsconfig.*.json": "jsonc",
      "tsconfig-*.json": "jsonc",
      "jsconfig.json": "jsonc",
      "jsconfig.*.json": "jsonc",
      "jsconfig-*.json": "jsonc",
      ".eslintrc.json": "jsonc",
      "babel.config.json": "jsonc",
      ".babelrc.json": "jsonc",
      ".ember-cli": "jsonc",
      "bun.lock": "jsonc",
      "typedoc.json": "jsonc",
    },
  },
  lua: { label: "Lua", ids: { ".lua": "lua" } },
  markdown: { label: "Markdown", ids: { ".md": "markdown", ".markdown": "markdown" } },
  python: { label: "Python", ids: { ".py": "python", ".pyi": "python" } },
  ruby: {
    label: "Ruby",
    ids: {
      ".rb": "ruby",
      ".rbx": "ruby",
      ".rjs": "ruby",
      ".gemspec": "ruby",
      ".rake": "ruby",
      ".ru": "ruby",
      ".podspec": "ruby",
      ".rbi": "ruby",
    },
    fileNames: {
      Rakefile: "ruby",
      Gemfile: "ruby",
      Guardfile: "ruby",
      Podfile: "ruby",
      Capfile: "ruby",
      Cheffile: "ruby",
      Hobofile: "ruby",
      Vagrantfile: "ruby",
      Appraisals: "ruby",
      Rantfile: "ruby",
      Berksfile: "ruby",
      "Berksfile.lock": "ruby",
      Thorfile: "ruby",
      Puppetfile: "ruby",
      Dangerfile: "ruby",
      Brewfile: "ruby",
      Fastfile: "ruby",
      Appfile: "ruby",
      Deliverfile: "ruby",
      Matchfile: "ruby",
      Scanfile: "ruby",
      Snapfile: "ruby",
      Gymfile: "ruby",
    },
  },
  rust: { label: "Rust", ids: { ".rs": "rust" } },
  sql: { label: "SQL", ids: { ".sql": "sql" } },
  swift: { label: "Swift", ids: { ".swift": "swift" } },
  toml: {
    label: "TOML",
    ids: { ".toml": "toml" },
    fileNames: {
      "Cargo.lock": "toml",
      "Gopkg.lock": "toml",
      Pipfile: "toml",
      "pdm.lock": "toml",
      "poetry.lock": "toml",
      "uv.lock": "toml",
    },
  },
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
  yaml: {
    label: "YAML",
    ids: { ".yaml": "yaml", ".yml": "yaml", ".eyaml": "yaml", ".eyml": "yaml", ".cff": "yaml" },
    fileNames: { ".clang-format": "yaml", "_clang-format": "yaml", ".clang-tidy": "yaml" },
  },
};

interface FoundLanguage {
  readonly name: LanguageName;
  readonly id: string;
}

const LANGUAGE_BY_EXTENSION = new Map(
  LanguageNameType.enum.flatMap((name) =>
    Object.entries(LANGUAGES[name].ids).map((entry) => [entry[0], { name, id: entry[1] }] as const),
  ),
);

const FILE_NAMES = LanguageNameType.enum.flatMap((name) =>
  Object.entries(LANGUAGES[name].fileNames ?? {}).map((entry) => {
    const pattern = entry[0].toLowerCase();
    const star = pattern.indexOf("*");
    const found: FoundLanguage = { name, id: entry[1] };

    return star < 0
      ? { prefix: pattern, suffix: null, found }
      : { prefix: pattern.slice(0, star), suffix: pattern.slice(star + 1), found };
  }),
);

export function findLanguage(path: string): FoundLanguage | null {
  const file = path
    .slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1)
    .toLowerCase();

  const named = FILE_NAMES.find((entry) =>
    entry.suffix === null
      ? file === entry.prefix
      : file.length >= entry.prefix.length + entry.suffix.length &&
        file.startsWith(entry.prefix) &&
        file.endsWith(entry.suffix),
  );

  if (named !== undefined) return named.found;

  const dot = file.lastIndexOf(".");

  return dot < 0 ? null : (LANGUAGE_BY_EXTENSION.get(file.slice(dot)) ?? null);
}

export const LanguageFeatureType = Type.Enum([
  "completion",
  "hover",
  "definition",
  "typeDefinition",
  "references",
  "symbols",
  "codeActions",
  "format",
  "formatRange",
  "rename",
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
  Type.Object({ kind: Type.Literal("available"), bytes: nullable(Type.Number()) }),
  Type.Object({ kind: Type.Literal("installing"), percent: nullable(Type.Number()) }),
  Type.Object({ kind: Type.Literal("untrusted") }),
  Type.Object({ kind: Type.Literal("failed"), reason: Type.String() }),
  Type.Object({ kind: Type.Literal("idle") }),
]);

export type LanguageServerState = Decoded<typeof LanguageServerStateType>;

/** One language server for one project root: `available` while its download waits to be asked for with `language.install`, with the download's size when known; `installing` while its pinned version downloads; `idle` after it shut down for want of use, until the next request starts it again; `untrusted` while the user has not trusted the folder, since a server runs project code. `features` lists what it answers, and is empty until it is ready; `completionTriggers` lists the characters that open its completion list. */
export const LanguageServerViewType = Type.Object({
  languages: Type.Array(LanguageNameType),
  server: Type.String(),
  root: Type.String(),
  state: LanguageServerStateType,
  version: nullable(Type.String()),
  executable: nullable(Type.String()),
  features: Type.Array(LanguageFeatureType),
  completionTriggers: Type.Array(Type.String()),
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

/** A tab stop in `insert.text`, counted in UTF-16 code units from its start; the last is where the caret ends, `$0` or the end of the text. */
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

export const FormatOptionsType = Type.Object({
  tabSize: Type.Number(),
  insertSpaces: Type.Boolean(),
});

export type FormatOptions = Decoded<typeof FormatOptionsType>;

export const LanguageFormatOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("edits"), edits: Type.Array(TextEditType) }),
  Type.Object({ kind: Type.Literal("unavailable"), reason: Type.String() }),
  Type.Object({ kind: Type.Literal("failed"), reason: Type.String() }),
]);

export type LanguageFormatOutcome = Decoded<typeof LanguageFormatOutcomeType>;
