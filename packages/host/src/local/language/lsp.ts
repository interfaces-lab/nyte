import { compile, textOffset } from "@nyte-ai/schema";
import type {
  CodeActionKind,
  CompletionItem,
  CompletionKind,
  DiagnosticSeverity,
  DocumentSymbol,
  Hover,
  InlayHint,
  LanguageDiagnostic,
  LanguageLocation,
  RenameTarget,
  SignatureHelp,
  SnippetStop,
  SymbolKind,
  TextEdit,
  TextPosition,
  TextRange,
  WorkspaceEdit,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { expandSnippet } from "./snippet.ts";

/** Turns a server's `file://` URI into the path the API answers with; null for any other scheme. */
export type Place = (uri: string) => string | null;

export const PositionType = Type.Object({ line: Type.Number(), character: Type.Number() });

export const RangeType = Type.Object({ start: PositionType, end: PositionType });

export const LocationType = Type.Object({ uri: Type.String(), range: RangeType });

const LocationLinkType = Type.Object({
  targetUri: Type.String(),
  targetRange: RangeType,
  targetSelectionRange: Type.Optional(RangeType),
});

const TextEditLspType = Type.Object({ range: RangeType, newText: Type.String() });

const MarkupType = Type.Union([
  Type.String(),
  Type.Object({ kind: Type.String(), value: Type.String() }),
  Type.Object({ language: Type.String(), value: Type.String() }),
  Type.Array(
    Type.Union([Type.String(), Type.Object({ language: Type.String(), value: Type.String() })]),
  ),
]);

const DiagnosticLspType = Type.Object({
  range: RangeType,
  severity: Type.Optional(Type.Number()),
  code: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()])),
  source: Type.Optional(Type.String()),
  message: Type.String(),
  tags: Type.Optional(Type.Array(Type.Number())),
  relatedInformation: Type.Optional(
    Type.Array(Type.Object({ location: LocationType, message: Type.String() })),
  ),
});

const DiagnosticLsp = compile(DiagnosticLspType);

const Locations = compile(
  Type.Union([Type.Null(), LocationType, Type.Array(Type.Union([LocationType, LocationLinkType]))]),
);

const Diagnostics = compile(
  Type.Object({
    uri: Type.String(),
    version: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    diagnostics: Type.Array(DiagnosticLspType),
  }),
);

const CompletionItemLspType = Type.Object({
  label: Type.String(),
  kind: Type.Optional(Type.Number()),
  detail: Type.Optional(Type.String()),
  labelDetails: Type.Optional(
    Type.Object({
      detail: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
    }),
  ),
  documentation: Type.Optional(MarkupType),
  deprecated: Type.Optional(Type.Boolean()),
  tags: Type.Optional(Type.Array(Type.Number())),
  preselect: Type.Optional(Type.Boolean()),
  sortText: Type.Optional(Type.String()),
  filterText: Type.Optional(Type.String()),
  insertText: Type.Optional(Type.String()),
  insertTextFormat: Type.Optional(Type.Number()),
  textEdit: Type.Optional(
    Type.Union([
      TextEditLspType,
      Type.Object({ newText: Type.String(), insert: RangeType, replace: RangeType }),
    ]),
  ),
  textEditText: Type.Optional(Type.String()),
  additionalTextEdits: Type.Optional(Type.Array(TextEditLspType)),
  commitCharacters: Type.Optional(Type.Array(Type.String())),
});

const CompletionDefaultsType = Type.Object({
  editRange: Type.Optional(
    Type.Union([RangeType, Type.Object({ insert: RangeType, replace: RangeType })]),
  ),
  insertTextFormat: Type.Optional(Type.Number()),
  commitCharacters: Type.Optional(Type.Array(Type.String())),
});

type CompletionDefaults = Static<typeof CompletionDefaultsType>;

const CompletionItemLsp = compile(CompletionItemLspType);

