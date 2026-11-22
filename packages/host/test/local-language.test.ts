import { chmod, cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CompletionItem,
  DiagnosticSeverity,
  DiagnosticsFrame,
  SymbolKind,
  TextPosition,
} from "@nyte-ai/schema";
import type { LanguageService } from "@nyte-ai/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { IDLE_MS, RESTART_LIMIT, localLanguage } from "../src/local/language/manager.ts";
import { expandSnippet } from "../src/local/language/snippet.ts";
import { findExecutable } from "../src/local/process/command.ts";
import { localEnv, serverProcesses, until } from "./language-harness.ts";

interface Fixture {
  readonly folder: string;
  readonly server: string;
  readonly files: readonly string[];
  readonly problems: readonly {
    readonly at: string;
    readonly severity: DiagnosticSeverity;
    readonly says: string;
  }[];
  readonly hover: { readonly at: string; readonly says: string };
  readonly completion: {
    readonly file: string;
    readonly after: number;
    readonly text: string;
    readonly members: readonly string[];
    readonly accept: string;
    readonly yields: string;
  };
  readonly row: {
    readonly label: string;
    readonly tail: string;
    readonly type: string;
    readonly invocation: CompletionItem["invocation"];
  };
  readonly locations: readonly {
    readonly query: "definition" | "typeDefinition" | "references";
    readonly at: string;
    readonly goes: readonly string[];
  }[];
  readonly symbols: {
    readonly file: string;
    readonly has: readonly {
      readonly name: string;
      readonly kind: SymbolKind;
      readonly depth: number;
    }[];
  };
  readonly rename: {
    readonly at: string;
    readonly placeholder: string;
    readonly files: readonly string[];
  };
  readonly signature: { readonly at: string; readonly says: string; readonly parameter: string };
  readonly breaking: { readonly file: string; readonly after: number; readonly text: string };
  readonly misindent: {
    readonly file: string;
    readonly line: number;
    readonly indent: string;
    readonly bad: string;
  };
  readonly annotated: string;
  readonly action: { readonly at: string; readonly title: string };
}

const GO: Fixture = {
  folder: "notifyhub-go",
  server: "gopls",
  files: [
    "main.go",
    "hub/hub.go",
    "hub/email.go",
    "hub/webhook.go",
    "hub/stats.go",
    "hub/hub_test.go",
  ],
  problems: [
    { at: "hub/hub.go:77", severity: "information", says: '"describe" is unused' },
    { at: "hub/hub.go:77", severity: "information", says: "unused parameter: verbose" },
    { at: "hub/hub.go:80", severity: "warning", says: "nil dereference" },
  ],
  hover: { at: "main.go:32:13", says: "func (h *hub.Hub) Stats() hub.Stats" },
  completion: {
    file: "main.go",
    after: 32,
    text: "\tstats.",
    members: ["Names", "Total", "Channels"],
    accept: "Names",
    yields: "\tstats.Names",
  },
  row: { label: "Names", tail: "()", type: "[]string", invocation: "withoutArguments" },
  locations: [
    { query: "definition", at: "main.go:17:11", goes: ["hub/hub.go:36"] },
    { query: "typeDefinition", at: "main.go:26:9", goes: ["hub/hub.go:12"] },
    {
      query: "references",
      at: "hub/stats.go:55:6",
      goes: ["hub/stats.go:40", "hub/stats.go:44", "hub/stats.go:55"],
    },
  ],
  symbols: {
    file: "hub/stats.go",
    has: [
      { name: "Counts", kind: "struct", depth: 0 },
      { name: "Submitted", kind: "field", depth: 1 },
      { name: "Stats", kind: "struct", depth: 0 },
      { name: "Channels", kind: "field", depth: 1 },
      { name: "newStats", kind: "function", depth: 0 },
      { name: "(Stats).Names", kind: "method", depth: 0 },
    ],
  },
  rename: {
    at: "hub/stats.go:6:6",
    placeholder: "Counts",
    files: ["hub/hub_test.go", "hub/stats.go"],
  },
  signature: {
    at: "main.go:27:27",
    says: "Submit(ctx context.Context, message hub.Message) error",
    parameter: "message hub.Message",
  },
  breaking: { file: "hub/hub.go", after: 36, text: '\tvar broken int = "text"' },
  misindent: { file: "hub/hub.go", line: 42, indent: "\t", bad: "      " },
  annotated: "main.go",
  action: { at: "hub/hub.go:77:35", title: "Remove unused parameter" },
};

