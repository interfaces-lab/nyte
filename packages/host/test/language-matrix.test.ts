import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { compile, LanguageFeatureType, LanguageNameType } from "@nyte-ai/schema";
import type { LanguageFeature, TextPosition } from "@nyte-ai/schema";
import type { LanguageService } from "@nyte-ai/core";
import { Type } from "typebox";
import type { Static } from "typebox";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { languageInstaller } from "../src/local/language/install.ts";
import type { Installer } from "../src/local/language/install.ts";
import { localLanguage } from "../src/local/language/manager.ts";
import { SERVERS } from "../src/local/language/servers.ts";
import { localEnv, until } from "./language-harness.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "language");

const ROWS = [...LanguageFeatureType.enum, "diagnostics"] as const;

type Row = LanguageFeature | "diagnostics";

const ProbeType = Type.Object({
  file: Type.String(),
  after: Type.Optional(Type.String()),
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
    unproven: Type.Optional(Type.String()),
    packages: Type.Optional(
      Type.Object({ lock: Type.String(), bins: Type.Record(Type.String(), Type.String()) }),
    ),
    features: Type.Object(Object.fromEntries(ROWS.map((row) => [row, RowType] as const))),
  }),
);

const Lock = compile(
  Type.Array(
    Type.Object({
      path: Type.String(),
      url: Type.String(),
      integrity: Type.String(),
      os: Type.Optional(Type.Array(Type.String())),
      cpu: Type.Optional(Type.Array(Type.String())),
    }),
  ),
);

const downloads = process.env.NYTE_LANGUAGE_DOWNLOADS === "1";

const fixtures = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    const root = join(FIXTURES, entry.name);

    try {
      return [{ folder: entry.name, root, text: readFileSync(join(root, "matrix.json"), "utf8") }];
    } catch {
      return [];
    }
  })
  .map((found) => {
    const matrix: unknown = JSON.parse(found.text);

    if (!Matrix.Check(matrix)) throw new Error(`${found.folder}/matrix.json is not a matrix.`);

    return { folder: found.folder, root: found.root, matrix };
  });

describe("every matrix", () => {
  it.each(fixtures)("$folder names known servers and probes text its files hold", (fixture) => {
    const known = new Set(SERVERS.map((server) => server.name));

    const probes = Object.values(fixture.matrix.features).flatMap((row) => row.probes);

    expect({
      unknown: fixture.matrix.servers.filter((name) => !known.has(name)),
      missing: probes.flatMap((probe) =>
        readFileSync(join(fixture.root, probe.file), "utf8").includes(probe.after ?? "")
          ? []
          : [`${probe.file}: ${probe.after}`],
      ),
    }).toEqual({ unknown: [], missing: [] });
  });
});

const proven = fixtures.filter((fixture) => fixture.matrix.unproven === undefined);