const CompletionAnswer = compile(
  Type.Union([
    Type.Null(),
    Type.Array(Type.Unknown()),
    Type.Object({
      isIncomplete: Type.Boolean(),
      itemDefaults: Type.Optional(CompletionDefaultsType),
      items: Type.Array(Type.Unknown()),
    }),
  ]),
);

const HoverLsp = compile(
  Type.Union([Type.Null(), Type.Object({ contents: MarkupType, range: Type.Optional(RangeType) })]),
);

const SignatureHelpLsp = compile(
  Type.Union([
    Type.Null(),
    Type.Object({
      signatures: Type.Array(
        Type.Object({
          label: Type.String(),
          documentation: Type.Optional(MarkupType),
          parameters: Type.Optional(
            Type.Array(
              Type.Object({
                label: Type.Union([Type.String(), Type.Tuple([Type.Number(), Type.Number()])]),
              }),
            ),
          ),
          activeParameter: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
        }),
      ),
      activeSignature: Type.Optional(Type.Number()),
      activeParameter: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    }),
  ]),
);

const DocumentSymbolLsp = compile(
  Type.Object({
    name: Type.String(),
    detail: Type.Optional(Type.String()),
    kind: Type.Number(),
    tags: Type.Optional(Type.Array(Type.Number())),
    deprecated: Type.Optional(Type.Boolean()),
    range: RangeType,
    selectionRange: RangeType,
    children: Type.Optional(Type.Array(Type.Unknown())),
  }),
);

const SymbolInformationLsp = compile(
  Type.Object({
    name: Type.String(),
    kind: Type.Number(),
    tags: Type.Optional(Type.Array(Type.Number())),
    deprecated: Type.Optional(Type.Boolean()),
    location: LocationType,
    containerName: Type.Optional(Type.String()),
  }),
);

const SymbolAnswer = compile(Type.Union([Type.Null(), Type.Array(Type.Unknown())]));

const TextEdits = compile(Type.Union([Type.Null(), Type.Array(TextEditLspType)]));

const PrepareRenameLsp = compile(
  Type.Union([
    Type.Null(),
    RangeType,
    Type.Object({ range: RangeType, placeholder: Type.String() }),
    Type.Object({ defaultBehavior: Type.Boolean() }),
  ]),
);

const WorkspaceEditLsp = compile(
  Type.Union([
    Type.Null(),
    Type.Object({
      changes: Type.Optional(Type.Record(Type.String(), Type.Array(TextEditLspType))),
      documentChanges: Type.Optional(
        Type.Array(
          Type.Union([
            Type.Object({ kind: Type.String() }),
            Type.Object({
              textDocument: Type.Object({ uri: Type.String() }),
              edits: Type.Array(TextEditLspType),
            }),
          ]),
        ),
      ),
    }),
  ]),
);

const CodeActionLsp = compile(
  Type.Object({
    title: Type.String(),
    kind: Type.Optional(Type.String()),
    isPreferred: Type.Optional(Type.Boolean()),
    disabled: Type.Optional(Type.Object({ reason: Type.String() })),
    edit: Type.Optional(Type.Unknown()),
    command: Type.Optional(Type.Unknown()),
    data: Type.Optional(Type.Unknown()),
  }),
);

const CommandLspType = Type.Object({
  title: Type.String(),
  command: Type.String(),
  arguments: Type.Optional(Type.Array(Type.Unknown())),
});

const CommandLsp = compile(CommandLspType);

const InlayHintsLsp = compile(
  Type.Union([
    Type.Null(),
    Type.Array(
      Type.Object({
        position: PositionType,
        label: Type.Union([Type.String(), Type.Array(Type.Object({ value: Type.String() }))]),
        kind: Type.Optional(Type.Number()),
        paddingLeft: Type.Optional(Type.Boolean()),
        paddingRight: Type.Optional(Type.Boolean()),
      }),
    ),
  ]),
);