const TYPESCRIPT: Fixture = {
  folder: "notifyhub-ts",
  server: "typescript-language-server",
  files: [
    "src/index.ts",
    "src/hub.ts",
    "src/stats.ts",
    "src/channels/email.ts",
    "src/channels/webhook.ts",
  ],
  problems: [
    {
      at: "src/channels/webhook.ts:19",
      severity: "error",
      says: "not assignable to type 'number'",
    },
    {
      at: "src/channels/webhook.ts:19",
      severity: "error",
      says: "'retries' is declared but its value is never read",
    },
  ],
  hover: {
    at: "src/index.ts:19:16",
    says: "Hub.submit(message: Message, signal: AbortSignal): Promise<void>",
  },
  completion: {
    file: "src/index.ts",
    after: 8,
    text: "hub.",
    members: ["register", "submit", "stats"],
    accept: "register",
    yields: "hub.register",
  },
  row: { label: "register", tail: "(channel: Channel)", type: "void", invocation: "withArguments" },
  locations: [
    { query: "definition", at: "src/index.ts:6:17", goes: ["src/hub.ts:27"] },
    { query: "typeDefinition", at: "src/index.ts:17:12", goes: ["src/hub.ts:4"] },
    {
      query: "references",
      at: "src/stats.ts:34:10",
      goes: ["src/stats.ts:22", "src/stats.ts:24", "src/stats.ts:34"],
    },
  ],
  symbols: {
    file: "src/hub.ts",
    has: [
      { name: "Message", kind: "interface", depth: 0 },
      { name: "channel", kind: "property", depth: 1 },
      { name: "Hub", kind: "class", depth: 0 },
      { name: "register", kind: "method", depth: 1 },
      { name: "submit", kind: "method", depth: 1 },
    ],
  },
  rename: { at: "src/stats.ts:2:18", placeholder: "Counts", files: ["src/stats.ts"] },
  signature: {
    at: "src/index.ts:19:31",
    says: "submit(message: Message, signal: AbortSignal): Promise<void>",
    parameter: "signal: AbortSignal",
  },
  breaking: { file: "src/hub.ts", after: 54, text: '    const broken: number = "text";' },
  misindent: { file: "src/channels/webhook.ts", line: 14, indent: "    ", bad: "          " },
  annotated: "src/index.ts",
  action: { at: "src/channels/webhook.ts:19:11", title: "Remove unused declaration" },
};

const FIXTURES = join(import.meta.dirname, "fixtures", "language");

const installed = new Set(
  (
    await Promise.all(
      ["gopls", "typescript-language-server"].map(async (program) =>
        (await findExecutable(program)) === null ? [] : [program],
      ),
    )
  ).flat(),
);

const SNIPPETS: readonly {
  readonly name: string;
  readonly snippet: string;
  readonly text: string;
  readonly stops: readonly (readonly [number, number])[];
}[] = [
  {
    name: "escapes",
    snippet: String.raw`a\$b\}c\\d$1`,
    text: String.raw`a$b}c\d`,
    stops: [[7, 0]],
  },
  { name: "choices", snippet: "${1|one,two,three|} end", text: "one end", stops: [[0, 3]] },
  {
    name: "variables",
    snippet: "$TM_FILENAME x ${TM_SELECTED_TEXT:fallback} y ${UNKNOWN}",
    text: " x fallback y ",
    stops: [],
  },
  {
    name: "nested placeholders",
    snippet: "call(${1:first, ${2:second}})$0",
    text: "call(first, second)",
    stops: [
      [5, 13],
      [12, 6],
      [19, 0],
    ],
  },
  { name: "a surrogate pair counts two units", snippet: "😀${1:x}", text: "😀x", stops: [[2, 1]] },
];

describe("snippet grammar", () => {
  it.each(SNIPPETS)("expands $name", (entry) => {
    const expanded = expandSnippet(entry.snippet);

    expect({
      text: expanded.text,
      stops: expanded.stops.map((stop) => [stop.utf16Start, stop.utf16Length]),
    }).toEqual({ text: entry.text, stops: entry.stops });
  });
});