describe.each(downloads ? proven : [])("matrix: $folder", (fixture) => {
  const matrix = fixture.matrix;
  let root: string;
  let scratch: string;
  let language: LanguageService;

  const rows = LanguageFeatureType.enum
    .map((feature) => ({ feature, ...matrix.features[feature] }))
    .toSorted((left, right) => Number(right.answers) - Number(left.answers));

  beforeAll(async () => {
    scratch = await realpath(await mkdtemp(join(tmpdir(), "nyte-matrix-")));
    const installer = languageInstaller(join(homedir(), ".nyte", "language-servers"));

    root =
      matrix.packages === undefined
        ? await realpath(fixture.root)
        : await copyWithPackages(fixture, matrix.packages, installer, join(scratch, "project"));

    const pinned = await Promise.all(
      SERVERS.flatMap((spec) =>
        spec.install !== null && matrix.servers.includes(spec.name)
          ? [
              installer
                .install(spec.install, () => undefined)
                .then(async (installed) => {
                  const exports = Object.entries(installed.env);

                  if (installed.kind === "binary" && exports.length === 0) {
                    return [spec.name, installed.path] as const;
                  }

                  const launcher = join(scratch, spec.name);

                  await writeLauncher(
                    launcher,
                    installed.kind === "binary"
                      ? [installed.path]
                      : [process.execPath, installed.path],
                    exports,
                  );

                  return [spec.name, launcher] as const;
                }),
            ]
          : [],
      ),
    );

    language = localLanguage(localEnv(root), {
      trusted: async () => true,
      servers: Object.fromEntries(pinned),
      installer,
    });

    const first = Object.values(matrix.features).flatMap((row) => row.probes)[0];

    if (first === undefined) throw new Error("The matrix has no probe.");
    await language.symbols({ path: first.file });

    const views = await until(language.watchStatus(), (seen) =>
      matrix.servers.every((name) =>
        seen.some(
          (view) =>
            view.server === name &&
            view.state.kind !== "idle" &&
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
  }, 600_000);

  afterAll(async () => {
    await language.shutdown();
    await rm(scratch, { recursive: true, force: true });
  });

  const locate = async (probe: Probe): Promise<TextPosition> => {
    const text = await readFile(join(root, probe.file), "utf8");
    const anchor = probe.after ?? "";
    const found = text.indexOf(anchor);

    if (found < 0) throw new Error(`${probe.file} does not hold "${anchor}".`);
    const before = text.slice(0, found + anchor.length).split("\n");

    return { line: before.length - 1, utf16Column: before.at(-1)?.length ?? 0 };
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
    definition: async (probe) =>
      language.definition({ path: probe.file, position: await locate(probe) }),
    typeDefinition: async (probe) =>
      language.typeDefinition({ path: probe.file, position: await locate(probe) }),
    references: async (probe) =>
      language.references({
        path: probe.file,
        position: await locate(probe),
        includeDeclaration: true,
      }),
    async symbols(probe) {
      return (await language.symbols({ path: probe.file })).map((symbol) => symbol.name);
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

      return outcome.kind === "edits" ? [outcome.kind, ...outcome.edits] : [];
    },
    async formatRange(probe) {
      const line = (await locate(probe)).line;

      const outcome = await language.format({
        path: probe.file,
        options: { tabSize: 2, insertSpaces: true },
        range: { start: { line, utf16Column: 0 }, end: { line: line + 1, utf16Column: 0 } },
      });

      return outcome.kind === "edits" ? [outcome.kind, ...outcome.edits] : [];
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

async function writeLauncher(
  path: string,
  command: readonly string[],
  exports: readonly (readonly [string, string])[],
): Promise<void> {
  await writeFile(
    path,
    [
      "#!/bin/sh",
      ...exports.map((entry) => `export ${entry[0]}=${JSON.stringify(entry[1])}`),
      `exec ${command.map((part) => JSON.stringify(part)).join(" ")} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

async function copyWithPackages(
  fixture: { readonly folder: string; readonly root: string },
  packages: { readonly lock: string; readonly bins: Readonly<Record<string, string>> },
  installer: Installer,
  copy: string,
): Promise<string> {
  const text = await readFile(join(fixture.root, packages.lock), "utf8");
  const lock: unknown = JSON.parse(text);

  if (!Lock.Check(lock)) throw new Error(`${fixture.folder}/${packages.lock} is not a lock.`);

  const installed = await installer.install(
    {
      kind: "npm",
      package: `fixture-${fixture.folder}`,
      version: createHash("sha256").update(text).digest("hex").slice(0, 12),
      packages: lock,
      entry: "node_modules",
    },
    () => undefined,
  );

  await cp(fixture.root, copy, { recursive: true });
  await mkdir(join(copy, "node_modules", ".bin"), { recursive: true });

  await Promise.all([
    ...(await readdir(installed.path)).map((name) =>
      symlink(join(installed.path, name), join(copy, "node_modules", name)),
    ),
    ...Object.entries(packages.bins).map((entry) =>
      writeLauncher(
        join(copy, "node_modules", ".bin", entry[0]),
        [process.execPath, join(installed.path, entry[1])],
        [],
      ),
    ),
  ]);

  return copy;
}