const ProgressLsp = compile(
  Type.Object({
    token: Type.Union([Type.String(), Type.Number()]),
    value: Type.Object({
      kind: Type.Enum(["begin", "report", "end"]),
      title: Type.Optional(Type.String()),
      percentage: Type.Optional(Type.Number()),
    }),
  }),
);

const COMPLETION_KINDS: readonly CompletionKind[] = [
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
];

export const SYMBOL_KINDS: readonly SymbolKind[] = [
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
];

const SEVERITIES: readonly DiagnosticSeverity[] = ["error", "warning", "information", "hint"];

const ACTION_KINDS: readonly CodeActionKind[] = [
  "quickfix",
  "refactor.extract",
  "refactor.inline",
  "refactor.rewrite",
  "refactor",
  "source.organizeImports",
  "source.fixAll",
  "source",
];

const CALLABLE = new Set<CompletionKind>(["method", "function", "constructor"]);

export function toLspPosition(position: TextPosition): { line: number; character: number } {
  return { line: position.line, character: position.utf16Column };
}

export function toLspRange(range: TextRange) {
  return { start: toLspPosition(range.start), end: toLspPosition(range.end) };
}

export function readPosition(position: Static<typeof PositionType>): TextPosition {
  return { line: position.line, utf16Column: position.character };
}

export function readRange(range: Static<typeof RangeType>): TextRange {
  return { start: readPosition(range.start), end: readPosition(range.end) };
}

function readTextEdit(edit: Static<typeof TextEditLspType>): TextEdit {
  return { range: readRange(edit.range), text: edit.newText };
}

export function readLocations(value: unknown, place: Place): readonly LanguageLocation[] {
  if (!Locations.Check(value) || value === null) return [];
  const entries = Array.isArray(value) ? value : [value];

  return entries.flatMap((entry) => {
    const path = place("uri" in entry ? entry.uri : entry.targetUri);

    if (path === null) return [];
    const range = "uri" in entry ? entry.range : (entry.targetSelectionRange ?? entry.targetRange);

    return [{ path, range: readRange(range) }];
  });
}

export function readPublishedDiagnostics(value: unknown): {
  readonly uri: string;
  readonly version: number | null;
  readonly diagnostics: unknown[];
} | null {
  return Diagnostics.Check(value)
    ? { uri: value.uri, version: value.version ?? null, diagnostics: value.diagnostics }
    : null;
}

function readDiagnostic(value: Static<typeof DiagnosticLspType>, place: Place): LanguageDiagnostic {
  return {
    range: readRange(value.range),
    severity: SEVERITIES[(value.severity ?? 1) - 1] ?? "error",
    message: value.message,
    source: value.source ?? null,
    code: value.code === undefined || value.code === null ? null : String(value.code),
    tags: (value.tags ?? []).flatMap((tag) =>
      tag === 1 ? ["unnecessary" as const] : tag === 2 ? ["deprecated" as const] : [],
    ),
    related: (value.relatedInformation ?? []).flatMap((entry) => {
      const path = place(entry.location.uri);

      return path === null
        ? []
        : [{ location: { path, range: readRange(entry.location.range) }, message: entry.message }];
    }),
  };
}

export function readDiagnostics(
  values: readonly unknown[],
  place: Place,
): readonly LanguageDiagnostic[] {
  return values.flatMap((value) =>
    DiagnosticLsp.Check(value) ? [readDiagnostic(value, place)] : [],
  );
}

export function readMarkdown(value: Static<typeof MarkupType> | undefined): string {
  if (value === undefined) return "";

  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value
      .map((part) => readMarkdown(part))
      .filter((part) => part !== "")
      .join("\n\n");
  }

  if ("language" in value) return `\`\`\`${value.language}\n${value.value}\n\`\`\``;

  return value.kind === "plaintext" ? value.value.replaceAll("\n", "  \n") : value.value;
}

