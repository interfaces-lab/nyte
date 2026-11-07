import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format } from "oxfmt";

const editor = new URL("../packages/app/src/workbench/editor/", import.meta.url);

const directory = new URL("grammars/", editor);

const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));

const refresh = process.argv.includes("--refresh");

const write = refresh || process.argv.includes("--write");

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (refresh) await refreshAssets();

const aliases = new Set();

for (const grammar of manifest.grammars) {
  assert.match(grammar.language, /^[a-z]+$/u);
  const wasm = await readFile(new URL(`${grammar.language}.wasm`, directory));
  assert.equal(digest(wasm), grammar.sha256, `${grammar.language}: grammar hash`);
  assert.equal(wasm.length, grammar.bytes, `${grammar.language}: grammar length`);
  await readFile(new URL(grammar.foldQuery, directory));

  if (grammar.symbolQuery !== null) await readFile(new URL(grammar.symbolQuery, directory));

  for (const alias of grammar.aliases) {
    assert.equal(aliases.has(alias), false, `Duplicate grammar alias: ${alias}`);
    aliases.add(alias);
  }
}

for (const license of manifest.licenses)
  assert.equal(
    digest(await readFile(new URL(`licenses/${license.file}`, directory))),
    license.sha256,
    `${license.file}: license hash`,
  );

assert.equal(
  digest(
    await readFile(
      new URL("../packages/app/node_modules/web-tree-sitter/tree-sitter.wasm", import.meta.url),
    ),
  ),
  manifest.runtime.wasmSha256,
  "Tree-sitter runtime hash",
);

const profiles = `export const STRUCTURE_PROFILES = ${JSON.stringify(
  manifest.grammars.map((grammar) => ({ language: grammar.language, aliases: grammar.aliases })),
  null,
  2,
)} as const;

export type StructureLanguage = (typeof STRUCTURE_PROFILES)[number]["language"];

export function structureLanguage(language: string): StructureLanguage | undefined {
  return STRUCTURE_PROFILES.find(profile => profile.aliases.some(alias => alias === language))?.language;
}
`;

const queries = [
  ...new Set(
    manifest.grammars.flatMap((grammar) => [
      grammar.foldQuery,
      ...(grammar.symbolQuery === null ? [] : [grammar.symbolQuery]),
    ]),
  ),
];

const variable = (file) => file.replace(/\.scm$/u, "").replace(/-symbols$/u, "Symbols");

const imports = [
  'import type { StructureLanguage } from "./file-structure-profiles.ts";',
  'import runtimeUrl from "web-tree-sitter/tree-sitter.wasm?url&no-inline";',
  ...manifest.grammars.map(
    (grammar) =>
      `import ${grammar.language}Wasm from "./grammars/${grammar.language}.wasm?url&no-inline";`,
  ),
  ...queries.map(
    (query) => `import ${variable(query)}Query from "./grammars/${query}?url&no-inline";`,
  ),
];

const assets = `${imports.join("\n")}

export { runtimeUrl };

export const fileStructureAssets = {
${manifest.grammars.map((grammar) => `  ${grammar.language}: { wasm: ${grammar.language}Wasm, folds: ${variable(grammar.foldQuery)}Query, symbols: ${grammar.symbolQuery === null ? "undefined" : variable(grammar.symbolQuery) + "Query"} },`).join("\n")}
} satisfies Record<StructureLanguage, { readonly wasm: string; readonly folds: string; readonly symbols: string | undefined }>;
`;

const notice = [
  "File structure parser and grammars",
  "",
  `${manifest.runtime.package}@${manifest.runtime.version} (MIT): licenses/${manifest.runtime.licenseFile}`,
  ...manifest.grammars.map(
    (grammar) =>
      `${grammar.language}: ${grammar.package}@${grammar.version} (${grammar.license})\n  ${grammar.archive}\n  licenses/${grammar.licenseFile}`,
  ),
  "",
  `Markdown grammar upstream: ${manifest.markdownProvenance.sourceVersion}`,
  manifest.markdownProvenance.source,
  `Distributed by ${manifest.markdownProvenance.distributor}, git ${manifest.markdownProvenance.gitHead}`,
  "Upstream MIT license: licenses/tree-sitter-markdown-v0.5.1.txt",
  "",
].join("\n");

for (const entry of [
  { file: "file-structure-profiles.ts", source: profiles, root: editor },
  { file: "file-structure-assets.ts", source: assets, root: editor },
  { file: "NOTICE.txt", source: notice, root: directory },
]) {
  const path = new URL(entry.file, entry.root);

  const formatted = entry.file.endsWith(".ts")
    ? await format(entry.file, entry.source, {})
    : { code: entry.source, errors: [] };

  assert.equal(formatted.errors.length, 0, entry.file);

  if (write) await writeFile(path, formatted.code);
  else
    assert.equal(
      await readFile(path, "utf8"),
      formatted.code,
      `${entry.file}: run node scripts/editor-grammars.mjs --write`,
    );
}

console.log(
  `${manifest.grammars.length} grammars, ${queries.length} queries and ${manifest.licenses.length} licenses verified; registry ${write ? "written" : "current"}.`,
);

async function refreshAssets() {
  const temporary = await mkdtemp(join(tmpdir(), "nyte-grammars-"));
  const archives = new Map();

  try {
    for (const grammar of manifest.grammars) {
      let archive = archives.get(grammar.archive);

      if (archive === undefined) {
        const response = await fetch(grammar.archive);
        assert.equal(response.ok, true, grammar.archive);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(
          "sha512-" + createHash("sha512").update(bytes).digest("base64"),
          grammar.integrity,
        );
        archive = join(temporary, `${archives.size}.tgz`);
        await writeFile(archive, bytes);
        archives.set(grammar.archive, archive);
      }

      const wasm = execFileSync("tar", ["-xOf", archive, grammar.entry], {
        maxBuffer: 64 * 1024 * 1024,
      });

      assert.equal(digest(wasm), grammar.sha256, grammar.language);
      const license = execFileSync("tar", ["-xOf", archive, "package/LICENSE"]);
      assert.equal(
        digest(license),
        manifest.licenses.find((entry) => entry.file === grammar.licenseFile)?.sha256,
      );
      await writeFile(new URL(`${grammar.language}.wasm`, directory), wasm);
      await writeFile(new URL(`licenses/${grammar.licenseFile}`, directory), license);
    }

    const response = await fetch(manifest.markdownProvenance.license);
    assert.equal(response.ok, true);
    const license = Buffer.from(await response.arrayBuffer());
    assert.equal(
      digest(license),
      manifest.licenses.find((entry) => entry.file === "tree-sitter-markdown-v0.5.1.txt")?.sha256,
    );
    await writeFile(new URL("licenses/tree-sitter-markdown-v0.5.1.txt", directory), license);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