describe("document sync contract", () => {
  const folders: string[] = [];

  afterAll(async () => {
    for (const folder of folders) await rm(folder, { recursive: true, force: true });
  });

  it("reports a missing server as missing with its install command, and keeps sync rules", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-language-missing-")));
    folders.push(root);
    await writeFile(join(root, "go.mod"), "module example.com/missing\n\ngo 1.24\n");
    await writeFile(join(root, "main.go"), "package main\n");

    const language = localLanguage(localEnv(root), {
      trusted: async () => true,
      servers: { gopls: join(root, "no-such-gopls") },
    });

    const opened = await language.open({ path: "main.go", text: "package main\n", version: 1 });

    expect(opened.map((view) => view.state)).toEqual([
      { kind: "missing", hint: "Install gopls: go install golang.org/x/tools/gopls@latest" },
    ]);

    expect(await language.open({ path: "notes.txt", text: "", version: 1 })).toEqual([]);

    const refusals: readonly {
      readonly path: string;
      readonly version: number;
      readonly code: string;
    }[] = [
      { path: "other.go", version: 2, code: "unknown" },
      { path: "main.go", version: 1, code: "stale" },
      { path: "main.go", version: 0, code: "stale" },
    ];

    for (const refusal of refusals) {
      await expect(
        language.change({ path: refusal.path, version: refusal.version, changes: [] }),
      ).rejects.toMatchObject({ code: refusal.code });
    }

    expect(
      await language.hover({ path: "main.go", position: { line: 0, utf16Column: 0 } }),
    ).toBeNull();
    await language.shutdown();
  });
});