export function readCompletionAnswer(value: unknown): {
  readonly items: readonly unknown[];
  readonly defaults: CompletionDefaults | null;
  readonly incomplete: boolean;
} {
  if (!CompletionAnswer.Check(value) || value === null) {
    return { items: [], defaults: null, incomplete: false };
  }

  if (Array.isArray(value)) return { items: value, defaults: null, incomplete: false };

  return {
    items: value.items,
    defaults: value.itemDefaults ?? null,
    incomplete: value.isIncomplete,
  };
}

export function readCompletionItem(
  value: unknown,
  defaults: CompletionDefaults | null,
): Omit<CompletionItem, "resolve"> | null {
  if (!CompletionItemLsp.Check(value)) return null;
  const item = value;
  const format = item.insertTextFormat ?? defaults?.insertTextFormat ?? 1;
  const edit = item.textEdit;
  const fallback = defaults?.editRange;

  const replace =
    edit !== undefined
      ? "range" in edit
        ? edit.range
        : edit.replace
      : fallback === undefined
        ? null
        : "replace" in fallback
          ? fallback.replace
          : fallback;

  const raw =
    edit?.newText ??
    (fallback === undefined ? undefined : item.textEditText) ??
    item.insertText ??
    item.label;

  const expanded = format === 2 ? expandSnippet(raw) : { text: raw, stops: [] };
  const kind = COMPLETION_KINDS[(item.kind ?? 1) - 1] ?? "text";
  const detail = item.detail ?? "";
  const labelTail = item.labelDetails?.detail ?? "";
  const callable = CALLABLE.has(kind) || detail.startsWith("func(");

  const signature = callable
    ? (readCallSignature(labelTail, "") ?? readCallSignature(detail, item.label))
    : null;

  const bare =
    callable && expanded.text.startsWith(`${item.label}(`) && expanded.text.endsWith(")");

  const stops: readonly SnippetStop[] = bare ? [] : expanded.stops;

  return {
    label: item.label,
    kind,
    tail: signature?.parameters ?? labelTail,
    type: signature?.result ?? item.labelDetails?.description ?? detail,
    documentation: readMarkdown(item.documentation),
    filter: item.filterText ?? item.label,
    sort: item.sortText ?? item.label,
    insert: {
      text: bare ? item.label : expanded.text,
      stops: [...stops],
      replace: replace === null ? null : readRange(replace),
    },
    additionalEdits: (item.additionalTextEdits ?? []).map(readTextEdit),
    commitCharacters: item.commitCharacters ?? defaults?.commitCharacters ?? [],
    preselect: item.preselect ?? false,
    deprecated: item.deprecated ?? (item.tags ?? []).includes(1),
    invocation: !callable
      ? "none"
      : signature !== null && signature.parameters.replaceAll(/\s/g, "") === "()"
        ? "withoutArguments"
        : "withArguments",
  };
}

function readCallSignature(
  signature: string,
  name: string,
): { readonly parameters: string; readonly result: string } | null {
  const named = name === "" ? -1 : signature.search(new RegExp(`${RegExp.escape(name)}[(<]`));
  const first = signature.search(/[(<]/);

  const start =
    named >= 0
      ? named + name.length
      : first >= 0 && (signature.startsWith("func") || first === 0)
        ? first
        : -1;

  if (start < 0) return null;
  const rest = signature.slice(start);
  const end = closingParenthesis(rest);

  if (end < 0) return null;

  const result = rest
    .slice(end + 1)
    .trimStart()
    .replace(/^:\s*/, "")
    .replace(/^=>\s*/, "");

  return { parameters: rest.slice(0, end + 1), result };
}

function closingParenthesis(text: string): number {
  let depth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === "(" || character === "<" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === ">" || character === "]" || character === "}") {
      depth -= 1;

      if (depth === 0 && character === ")") return index;
    }
  }

  return -1;
}

