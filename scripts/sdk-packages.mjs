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
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const command = process.argv[2];

const target = process.argv[3];

if (!["check", "build", "pack"].includes(command)) {
  throw new Error("Usage: bun scripts/sdk-packages.mjs <check|build|pack> [package-directory]");
}

const manifests = globSync("packages/{*,demo/*,demo/server/*}/package.json", { cwd: root }).map(
  (file) => ({
    directory: dirname(file),
    manifest: JSON.parse(readFileSync(join(root, file), "utf8")),
  }),
);

const byName = new Map(manifests.map((entry) => [entry.manifest.name, entry]));

const launcher = byName.get("nyte-ai");

const version = launcher.manifest.version;

const packages = manifests.filter(
  ({ manifest }) => manifest.private === false && manifest.name !== "nyte-ai",
);

for (const { directory, manifest } of manifests) {
  if (manifest.private !== true && manifest.private !== false) {
    throw new Error(`${directory} must declare private: true or false`);
  }

  if (manifest.private) continue;

  if (manifest.license !== "MIT" || manifest.publishConfig?.access !== "public") {
    throw new Error(`${manifest.name} must declare MIT and public npm access`);
  }

  if (manifest.version !== version)
    throw new Error(`${manifest.name} must use release version ${version}`);

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

const ordered = [];

const visiting = new Set();

const visited = new Set();

function visit(entry) {
  const { name } = entry.manifest;

  if (visited.has(name)) return;

  if (visiting.has(name)) throw new Error(`SDK dependency cycle at ${name}`);
  visiting.add(name);

  for (const dependency of Object.keys(entry.manifest.dependencies ?? {})) {
    const next = byName.get(dependency);

    if (next !== undefined) visit(next);
  }

  visiting.delete(name);
  visited.add(name);
  ordered.push(entry);
}

if (target === undefined) {
  for (const entry of packages) visit(entry);
} else {
  const entry = packages.find(({ directory }) => directory === `packages/${target}`);

  if (entry === undefined) throw new Error(`Not a public SDK package: ${target}`);
  visit(entry);
}

const publishedExport = (source) => ({
  types: source.replace("./", "./dist/").replace(/\.ts$/, ".d.ts"),
  import: source.replace("./", "./dist/").replace(/\.ts$/, ".js"),
});

const paths = {};

for (const { directory, manifest } of packages) {
  for (const [subpath, source] of Object.entries(manifest.exports)) {
    const name = subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
    const published = publishedExport(source);
    paths[name] = [resolve(root, directory, published.types)];
  }
}

if (command === "check") {
  const tag = process.env.RELEASE_TAG;

  if (tag !== undefined && tag !== `v${version}`)
    throw new Error(`Expected release tag v${version}, got ${tag}`);
  console.log(`Public SDK ${version}: ${ordered.map(({ manifest }) => manifest.name).join(", ")}`);
} else {
  const destination = join(root, "dist", "sdk");

  if (command === "pack") {
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
  }

  for (const { directory, manifest } of ordered) {
    const cwd = join(root, directory);
    const dist = join(cwd, "dist");
    rmSync(dist, { recursive: true, force: true });
    mkdirSync(dist, { recursive: true });
    const config = join(dist, "tsconfig.json");
    const ownPaths = { ...paths };

    for (const [subpath, source] of Object.entries(manifest.exports)) {
      const name = subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
      ownPaths[name] = [resolve(cwd, source)];
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
            paths: ownPaths,
          },
          include: [join(cwd, "src/**/*.ts"), join(cwd, "examples/**/*.ts")],
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
      entrypoints: globSync(["src/**/*.ts", "examples/**/*.ts"], {
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

    for (const file of globSync(["src/**/LICENSE", "examples/**/LICENSE"], { cwd })) {
      mkdirSync(dirname(join(dist, file)), { recursive: true });
      copyFileSync(join(cwd, file), join(dist, file));
    }

    const exports = Object.fromEntries(
      Object.entries(manifest.exports).map(([name, source]) => [name, publishedExport(source)]),
    );

    for (const entry of Object.values(exports)) {
      for (const file of [entry.types, entry.import]) {
        if (!existsSync(resolve(cwd, file)))
          throw new Error(`Missing ${manifest.name} export ${file}`);
      }
    }

    console.log(`Built ${manifest.name}@${version}`);

    if (command === "pack") {
      const file = join(cwd, "package.json");
      const original = readFileSync(file, "utf8");
      const notices = ["LICENSE", "THIRD-PARTY-NOTICES.md"];

      try {
        for (const name of notices) copyFileSync(join(root, name), join(cwd, name));
        writeFileSync(file, `${JSON.stringify({ ...manifest, exports }, null, 2)}\n`);
        execFileSync("pnpm", ["pack", "--pack-destination", destination], {
          cwd,
          stdio: "inherit",
        });
      } finally {
        writeFileSync(file, original);
        for (const name of notices) rmSync(join(cwd, name), { force: true });
      }
    }
  }

  if (command === "pack") {
    writeFileSync(
      join(destination, "release.json"),
      `${JSON.stringify(
        {
          version,
          packages: ordered.map(({ manifest }) => ({
            name: manifest.name,
            file: `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${version}.tgz`,
          })),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`Packed SDK in ${relative(root, destination)}`);
  }
}