describe.each([GO, TYPESCRIPT].filter((fixture) => installed.has(fixture.server)))(
  "$server on $folder",
  (fixture) => {
    const root = join(FIXTURES, fixture.folder);
    let language: LanguageService;
    let before: readonly string[];
    const versions = new Map<string, number>();

    const nextVersion = (path: string): number => {
      const version = (versions.get(path) ?? 1) + 1;
      versions.set(path, version);

      return version;
    };

    beforeAll(async () => {
      const real = await realpath(root);
      language = localLanguage(localEnv(real), { trusted: async () => true });
      before = await Promise.all(fixture.files.map((file) => readFile(join(real, file), "utf8")));
    });

    afterAll(async () => {
      await language.shutdown();
      expect(await serverProcesses(fixture.server)).toEqual([]);
      expect(
        await Promise.all(fixture.files.map((file) => readFile(join(root, file), "utf8"))),
      ).toEqual(before);
    });

    it(
      "starts when a client opens a file and reports itself ready",
      { timeout: 90_000 },
      async () => {
        const opened = await Promise.all(
          fixture.files.map(async (file, index) =>
            language.open({ path: file, text: before[index] ?? "", version: 1 }),
          ),
        );

        expect(opened.map((views) => views.map((view) => view.server))).toEqual(
          fixture.files.map(() => [fixture.server]),
        );

        const ready = await until(language.watchStatus(), (views) =>
          views.some((view) => view.state.kind === "ready"),
        );

        const view = ready.find((entry) => entry.server === fixture.server);

        expect(view?.version).toMatch(/\d/);
        expect(view?.executable).toMatch(new RegExp(`${fixture.server}$`));
      },
    );

    it("publishes the fixture's diagnostics", { timeout: 60_000 }, async () => {
      const wanted = fixture.problems.map((problem) => ({ ...place(problem.at), ...problem }));

      await waitForDiagnostics((frames) =>
        wanted.every((problem) =>
          (frames.get(problem.path)?.diagnostics ?? []).some(
            (diagnostic) =>
              diagnostic.range.start.line === problem.position.line &&
              diagnostic.severity === problem.severity &&
              diagnostic.message.includes(problem.says),
          ),
        ),
      );
    });

    it("hovers with the signature", async () => {
      const at = place(fixture.hover.at);

      expect((await language.hover(at))?.markdown).toContain(fixture.hover.says);
    });

    it("completes members, resolves the chosen one, and cancels an older completion", async () => {
      const spec = fixture.completion;
      const line = { line: spec.after, utf16Column: 0 };
      await language.change({
        path: spec.file,
        version: nextVersion(spec.file),
        changes: [{ range: { start: line, end: line }, text: `${spec.text}\n` }],
      });

      try {
        const position = { line: spec.after, utf16Column: spec.text.length };

        const list = await language.completion({
          path: spec.file,
          position,
          trigger: { kind: "character", character: "." },
        });

        const labels = list.items.map((item) => item.label);

        expect(labels).toEqual(expect.arrayContaining([...spec.members]));
        const chosen = list.items.find((item) => item.label === spec.accept);
        const token = chosen?.resolve;

        expect(token).not.toBeNull();

        const resolved =
          token === undefined || token === null
            ? null
            : await language.resolveCompletion({ token });

        const replace = resolved?.insert.replace;

        const accepted =
          replace === null || replace === undefined
            ? `${spec.text}${resolved?.insert.text ?? ""}`
            : `${spec.text.slice(0, replace.start.utf16Column)}${resolved?.insert.text ?? ""}${spec.text.slice(replace.end.utf16Column)}`;

        expect({ accepted, stops: resolved?.insert.stops }).toEqual({
          accepted: spec.yields,
          stops: [],
        });
        const row = list.items.find((item) => item.label === fixture.row.label);

        expect({ tail: row?.tail, type: row?.type, invocation: row?.invocation }).toEqual({
          tail: fixture.row.tail,
          type: fixture.row.type,
          invocation: fixture.row.invocation,
        });

        const older = language.completion({
          path: spec.file,
          position,
          trigger: { kind: "invoked" },
        });

        const newer = language.completion({
          path: spec.file,
          position,
          trigger: { kind: "invoked" },
        });

        const counts = [(await older).items.length, (await newer).items.length];

        expect(counts[0]).toBe(0);
        expect(counts[1]).toBeGreaterThan(0);
        expect(
          token === undefined || token === null
            ? "missing"
            : await language.resolveCompletion({ token }),
        ).toBeNull();
      } finally {
        await language.change({
          path: spec.file,
          version: nextVersion(spec.file),
          changes: [
            { range: { start: line, end: { line: spec.after + 1, utf16Column: 0 } }, text: "" },
          ],
        });
      }
    });

    it.each(fixture.locations)("finds the $query", async (entry) => {
      const at = place(entry.at);

      const found =
        entry.query === "references"
          ? await language.references({ ...at, includeDeclaration: true })
          : await language[entry.query](at);

      expect(
        new Set(found.map((location) => `${location.path}:${location.range.start.line + 1}`)),
      ).toEqual(new Set(entry.goes));
    });

    it("lists document symbols in document order", async () => {
      const symbols = await language.symbols({ path: fixture.symbols.file });

      const rows = symbols.map((symbol) => ({
        name: symbol.name,
        kind: symbol.kind,
        depth: symbol.depth,
      }));

      expect(rows).toEqual(
        expect.arrayContaining(fixture.symbols.has.map((row) => expect.objectContaining(row))),
      );

      const ordered = symbols.every((symbol, index) => {
        const previous = symbols[index - 1];

        return (
          previous === undefined ||
          symbol.depth > previous.depth ||
          compare(previous.range.start, symbol.range.start) <= 0
        );
      });

      expect(ordered).toBe(true);
    });

    it("prepares a rename and computes its edits without writing them", async () => {
      const at = place(fixture.rename.at);

      expect((await language.prepareRename(at))?.placeholder).toBe(fixture.rename.placeholder);
      const outcome = await language.rename({ ...at, name: "Totals" });

      expect(
        outcome.kind === "edit"
          ? outcome.edit.files
              .filter((file) => file.edits.length > 0)
              .map((file) => file.path)
              .toSorted()
          : outcome,
      ).toEqual([...fixture.rename.files].toSorted());
    });

    it("shows the signature with its active parameter", async () => {
      const help = await language.signatureHelp(place(fixture.signature.at));
      const signature = help?.signatures[help.activeSignature];
      const parameter = signature?.parameters[help?.activeParameter ?? -1];

      expect(signature?.label).toContain(fixture.signature.says);
      expect(signature?.label.slice(parameter?.utf16Start, parameter?.utf16End)).toBe(
        fixture.signature.parameter,
      );
    });

    it("lists inlay hints in order and in range", async () => {
      const text = await readFile(join(root, fixture.annotated), "utf8");
      const lines = text.split("\n");

      const hints = await language.inlayHints({
        path: fixture.annotated,
        range: { start: { line: 0, utf16Column: 0 }, end: { line: lines.length, utf16Column: 0 } },
      });

      expect(hints.length).toBeGreaterThan(0);
      expect(
        hints.every(
          (hint, index) =>
            hint.label !== "" &&
            hint.position.utf16Column <= (lines[hint.position.line]?.length ?? -1) &&
            (index === 0 ||
              compare(hints[index - 1]?.position ?? hint.position, hint.position) <= 0),
        ),
      ).toBe(true);
    });

    it("formats a misindented line", async () => {
      const spec = fixture.misindent;
      const line = spec.line - 1;
      await language.change({
        path: spec.file,
        version: nextVersion(spec.file),
        changes: [
          {
            range: {
              start: { line, utf16Column: 0 },
              end: { line, utf16Column: spec.indent.length },
            },
            text: spec.bad,
          },
        ],
      });

      const formatted = await language.format({
        path: spec.file,
        options: { tabSize: 2, insertSpaces: false },
      });

      expect(
        formatted.kind === "edits" &&
          formatted.edits.some(
            (edit) => edit.range.start.line <= line && line <= edit.range.end.line,
          ),
      ).toBe(true);
      await language.change({
        path: spec.file,
        version: nextVersion(spec.file),
        changes: [
          {
            range: { start: { line, utf16Column: 0 }, end: { line, utf16Column: spec.bad.length } },
            text: spec.indent,
          },
        ],
      });
    });

    it(
      "follows an incremental change that breaks a line and its revert",
      { timeout: 60_000 },
      async () => {
        const spec = fixture.breaking;
        const path = spec.file;
        const start = { line: spec.after, utf16Column: 0 };

        const broken = (frames: ReadonlyMap<string, DiagnosticsFrame>) =>
          (frames.get(path)?.diagnostics ?? []).some(
            (diagnostic) =>
              diagnostic.severity === "error" && diagnostic.range.start.line === spec.after,
          );

        await language.change({
          path,
          version: nextVersion(path),
          changes: [{ range: { start, end: start }, text: `${spec.text}\n` }],
        });
        await waitForDiagnostics(broken);
        await language.change({
          path,
          version: nextVersion(path),
          changes: [{ range: { start, end: { line: spec.after + 1, utf16Column: 0 } }, text: "" }],
        });
        await waitForDiagnostics((frames) => !broken(frames));
      },
    );

    it("offers the fixture's code action and resolves it to an edit, once", async () => {
      const at = place(fixture.action.at);

      const actions = await language.codeActions({
        path: at.path,
        range: { start: at.position, end: at.position },
      });

      const chosen = actions.find((action) => action.title.includes(fixture.action.title));

      expect(chosen?.title).toContain(fixture.action.title);

      const outcome =
        chosen === undefined ? null : await language.resolveCodeAction({ token: chosen.token });

      expect(
        outcome?.kind === "edit" &&
          outcome.edit.files.some((file) => file.path === at.path && file.edits.length > 0),
      ).toBe(true);
      await language.codeActions({
        path: at.path,
        range: { start: at.position, end: at.position },
      });

      expect(
        chosen === undefined ? null : await language.resolveCodeAction({ token: chosen.token }),
      ).toEqual({ kind: "stale" });
    });

    it("restarts a server killed with SIGKILL and answers again", { timeout: 90_000 }, async () => {
      const killed = (await serverProcesses(fixture.server))[0];
      const status = language.watchStatus()[Symbol.asyncIterator]();
      await status.next();

      expect(killed).toBeDefined();
      process.kill(killed ?? 0, "SIGKILL");

      for (;;) {
        const next = await status.next();

        if (next.done === true) throw new Error("The status stream ended.");

        if (
          next.value.some((view) => view.state.kind === "ready") &&
          (await serverProcesses(fixture.server)).some((pid) => pid !== killed)
        ) {
          break;
        }
      }

      await status.return?.();

      expect((await language.hover(place(fixture.hover.at)))?.markdown).toContain(
        fixture.hover.says,
      );
    });

    it(
      `gives up after ${RESTART_LIMIT.restarts + 1} deaths in the window and answers empty`,
      { timeout: 120_000 },
      async () => {
        for (;;) {
          const views = await until(language.watchStatus(), (entries) =>
            entries.some((view) => view.state.kind === "ready" || view.state.kind === "failed"),
          );

          if (views.some((view) => view.state.kind === "failed")) break;
          const server = (await serverProcesses(fixture.server))[0];
          process.kill(server ?? 0, "SIGKILL");
          await until(language.watchStatus(), (entries) =>
            entries.every((view) => view.state.kind !== "ready"),
          );
        }

        expect(await language.hover(place(fixture.hover.at))).toBeNull();
      },
    );

    function place(text: string): { readonly path: string; readonly position: TextPosition } {
      const parts = text.split(":");

      return {
        path: parts[0] ?? "",
        position: { line: Number(parts[1] ?? 1) - 1, utf16Column: Number(parts[2] ?? 1) - 1 },
      };
    }

    async function waitForDiagnostics(
      accept: (frames: ReadonlyMap<string, DiagnosticsFrame>) => boolean,
    ): Promise<void> {
      const known = new Map<string, DiagnosticsFrame>();

      await until(language.diagnostics(), (frames) => {
        for (const frame of frames) known.set(frame.path, frame);

        return accept(known);
      });
    }
  },
);

