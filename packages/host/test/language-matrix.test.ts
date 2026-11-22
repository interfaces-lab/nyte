import { readdirSync, readFileSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { compile, LanguageFeatureType, LanguageNameType } from "@nyte-ai/schema";
import type { LanguageFeature, TextPosition } from "@nyte-ai/schema";
import type { LanguageService } from "@nyte-ai/core";
import { Type } from "typebox";
import type { Static } from "typebox";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { languageInstaller } from "../src/local/language/install.ts";
import { localLanguage } from "../src/local/language/manager.ts";
import { SERVERS } from "../src/local/language/servers.ts";
import { findExecutable, projectBins, run } from "../src/local/process/command.ts";
import { localEnv, until } from "./language-harness.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "language");

const ROWS = [...LanguageFeatureType.enum, "diagnostics"] as const;

type Row = LanguageFeature | "diagnostics";

const ProbeType = Type.Object({
  file: Type.String(),
  after: Type.Optional(Type.String()),
  query: Type.Optional(Type.String()),
  says: Type.Optional(Type.String()),
});

type Probe = Static<typeof ProbeType>;

const RowType = Type.Object({
  probes: Type.Array(ProbeType, { minItems: 1 }),
  servers: Type.Array(Type.String()),
  answers: Type.Boolean(),
  vscode: Type.Boolean(),
  note: Type.Optional(Type.String()),
});

const Matrix = compile(
  Type.Object({
    language: LanguageNameType,
    servers: Type.Array(Type.String()),
    vscode: Type.Object({ extension: Type.String(), source: Type.String() }),
    features: Type.Object(Object.fromEntries(ROWS.map((row) => [row, RowType] as const))),
  }),
);

const downloads = process.env.NYTE_LANGUAGE_DOWNLOADS === "1";

const fixtures = await Promise.all(
  readdirSync(FIXTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const root = join(FIXTURES, entry.name);

      try {
        return [
          { folder: entry.name, root, text: readFileSync(join(root, "matrix.json"), "utf8") },
        ];
      } catch {
        return [];
      }
    })
    .map(async (found) => {
      const matrix: unknown = JSON.parse(found.text);

      if (!Matrix.Check(matrix)) throw new Error(`${found.folder}/matrix.json is not a matrix.`);

      const local = await Promise.all(
        matrix.servers.map(async (name) => {
          const spec = SERVERS.find((server) => server.name === name);

          if (spec === undefined) throw new Error(`${found.folder} names no known server: ${name}`);

          const program = await findExecutable(spec.program, projectBins(found.root));

          return (
            program !== null &&
            (spec.probe === null ||
              (await run(program, spec.probe, { cwd: found.root }).catch(() => null))?.code === 0)
          );
        }),
      );

      return { ...found, matrix, runnable: downloads || local.every(Boolean) };
    }),
);