export function readHover(value: unknown): Hover | null {
  if (!HoverLsp.Check(value) || value === null) return null;
  const markdown = readMarkdown(value.contents);

  return markdown === ""
    ? null
    : { markdown, range: value.range === undefined ? null : readRange(value.range) };
}

export function readSignatureHelp(value: unknown): SignatureHelp | null {
  if (!SignatureHelpLsp.Check(value) || value === null || value.signatures.length === 0) {
    return null;
  }
  const active = value.activeSignature ?? 0;

  return {
    signatures: value.signatures.map((signature) => ({
      label: signature.label,
      documentation: readMarkdown(signature.documentation),
      parameters: (signature.parameters ?? []).flatMap((parameter) => {
        if (Array.isArray(parameter.label)) {
          return [{ utf16Start: parameter.label[0], utf16End: parameter.label[1] }];
        }
        const start = signature.label.indexOf(parameter.label);

        return start < 0 ? [] : [{ utf16Start: start, utf16End: start + parameter.label.length }];
      }),
    })),
    activeSignature: active,
    activeParameter: value.signatures[active]?.activeParameter ?? value.activeParameter ?? null,
  };
}

export function readSymbols(value: unknown): readonly DocumentSymbol[] {
  if (!SymbolAnswer.Check(value) || value === null) return [];

  return walkSymbols(value, 0);
}

function walkSymbols(nodes: readonly unknown[], depth: number): DocumentSymbol[] {
  const rows = nodes.flatMap((node) => {
    if (DocumentSymbolLsp.Check(node)) {
      return [
        {
          row: {
            name: node.name,
            detail: node.detail ?? "",
            kind: SYMBOL_KINDS[node.kind - 1] ?? "variable",
            range: readRange(node.range),
            selection: readRange(node.selectionRange),
            depth,
            deprecated: node.deprecated ?? (node.tags ?? []).includes(1),
          },
          children: node.children ?? [],
        },
      ];
    }

    if (SymbolInformationLsp.Check(node)) {
      return [
        {
          row: {
            name: node.name,
            detail: node.containerName ?? "",
            kind: SYMBOL_KINDS[node.kind - 1] ?? "variable",
            range: readRange(node.location.range),
            selection: readRange(node.location.range),
            depth,
            deprecated: node.deprecated ?? (node.tags ?? []).includes(1),
          },
          children: [],
        },
      ];
    }

    return [];
  });

  return rows
    .toSorted((left, right) => comparePositions(left.row.range.start, right.row.range.start))
    .flatMap((entry) => [entry.row, ...walkSymbols(entry.children, depth + 1)]);
}

export function comparePositions(left: TextPosition, right: TextPosition): number {
  return left.line === right.line ? left.utf16Column - right.utf16Column : left.line - right.line;
}

export function readTextEdits(value: unknown): readonly TextEdit[] {
  return TextEdits.Check(value) && value !== null ? value.map(readTextEdit) : [];
}

export function readPrepareRename(
  value: unknown,
  text: string,
  position: TextPosition,
): RenameTarget | null {
  if (!PrepareRenameLsp.Check(value) || value === null) return null;

  if ("defaultBehavior" in value) return findWord(text, position);

  if ("placeholder" in value) {
    return { range: readRange(value.range), placeholder: value.placeholder };
  }

  const range = readRange(value);

  return {
    range,
    placeholder: text.slice(textOffset(text, range.start), textOffset(text, range.end)),
  };
}

export function findWord(text: string, position: TextPosition): RenameTarget | null {
  const offset = textOffset(text, position);
  const before = /[\p{L}\p{N}_$]*$/u.exec(text.slice(0, offset))?.[0] ?? "";
  const after = /^[\p{L}\p{N}_$]*/u.exec(text.slice(offset))?.[0] ?? "";

  return before === "" && after === ""
    ? null
    : {
        range: {
          start: { line: position.line, utf16Column: position.utf16Column - before.length },
          end: { line: position.line, utf16Column: position.utf16Column + after.length },
        },
        placeholder: before + after,
      };
}