describe("the LSP client against a scripted server", () => {
  let root: string;
  let language: LanguageService;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "nyte-language-scripted-")));
    const server = join(root, "scripted-server");
    await cp(join(FIXTURES, "scripted-server.cjs"), server);
    await chmod(server, 0o755);
    await writeFile(join(root, "go.mod"), "module example.com/scripted\n\ngo 1.24\n");
    await writeFile(join(root, "main.go"), "package main\n\nfunc main() {}\n");
    language = localLanguage(localEnv(root), {
      trusted: async () => true,
      servers: { gopls: server },
    });
    await language.open({ path: "main.go", text: "package main\n\nfunc main() {}\n", version: 1 });
  });

  afterAll(async () => {
    await language.shutdown();
    await rm(root, { recursive: true, force: true });
  });

  const heard = (says: string) =>
    until(language.diagnostics(), (frames) =>
      frames.some(
        (frame) =>
          frame.path === "probe.go" &&
          frame.diagnostics.some((diagnostic) => diagnostic.message.startsWith(says)),
      ),
    ).then(
      (frames) =>
        frames
          .flatMap((frame) => (frame.path === "probe.go" ? frame.diagnostics : []))
          .find((diagnostic) => diagnostic.message.startsWith(says))?.message ?? "",
    );

  const CONTRACTS: readonly { readonly name: string; check(): Promise<void> }[] = [
    {
      name: "a $/progress begin shows as busy with its title and percent",
      async check() {
        const views = await until(language.watchStatus(), (entries) =>
          entries.some((view) => view.state.kind === "busy"),
        );

        expect(views[0]?.state).toEqual({ kind: "busy", title: "Indexing", percent: 40 });
      },
    },
    {
      name: "a workspace/applyEdit outside a code action is answered as not applied",
      async check() {
        expect(JSON.parse((await heard("applyEdit ")).slice("applyEdit ".length))).toMatchObject({
          applied: false,
        });
      },
    },
    {
      name: "a code action request carries the overlapping diagnostics with their codes",
      async check() {
        await until(language.diagnostics(), (frames) =>
          frames.some((frame) => frame.path === "main.go" && frame.diagnostics.length === 2),
        );
        await language.codeActions({
          path: "main.go",
          range: { start: { line: 2, utf16Column: 0 }, end: { line: 2, utf16Column: 14 } },
        });
        const context = JSON.parse((await heard("codeAction ")).slice("codeAction ".length));

        expect(context).toMatchObject({
          diagnostics: [{ message: "main is lonely", code: "probe" }],
        });
        expect(context.only).toBeUndefined();
      },
    },
    {
      name: "a newer completion sends $/cancelRequest for the older one in flight",
      async check() {
        const older = language.completion({
          path: "main.go",
          position: { line: 0, utf16Column: 0 },
          trigger: { kind: "invoked" },
        });

        await heard("completion pending");

        const newer = await language.completion({
          path: "main.go",
          position: { line: 1, utf16Column: 0 },
          trigger: { kind: "invoked" },
        });

        expect((await older).items).toEqual([]);
        expect(newer.items.map((item) => item.label)).toEqual(["answered"]);
        expect(await heard("cancel ")).toMatch(/^cancel \d+$/);
      },
    },
    {
      name: "a rename that would create a file is refused, not returned",
      async check() {
        const outcome = await language.rename({
          path: "main.go",
          position: { line: 2, utf16Column: 6 },
          name: "start",
        });

        expect(outcome).toEqual({
          kind: "refused",
          reason: "This change would create a file, which a returned edit cannot do yet.",
        });
      },
    },
  ];

  it.each(CONTRACTS)("$name", (contract) => contract.check());
});