describe.each(fixtures.filter((fixture) => fixture.runnable))("matrix: $folder", (fixture) => {
  const matrix = fixture.matrix;
  let root: string;
  let language: LanguageService;

  const rows = LanguageFeatureType.enum
    .map((feature) => ({ feature, ...matrix.features[feature] }))
    .toSorted((left, right) => Number(right.answers) - Number(left.answers));

  beforeAll(async () => {
    root = await realpath(fixture.root);
    language = localLanguage(localEnv(root), {
      trusted: async () => true,
      installer: downloads
        ? languageInstaller(join(homedir(), ".nyte", "language-servers"))
        : undefined,
    });
  });

  afterAll(async () => {
    await language.shutdown();
  });

  const locate = async (probe: Probe): Promise<TextPosition> => {
    const text = await readFile(join(root, probe.file), "utf8");
    const anchor = probe.after ?? "";
    const found = text.indexOf(anchor);

    if (found < 0) throw new Error(`${probe.file} does not hold "${anchor}".`);
    const before = text.slice(0, found + anchor.length).split("\n");

    return { line: before.length - 1, utf16Column: before.at(-1)?.length ?? 0 };
  };

  const whole = async (probe: Probe) => {
    const lines = (await readFile(join(root, probe.file), "utf8")).split("\n");

    return {
      start: { line: 0, utf16Column: 0 },
      end: { line: lines.length - 1, utf16Column: lines.at(-1)?.length ?? 0 },
    };
  };

  const ask: Record<Row, (probe: Probe) => Promise<readonly unknown[]>> = {
    async diagnostics(probe) {
      await language.symbols({ path: probe.file });

      const frames = await until(language.diagnostics(), (seen) =>
        seen.some(
          (frame) =>
            frame.path === probe.file &&
            frame.diagnostics.some((entry) => entry.message.includes(probe.says ?? "")),
        ),
      );

      return frames.flatMap((frame) => (frame.path === probe.file ? frame.diagnostics : []));
    },
    async completion(probe) {
      const list = await language.completion({
        path: probe.file,
        position: await locate(probe),
        trigger: { kind: "invoked" },
      });

      return list.items.map((item) => item.label);
    },
    async hover(probe) {
      const hover = await language.hover({ path: probe.file, position: await locate(probe) });

      return hover === null ? [] : [hover.markdown];
    },
    async signatureHelp(probe) {
      const help = await language.signatureHelp({
        path: probe.file,
        position: await locate(probe),
      });

      return help?.signatures.map((signature) => signature.label) ?? [];
    },
    definition: async (probe) =>
      language.definition({ path: probe.file, position: await locate(probe) }),
    typeDefinition: async (probe) =>
      language.typeDefinition({ path: probe.file, position: await locate(probe) }),
    implementation: async (probe) =>
      language.implementation({ path: probe.file, position: await locate(probe) }),
    declaration: async (probe) =>
      language.declaration({ path: probe.file, position: await locate(probe) }),
    references: async (probe) =>
      language.references({
        path: probe.file,
        position: await locate(probe),
        includeDeclaration: true,
      }),
    documentHighlights: async (probe) =>
      language.documentHighlights({ path: probe.file, position: await locate(probe) }),
    async symbols(probe) {
      return (await language.symbols({ path: probe.file })).map((symbol) => symbol.name);
    },
    async workspaceSymbols(probe) {
      const found = await language.workspaceSymbols({ query: probe.query ?? "" });

      return found.map((symbol) => symbol.name);
    },
    async codeActions(probe) {
      const position = await locate(probe);

      const actions = await language.codeActions({
        path: probe.file,
        range: { start: position, end: position },
      });

      return actions.map((action) => action.title);
    },
    async format(probe) {
      const outcome = await language.format({
        path: probe.file,
        options: { tabSize: 2, insertSpaces: true },
      });

      return outcome.kind === "edits" ? [outcome.kind] : [];
    },
    async formatRange(probe) {
      const line = (await locate(probe)).line;

      const outcome = await language.format({
        path: probe.file,
        options: { tabSize: 2, insertSpaces: true },
        range: { start: { line, utf16Column: 0 }, end: { line: line + 1, utf16Column: 0 } },
      });

      return outcome.kind === "edits" ? [outcome.kind] : [];
    },
    async renameFiles(probe) {
      const outcome = await language.renameFiles({
        files: [
          { from: probe.file, to: join(dirname(probe.file), `moved-${basename(probe.file)}`) },
        ],
      });

      return outcome.kind === "edit"
        ? outcome.edit.files.filter((file) => file.edits.length > 0).map((file) => file.path)
        : [];
    },
    documentLinks: (probe) => language.documentLinks({ path: probe.file }),
    async documentColors(probe) {
      const colors = await language.documentColors({ path: probe.file });
      const first = colors[0];

      return first === undefined
        ? []
        : [...colors, ...(await language.colorPresentations({ path: probe.file, ...first }))];
    },
    async linkedEditingRanges(probe) {
      const linked = await language.linkedEditingRanges({
        path: probe.file,
        position: await locate(probe),
      });

      return linked?.ranges ?? [];
    },
    async rename(probe) {
      const outcome = await language.rename({
        path: probe.file,
        position: await locate(probe),
        name: "renamedByMatrix",
      });

      return outcome.kind === "edit"
        ? outcome.edit.files.filter((file) => file.edits.length > 0).map((file) => file.path)
        : [];
    },
    foldingRanges: (probe) => language.foldingRanges({ path: probe.file }),
    async selectionRanges(probe) {
      const lists = await language.selectionRanges({
        path: probe.file,
        positions: [await locate(probe)],
      });

      return lists[0] ?? [];
    },
    async semanticTokens(probe) {
      const tokens = await language.semanticTokens({ path: probe.file });

      return tokens === null || tokens.data.length === 0 ? [] : tokens.types;
    },
    async inlayHints(probe) {
      const hints = await language.inlayHints({ path: probe.file, range: await whole(probe) });

      return hints.map((hint) => hint.label);
    },
    async callHierarchy(probe) {
      const roots = await language.callHierarchy({
        path: probe.file,
        position: await locate(probe),
      });

      const calls = await Promise.all(
        roots.flatMap((item) => [
          language.incomingCalls({ token: item.token }),
          language.outgoingCalls({ token: item.token }),
        ]),
      );

      return calls.flat().length === 0
        ? []
        : [...roots, ...calls.flat()].map((entry) =>
            "item" in entry ? entry.item.name : entry.name,
          );
    },
    async typeHierarchy(probe) {
      const roots = await language.typeHierarchy({
        path: probe.file,
        position: await locate(probe),
      });

      const related = await Promise.all(
        roots.flatMap((item) => [
          language.supertypes({ token: item.token }),
          language.subtypes({ token: item.token }),
        ]),
      );

      return related.flat().length === 0
        ? []
        : [...roots, ...related.flat()].map((item) => item.name);
    },
  };

  const answered = async (feature: Row, probes: readonly Probe[]): Promise<boolean> => {
    for (const probe of probes) {
      const evidence = await ask[feature](probe);

      if (evidence.length === 0 || !JSON.stringify(evidence).includes(probe.says ?? "")) {
        return false;
      }
    }

    return true;
  };

  it("starts every server the fixture names", { timeout: 600_000 }, async () => {
    const first = Object.values(matrix.features).flatMap((row) => row.probes)[0];

    if (first === undefined) throw new Error("The matrix has no probe.");
    await language.symbols({ path: first.file });

    const views = await until(language.watchStatus(), (seen) =>
      matrix.servers.every((name) =>
        seen.some(
          (view) =>
            view.server === name &&
            view.state.kind !== "starting" &&
            view.state.kind !== "installing",
        ),
      ),
    );

    expect(
      Object.fromEntries(
        views.map((view) => [
          view.server,
          view.state.kind === "busy" || view.state.kind === "ready" ? "ready" : view.state,
        ]),
      ),
    ).toEqual(Object.fromEntries(matrix.servers.map((server) => [server, "ready"])));
  });

  it.each(rows)("$feature", { timeout: 120_000 }, async (row) => {
    if (row.answers) {
      await vi.waitFor(async () => expect(await answered(row.feature, row.probes)).toBe(true), {
        timeout: 100_000,
        interval: 250,
      });
    }

    const offering = (await language.status())
      .filter((view) => view.features.some((feature) => feature === row.feature))
      .map((view) => view.server)
      .toSorted();

    expect({ servers: offering, answers: await answered(row.feature, row.probes) }).toEqual({
      servers: row.servers.toSorted(),
      answers: row.answers,
    });
  });

  it("diagnostics", { timeout: 120_000 }, async () => {
    const row = matrix.features.diagnostics;

    expect(matrix.servers).toEqual(expect.arrayContaining(row.servers));

    if (row.answers) {
      expect(await answered("diagnostics", row.probes)).toBe(true);

      return;
    }

    await Promise.all(row.probes.map((probe) => language.symbols({ path: probe.file })));
    const known = await until(language.diagnostics(), () => true);

    expect(
      known.filter(
        (frame) =>
          frame.diagnostics.length > 0 && row.probes.some((probe) => probe.file === frame.path),
      ),
    ).toEqual([]);
  });
});
