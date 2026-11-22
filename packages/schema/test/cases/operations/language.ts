import { OPERATIONS } from "../../../src/index.ts";
import { operation, workspace, workspaceInput } from "../fixtures.ts";
import type { Case } from "../fixtures.ts";

const position = { line: 31, utf16Column: 12 };

const range = { start: position, end: { line: 31, utf16Column: 17 } };

const at = { workspace, path: "main.go", position };

const server = {
  languages: ["go"],
  server: "gopls",
  root: "",
  state: { kind: "busy", title: "Indexing", percent: null },
  version: "v0.24.0",
  executable: "/usr/local/bin/gopls",
  features: ["hover", "rename"],
};

const completionToken = { kind: "completion", server: "s1", answer: 3, item: 0 };

const actionToken = { kind: "codeAction", server: "s1", answer: 7, item: 0 };

const item = {
  label: "Names",
  kind: "method",
  tail: "()",
  type: "[]string",
  documentation: "",
  filter: "Names",
  sort: "00000",
  insert: { text: "Names", stops: [{ utf16Start: 0, utf16Length: 5 }], replace: range },
  additionalEdits: [{ range, text: "" }],
  commitCharacters: ["."],
  preselect: false,
  deprecated: false,
  invocation: "withoutArguments",
  resolve: completionToken,
};

const edit = { files: [{ path: "hub/stats.go", edits: [{ range, text: "Totals" }] }] };

export const languageOperations = {
  "workspace.language input": operation(OPERATIONS["workspace.language"].input, workspaceInput, {}),
  "language.status input": operation(OPERATIONS["language.status"].input, workspaceInput, {}),
  "language.status output": operation(
    OPERATIONS["language.status"].output,
    [server, { ...server, state: { kind: "installing", percent: 42 }, features: [] }],
    [{ ...server, features: ["telepathy"] }],
  ),
  "language.watchStatus input": operation(
    OPERATIONS["language.watchStatus"].input,
    workspaceInput,
    {},
  ),
  "language.watchStatus output": operation(
    OPERATIONS["language.watchStatus"].output,
    [],
    [{ server: "gopls" }],
  ),
  "language.open input": operation(
    OPERATIONS["language.open"].input,
    { workspace, path: "main.go", text: "package main\n", version: 1 },
    { workspace, path: "main.go", text: "package main\n" },
  ),
  "language.open output": operation(
    OPERATIONS["language.open"].output,
    [],
    [{ ...server, languages: ["klingon"] }],
  ),
  "language.change input": operation(
    OPERATIONS["language.change"].input,
    {
      workspace,
      path: "main.go",
      version: 2,
      changes: [
        { range, text: "Stats" },
        { range: null, text: "package main\n" },
      ],
    },
    { workspace, path: "main.go", version: 2, changes: [{ text: "x" }] },
  ),
  "language.close input": operation(
    OPERATIONS["language.close"].input,
    { workspace, path: "main.go" },
    { workspace },
  ),
  "language.diagnostics input": operation(
    OPERATIONS["language.diagnostics"].input,
    workspaceInput,
    {},
  ),
  "language.diagnostics output": operation(
    OPERATIONS["language.diagnostics"].output,
    [
      {
        path: "hub/hub.go",
        version: null,
        diagnostics: [
          {
            range,
            severity: "warning",
            message: "nil dereference",
            source: "nilness",
            code: null,
            tags: ["unnecessary"],
            related: [{ location: { path: "hub/hub.go", range }, message: "here" }],
          },
        ],
      },
    ],
    [
      {
        path: "hub/hub.go",
        version: null,
        diagnostics: [{ range, severity: "fatal", message: "x" }],
      },
    ],
  ),
  "language.completion input": operation(
    OPERATIONS["language.completion"].input,
    { ...at, trigger: { kind: "character", character: "." } },
    { ...at, trigger: { kind: "typed" } },
  ),
  "language.completion output": operation(
    OPERATIONS["language.completion"].output,
    { items: [item], incomplete: false },
    { items: [{ ...item, resolve: 3 }], incomplete: false },
  ),
  "language.resolveCompletion input": operation(
    OPERATIONS["language.resolveCompletion"].input,
    { workspace, token: completionToken },
    { workspace, token: actionToken },
  ),
  "language.resolveCompletion output": operation(
    OPERATIONS["language.resolveCompletion"].output,
    item,
    { ...item, invocation: "maybe" },
  ),
  "language.hover input": operation(OPERATIONS["language.hover"].input, at, {
    workspace,
    path: "main.go",
  }),
  "language.hover output": operation(
    OPERATIONS["language.hover"].output,
    { markdown: "**Stats**", range: null },
    { markdown: 1, range: null },
  ),
  "language.definition output": operation(
    OPERATIONS["language.definition"].output,
    [{ path: "hub/hub.go", range }],
    [{ path: "hub/hub.go", range: { start: position } }],
  ),
  "language.references input": operation(
    OPERATIONS["language.references"].input,
    { ...at, includeDeclaration: true },
    at,
  ),
  "language.symbols output": operation(
    OPERATIONS["language.symbols"].output,
    [
      {
        name: "Counts",
        detail: "",
        kind: "struct",
        range,
        selection: range,
        depth: 0,
        deprecated: false,
      },
    ],
    [
      {
        name: "Counts",
        detail: "",
        kind: "record",
        range,
        selection: range,
        depth: 0,
        deprecated: false,
      },
    ],
  ),
  "language.prepareRename output": operation(
    OPERATIONS["language.prepareRename"].output,
    { range, placeholder: "Counts" },
    { range },
  ),
  "language.rename input": operation(
    OPERATIONS["language.rename"].input,
    { ...at, name: "Totals" },
    at,
  ),
  "language.rename output": operation(
    OPERATIONS["language.rename"].output,
    { kind: "edit", edit },
    { kind: "refused" },
  ),
  "language.codeActions input": operation(
    OPERATIONS["language.codeActions"].input,
    { workspace, path: "main.go", range },
    { workspace, path: "main.go", range: position },
  ),
  "language.codeActions output": operation(
    OPERATIONS["language.codeActions"].output,
    [
      {
        title: "Remove unused parameter",
        kind: "quickfix",
        preferred: true,
        disabled: null,
        token: actionToken,
      },
    ],
    [
      {
        title: "Remove unused parameter",
        kind: "quickfix",
        preferred: true,
        disabled: null,
        token: completionToken,
      },
    ],
  ),
  "language.resolveCodeAction input": operation(
    OPERATIONS["language.resolveCodeAction"].input,
    { workspace, token: actionToken },
    { workspace, token: { ...actionToken, item: "0" } },
  ),
  "language.resolveCodeAction output": operation(
    OPERATIONS["language.resolveCodeAction"].output,
    { kind: "stale" },
    { kind: "edit" },
  ),
  "language.format input": operation(
    OPERATIONS["language.format"].input,
    { workspace, path: "main.go", options: { tabSize: 4, insertSpaces: false }, range },
    { workspace, path: "main.go", options: { tabSize: 4 } },
  ),
  "language.format output": operation(
    OPERATIONS["language.format"].output,
    { kind: "edits", edits: [{ range, text: "\t" }] },
    { kind: "edits", edits: [{ range, newText: "\t" }] },
  ),
} satisfies Record<string, Case>;