describe("folder trust", () => {
  it("runs a server process only while the folder is trusted", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-language-trust-")));
    const server = join(root, "scripted-server");
    await cp(join(FIXTURES, "scripted-server.cjs"), server);
    await chmod(server, 0o755);
    await writeFile(join(root, "main.go"), "package main\n");
    let trusted = false;

    const language = localLanguage(localEnv(root), {
      trusted: async () => trusted,
      servers: { gopls: server },
    });

    try {
      const opened = await language.open({ path: "main.go", text: "package main\n", version: 1 });
      await language.hover({ path: "main.go", position: { line: 0, utf16Column: 0 } });
      await language.change({ path: "main.go", version: 2, changes: [] });

      expect(opened.map((view) => view.state)).toEqual([{ kind: "untrusted" }]);
      expect((await language.status()).map((view) => view.state)).toEqual([{ kind: "untrusted" }]);
      expect(await serverProcesses(server)).toEqual([]);

      trusted = true;
      await language.trustChanged(true);
      await until(language.watchStatus(), (views) => views[0]?.state.kind === "busy");

      expect(await serverProcesses(server)).toHaveLength(1);

      trusted = false;
      await language.trustChanged(false);

      expect((await language.status()).map((view) => view.state)).toEqual([{ kind: "untrusted" }]);
      expect(await serverProcesses(server)).toEqual([]);
    } finally {
      await language.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("an unused server", () => {
  it("shuts down after the idle time and starts again on the next request", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-language-idle-")));
    const server = join(root, "scripted-server");
    await cp(join(FIXTURES, "scripted-server.cjs"), server);
    await chmod(server, 0o755);
    await writeFile(join(root, "main.go"), "package main\n");

    const language = localLanguage(localEnv(root), {
      trusted: async () => true,
      servers: { gopls: server },
    });

    try {
      await language.open({ path: "main.go", text: "package main\n", version: 1 });
      await until(language.watchStatus(), (views) => views[0]?.state.kind === "busy");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await language.close({ path: "main.go" });
      vi.advanceTimersByTime(IDLE_MS);
      vi.useRealTimers();

      expect((await language.status())[0]?.state).toEqual({ kind: "idle" });
      await language.hover({ path: "main.go", position: { line: 0, utf16Column: 0 } });
      await until(language.watchStatus(), (views) => views[0]?.state.kind === "busy");
    } finally {
      vi.useRealTimers();
      await language.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!installed.has("gopls"))("gopls and files changed on disk", () => {
  it(
    "brings an error into an open file when another file changes on disk",
    { timeout: 90_000 },
    async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-language-disk-")));
      await cp(join(FIXTURES, "notifyhub-go"), root, { recursive: true });
      const language = localLanguage(localEnv(root), { trusted: async () => true });

      try {
        const main = await readFile(join(root, "main.go"), "utf8");
        await language.open({ path: "main.go", text: main, version: 1 });
        await until(language.watchStatus(), (views) =>
          views.some((view) => view.state.kind === "ready"),
        );
        const stats = join(root, "hub", "stats.go");
        await writeFile(
          stats,
          (await readFile(stats, "utf8")).replace(
            "func (s Stats) Names()",
            "func (s Stats) Labels()",
          ),
        );

        await until(language.diagnostics(), (frames) =>
          frames.some(
            (frame) =>
              frame.path === "main.go" &&
              frame.diagnostics.some(
                (diagnostic) =>
                  diagnostic.severity === "error" && diagnostic.range.start.line === 33,
              ),
          ),
        );
      } finally {
        await language.shutdown();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

function compare(left: TextPosition, right: TextPosition): number {
  return left.line === right.line ? left.utf16Column - right.utf16Column : left.line - right.line;
}