export function readWorkspaceEdit(
  value: unknown,
  place: Place,
):
  | { readonly kind: "edit"; readonly edit: WorkspaceEdit }
  | { readonly kind: "refused"; readonly reason: string } {
  if (!WorkspaceEditLsp.Check(value) || value === null) {
    return { kind: "edit", edit: { files: [] } };
  }
  const operation = (value.documentChanges ?? []).find((change) => "kind" in change);

  if (operation !== undefined && "kind" in operation) {
    return {
      kind: "refused",
      reason: `This change would ${operation.kind} a file, which a returned edit cannot do yet.`,
    };
  }

  const documents = (value.documentChanges ?? []).flatMap((change) =>
    "textDocument" in change ? [{ uri: change.textDocument.uri, edits: change.edits }] : [],
  );

  const changes =
    documents.length > 0
      ? documents
      : Object.entries(value.changes ?? {}).map((entry) => ({ uri: entry[0], edits: entry[1] }));

  return {
    kind: "edit",
    edit: {
      files: changes.flatMap((change) => {
        const path = place(change.uri);

        return path === null ? [] : [{ path, edits: change.edits.map(readTextEdit) }];
      }),
    },
  };
}

export interface ActionPlan {
  readonly title: string;
  readonly kind: CodeActionKind;
  readonly preferred: boolean;
  readonly disabled: string | null;
  readonly edit: unknown;
  readonly command: unknown;
  readonly raw: unknown;
  readonly resolvable: boolean;
}

export function readCodeActions(value: unknown): readonly ActionPlan[] {
  if (!SymbolAnswer.Check(value) || value === null) return [];

  return value.flatMap((entry): ActionPlan[] => {
    if (CommandLsp.Check(entry)) {
      return [
        {
          title: entry.title,
          kind: "other",
          preferred: false,
          disabled: null,
          edit: undefined,
          command: entry,
          raw: entry,
          resolvable: false,
        },
      ];
    }

    if (!CodeActionLsp.Check(entry)) return [];
    const kind = entry.kind ?? "";

    return [
      {
        title: entry.title,
        kind:
          ACTION_KINDS.find(
            (candidate) => kind === candidate || kind.startsWith(`${candidate}.`),
          ) ?? "other",
        preferred: entry.isPreferred ?? false,
        disabled: entry.disabled?.reason ?? null,
        edit: entry.edit,
        command: entry.command,
        raw: entry,
        resolvable: entry.edit === undefined && entry.data !== undefined,
      },
    ];
  });
}

export function readCodeAction(value: unknown): ActionPlan | null {
  return readCodeActions([value])[0] ?? null;
}

export function readCommand(value: unknown): Static<typeof CommandLspType> | null {
  return CommandLsp.Check(value) ? value : null;
}

export function readInlayHints(value: unknown): readonly InlayHint[] {
  if (!InlayHintsLsp.Check(value) || value === null) return [];

  return value
    .map((hint) => ({
      position: readPosition(hint.position),
      label:
        typeof hint.label === "string" ? hint.label : hint.label.map((part) => part.value).join(""),
      kind:
        hint.kind === 1
          ? ("type" as const)
          : hint.kind === 2
            ? ("parameter" as const)
            : ("other" as const),
      padLeft: hint.paddingLeft ?? false,
      padRight: hint.paddingRight ?? false,
    }))
    .toSorted((left, right) => comparePositions(left.position, right.position));
}

export function readProgress(value: unknown): {
  readonly token: string;
  readonly kind: "begin" | "report" | "end";
  readonly title: string | null;
  readonly percent: number | null;
} | null {
  if (!ProgressLsp.Check(value)) return null;

  return {
    token: String(value.token),
    kind: value.value.kind,
    title: value.value.title ?? null,
    percent: value.value.percentage ?? null,
  };
}
