import { build } from "bun";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));

const [command, target] = process.argv.slice(2);

if (command !== "check" && !(command === "build" && target !== undefined)) {
  throw new Error("Usage: bun scripts/sdk-packages.mjs <check | build <package-directory>>");
}

const manifests = globSync("packages/{*,demo/*,demo/server/*}/package.json", { cwd: root }).map(
  (file) => ({
    directory: dirname(file),
    manifest: JSON.parse(readFileSync(join(root, file), "utf8")),
  }),
);

const byName = new Map(manifests.map((entry) => [entry.manifest.name, entry]));

const { release } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const packages = manifests.filter(
  ({ manifest }) => manifest.private === false && manifest.name !== "nyte-ai",
);

const publishedExport = (target) =>
  typeof target === "string"
    ? {
        types: target.replace("./", "./dist/").replace(/\.tsx?$/, ".d.ts"),
        import: target.replace("./", "./dist/").replace(/\.tsx?$/, ".js"),
      }
    : Object.fromEntries(
        Object.entries(target).map(([condition, source]) => [condition, publishedExport(source)]),
      );

const publishedExports = (manifest) =>
  Object.fromEntries(
    Object.entries(manifest.exports).map(([subpath, target]) => [subpath, publishedExport(target)]),
  );

const publishedFiles = (entry) =>
  typeof entry === "string" ? [entry] : Object.values(entry).flatMap(publishedFiles);

function defaultSource(name, target) {
  const source = typeof target === "string" ? target : target.default;

  if (typeof source !== "string") throw new Error(`${name} needs a default export condition`);

  return source;
}

for (const { directory, manifest } of manifests) {
  if (manifest.private !== true && manifest.private !== false) {
    throw new Error(`${directory} must declare private: true or false`);
  }

  if (manifest.private) continue;

  if (
    manifest.license !== "MIT" ||
    manifest.publishConfig?.access !== "public" ||
    manifest.publishConfig.provenance !== true
  ) {
    throw new Error(`${manifest.name} must declare MIT, public npm access and provenance`);
  }

  if (!release.packages.includes(manifest.name)) {
    throw new Error(`${manifest.name} must be in release.packages in the root package.json`);
  }

  if (manifest.repository?.directory !== directory) {
    throw new Error(`${manifest.name} must declare repository.directory ${directory}`);
  }

  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      const dependency = byName.get(name);

      if (dependency?.manifest.private)
        throw new Error(`${manifest.name} depends on private ${name}`);

      if (range.startsWith("workspace:") && dependency === undefined) {
        throw new Error(`${manifest.name} has unknown workspace dependency ${name}`);
      }
    }
  }
}

for (const { manifest } of packages) {
  if (!manifest.files.includes("dist")) throw new Error(`${manifest.name} must publish dist`);

  if (!isDeepStrictEqual(manifest.publishConfig.exports, publishedExports(manifest))) {
    throw new Error(
      `${manifest.name} publishConfig.exports must map its exports into dist: ${JSON.stringify(publishedExports(manifest))}`,
    );
  }
}

if (command === "check") {
  console.log(`Public SDK: ${packages.map(({ manifest }) => manifest.name).join(", ")}`);
  process.exit(0);
}

const entry = packages.find(({ directory }) => directory === `packages/${target}`);

if (entry === undefined) throw new Error(`Not a public SDK package: ${target}`);

const paths = {};

for (const { directory, manifest } of packages) {
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const name = subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
    paths[name] = [resolve(root, directory, publishedExport(defaultSource(name, target)).types)];
  }
}

const { directory, manifest } = entry;

const cwd = join(root, directory);

const dist = join(cwd, "dist");

const config = join(dist, "tsconfig.json");

rmSync(dist, { recursive: true, force: true });

mkdirSync(dist, { recursive: true });

for (const [subpath, target] of Object.entries(manifest.exports)) {
  const name = subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
  paths[name] = [resolve(cwd, defaultSource(name, target))];
}

writeFileSync(
  config,
  JSON.stringify(
    {
      extends: join(cwd, "tsconfig.json"),
      compilerOptions: {
        noEmit: false,
        noEmitOnError: true,
        declaration: true,
        emitDeclarationOnly: true,
        rootDir: cwd,
        outDir: dist,
        paths,
      },
      include: [join(cwd, "src/**/*.ts"), join(cwd, "src/**/*.tsx")],
      exclude: [join(cwd, "node_modules"), dist, join(cwd, "test")],
    },
    null,
    2,
  ),
);

try {
  execFileSync(join(root, "node_modules/.bin/tsc"), ["--project", config], {
    cwd: root,
    stdio: "inherit",
  });
} finally {
  rmSync(config, { force: true });
}

const result = await build({
  entrypoints: globSync(["src/**/*.ts", "src/**/*.tsx"], {
    cwd,
    exclude: ["**/*.d.ts"],
  }).map((file) => join(cwd, file)),
  root: cwd,
  outdir: dist,
  target: "node",
  format: "esm",
  packages: "external",
  splitting: true,
  naming: { entry: "[dir]/[name].[ext]", chunk: "chunks/[name]-[hash].[ext]" },
});

if (!result.success) throw new AggregateError(result.logs, `Failed to build ${manifest.name}`);

for (const file of globSync(["src/**/LICENSE"], { cwd })) {
  mkdirSync(dirname(join(dist, file)), { recursive: true });
  copyFileSync(join(cwd, file), join(dist, file));
}

for (const notice of ["LICENSE", "THIRD-PARTY-NOTICES.md"]) {
  copyFileSync(join(root, notice), join(cwd, notice));
}

for (const file of publishedFiles(manifest.publishConfig.exports)) {
  if (!existsSync(resolve(cwd, file))) throw new Error(`Missing ${manifest.name} export ${file}`);
}

console.log(`Built ${manifest.name}`);
