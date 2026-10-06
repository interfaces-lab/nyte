import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  globSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "bun";

const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));

const artifacts = join(root, "dist/sdk");

const names = [
  "telemetry",
  "schema",
  "ai",
  "protocol",
  "client",
  "core",
  "server",
  "plugin",
  "host",
].map((name) => `@nyte-ai/${name}`);

assert.equal(process.argv.length, 2, "Usage: bun scripts/verify-sdk-packages.mjs");

const environment = { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" };

function run(command, args, cwd, timeout = 120_000, quiet = false) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    stdio: command === "pnpm" && args[0] === "install" ? "inherit" : "pipe",
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.stdout && !quiet) process.stdout.write(result.stdout);

  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed${result.signal ? ` (${result.signal})` : ""}`,
  );

  return result.stdout ?? "";
}

function inside(directory, file) {
  const path = relative(directory, file);

  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function checkProtocols(value, label) {
  if (typeof value === "string") {
    assert.ok(
      !/^(workspace|link|file|portal):/.test(value),
      `${label}: unpublished protocol ${value}`,
    );

    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) checkProtocols(child, `${label}.${key}`);
  }
}

function exportTargets(value, condition = "default") {
  if (typeof value === "string") return [{ condition, target: value }];
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Expected compiled export conditions",
  );

  return Object.entries(value).flatMap(([key, child]) => exportTargets(child, key));
}

const fixture = `import assert from "node:assert/strict";
import { join } from "node:path";
import process from "node:process";
import { contentText, type Api, type Model } from "@nyte-ai/schema";
import { WIRE_VERSION } from "@nyte-ai/protocol";
import { NOOP_TELEMETRY_CONTEXT } from "@nyte-ai/telemetry";
import { createNyteModels, uuidv7 } from "@nyte-ai/ai";
import { createNyte } from "@nyte-ai/core";
import { localEnvironmentPlugin } from "@nyte-ai/core/plugins";
import { SqliteStore, WorkerStore, type Store } from "@nyte-ai/core/store";
import { createNyteServer } from "@nyte-ai/server";
import { createNyteClient, NyteWireError } from "@nyte-ai/client";
import { define } from "@nyte-ai/plugin";
import { createHost, nyteHome } from "@nyte-ai/host";

const directory = process.cwd();
const model: Model<Api> = {
  id: "sdk-smoke", name: "SDK smoke", provider: "openai", api: "openai-responses",
  baseUrl: "https://example.invalid", reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192, maxTokens: 1024,
};
globalThis.fetch = async () => { throw new Error("Smoke verification must not use the network"); };
assert.equal(contentText([{ type: "text", text: "packed" }]), "packed");
assert.ok(uuidv7().length > 0);
assert.equal(define({ id: "smoke", setup: () => undefined }).id, "smoke");
assert.equal(nyteHome(), join(directory, "home"));
assert.equal(await NOOP_TELEMETRY_CONTEXT.startSpan({ name: "smoke" }, () => 42), 42);

async function smoke(store: Store, label: string) {
  try {
    const sdk = await createNyte({
      store, model,
      models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
      streamFn: () => { throw new Error("Smoke verification must not invoke a provider"); },
      plugins: [localEnvironmentPlugin({ id: "smoke" })],
      defaultWorkspace: { kind: "local", id: "smoke", cwd: directory },
    });
    const token = "sdk-smoke-local-token";
    const server = createNyteServer({ sdk, version: "smoke", auth: { kind: "token", token } });
    const transport: typeof fetch = (input, init) => server.fetch(new Request(input, init));
    const client = createNyteClient({ baseUrl: "http://sdk.invalid", token, fetch: transport });
    try {
      assert.equal((await client.info()).wireVersion, WIRE_VERSION);
      const unauthorized = createNyteClient({ baseUrl: "http://sdk.invalid", fetch: transport });
      await assert.rejects(unauthorized.info(), (error: unknown) =>
        error instanceof NyteWireError && error.code === "unauthorized");
      const { sessionId } = await client.sessions.create({ name: label });
      await client.sessions.rename({ sessionId, name: "packed " + label });
      await client.sessions.setPinned({ sessionId, pinned: true });
      const row = (await client.sessions.list()).items.find((item) => item.sessionId === sessionId);
      assert.ok(row);
      assert.equal(row.name, "packed " + label);
      assert.equal(row.pinned, true);
      assert.ok(await client.sessions.get({ sessionId }));
      const snapshot = await client.sessions.snapshot({ sessionId });
      assert.ok(snapshot);
      let received = false;
      for await (const event of client.watch({ sessionId, signal: AbortSignal.timeout(5000) })) {
        assert.ok(Number.isSafeInteger(event.seq));
        received = true;
        break;
      }
      assert.ok(received, "Expected a replayed session event");
      return sessionId;
    } finally {
      server.close();
      await sdk.close();
    }
  } finally {
    await store.close();
  }
}

const sqlitePath = join(directory, "sqlite.db");
const sessionId = await smoke(new SqliteStore(sqlitePath), "SQLite");
const reopened = new SqliteStore(sqlitePath);
try {
  assert.ok((await reopened.list()).some((session) => session.id === sessionId));
} finally {
  await reopened.close();
}
await smoke(new WorkerStore({
  path: join(directory, "worker.db"),
  worker: new URL(import.meta.resolve("@nyte-ai/core/store-worker")),
}), "worker");
const hostStore = new SqliteStore(join(directory, "host.db"));
const host = await createHost({
  models: createNyteModels(),
  model,
  store: hostStore,
  plugins: { kind: "chat", system: "SDK smoke" },
});
try {
  assert.ok((await host.sessions.create()).sessionId);
} finally {
  await host.close();
  await hostStore.close();
}
console.log("PASS Node main imports, SQLite persistence, client/server, createHost and packed worker");
`;

let temporary;

try {
  const nodeVersion = run("node", ["--version"], root)
    .trim()
    .replace(/^v/, "")
    .split(".")
    .map(Number);

  assert.ok(
    nodeVersion[0] > 26 || (nodeVersion[0] === 26 && nodeVersion[1] >= 4),
    "Node 26.4+ is required",
  );
  run("pnpm", ["--version"], root);
  temporary = realpathSync(mkdtempSync(join(tmpdir(), "nyte-sdk-verify-")));
  assert.ok(!inside(root, temporary), "The consumer must be outside the workspace");
  const release = JSON.parse(readFileSync(join(artifacts, "release.json"), "utf8"));
  assert.equal(typeof release.version, "string", "release.version must be a string");
  assert.ok(release.version.length > 0);
  assert.ok(Array.isArray(release.packages), "release.packages must be an array");
  assert.equal(release.packages.length, names.length, "Expected nine public SDK tarballs");
  assert.deepEqual(release.packages.map((entry) => entry.name).sort(), [...names].sort());
  const tarballs = globSync("*.tgz", { cwd: artifacts }).sort();
  assert.deepEqual(
    release.packages.map((entry) => entry.file).sort(),
    tarballs,
    "release.json must list exactly the packed tarballs",
  );

  const privateNames = new Set(
    globSync("packages/**/package.json", {
      cwd: root,
      exclude: ["**/node_modules/**", "**/dist/**"],
    }).flatMap((file) => {
      const manifest = JSON.parse(readFileSync(join(root, file), "utf8"));

      return manifest.private === true ? [manifest.name] : [];
    }),
  );

  const dependencies = {};
  const packed = new Map();
  const visited = new Set();
  mkdirSync(join(temporary, "tarballs"));

  for (const entry of release.packages) {
    assert.equal(typeof entry.file, "string");
    assert.equal(
      basename(entry.file),
      entry.file,
      "Tarball filenames must not contain directories",
    );
    assert.ok(entry.file.endsWith(".tgz"));
    const tarball = join(temporary, "tarballs", entry.file);
    copyFileSync(join(artifacts, entry.file), tarball);
    const listing = run("tar", ["-tzf", tarball], temporary, 30_000, true).trim().split("\n");

    for (const file of listing) {
      assert.ok(
        file.startsWith("package/") && !file.split("/").includes(".."),
        `Unsafe tar entry ${file}`,
      );
    }

    const verbose = spawnSync("tar", ["-tvzf", tarball], { encoding: "utf8", timeout: 30_000 });
    assert.equal(verbose.status, 0, "Cannot inspect tarball file types");
    assert.ok(
      verbose.stdout
        .trim()
        .split("\n")
        .every((line) => /^[d-]/.test(line)),
      "Tarballs must not contain links or special files",
    );
    const unpack = join(temporary, "unpacked", entry.name.slice("@nyte-ai/".length));
    mkdirSync(unpack, { recursive: true });
    run("tar", ["-xzf", tarball, "-C", unpack], temporary);
    const directory = join(unpack, "package");
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    assert.equal(manifest.name, entry.name);
    assert.equal(manifest.version, release.version);
    assert.equal(manifest.private, false);
    assert.equal(manifest.type, "module");
    checkProtocols(manifest, entry.name);

    if (manifest.bin !== undefined) {
      for (const target of typeof manifest.bin === "string"
        ? [manifest.bin]
        : Object.values(manifest.bin)) {
        assert.ok(target.endsWith(".js"), `TypeScript runtime bin: ${target}`);
        assert.ok(
          inside(directory, resolve(directory, target)) &&
            lstatSync(resolve(directory, target)).isFile(),
          `Missing bin: ${target}`,
        );
      }
    }

    for (const field of ["main", "module"]) {
      if (manifest[field] !== undefined)
        assert.ok(
          manifest[field].endsWith(".js"),
          `TypeScript runtime ${field}: ${manifest[field]}`,
        );
    }

    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const dependency of Object.keys(manifest[field] ?? {})) {
        assert.ok(!privateNames.has(dependency), `${entry.name} depends on private ${dependency}`);

        if (!dependency.startsWith("@nyte-ai/")) continue;
        assert.ok(names.includes(dependency), `Unknown SDK dependency ${dependency}`);

        if (field === "dependencies")
          assert.ok(
            visited.has(dependency),
            `${dependency} must precede ${entry.name} in release.json`,
          );
      }
    }

    for (const file of ["LICENSE", "THIRD-PARTY-NOTICES.md"]) {
      assert.ok(
        readFileSync(join(directory, file), "utf8").trim().length > 0,
        `${entry.name} must ship ${file}`,
      );
    }

    assert.ok(
      manifest.exports && Object.hasOwn(manifest.exports, "."),
      `${entry.name} needs a main export`,
    );

    for (const [subpath, value] of Object.entries(manifest.exports)) {
      const targets = exportTargets(value);
      assert.ok(
        targets.some((entry) => entry.condition === "types"),
        `${entry.name}${subpath} needs declarations`,
      );
      assert.ok(
        targets.some((entry) => entry.condition !== "types"),
        `${entry.name}${subpath} needs JavaScript`,
      );

      for (const { condition, target } of targets) {
        assert.ok(
          /^\.\/dist\/(src|examples)\//.test(target),
          `Uncompiled export ${entry.name}: ${target}`,
        );
        assert.ok(
          condition === "types" ? target.endsWith(".d.ts") : target.endsWith(".js"),
          `Invalid ${condition} export ${target}`,
        );
        assert.ok(
          inside(directory, resolve(directory, target)),
          `Export escapes tarball: ${target}`,
        );
        assert.ok(lstatSync(resolve(directory, target)).isFile(), `Missing export ${target}`);
      }
    }

    packed.set(entry.name, manifest);
    dependencies[entry.name] = `file:./tarballs/${entry.file}`;
    visited.add(entry.name);
    console.log(`PASS tarball ${entry.name}`);
  }

  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify(
      {
        name: "nyte-sdk-smoke-consumer",
        private: true,
        type: "module",
        dependencies,
        devDependencies: { typescript: "^7.0.2", "@types/node": "^26.6.3" },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(temporary, "pnpm-workspace.yaml"),
    `packages: []\noverrides:\n${Object.entries(dependencies)
      .map(([name, file]) => `  ${JSON.stringify(name)}: ${JSON.stringify(file)}`)
      .join("\n")}\n`,
  );
  run(
    "pnpm",
    ["install", "--ignore-scripts", "--no-frozen-lockfile", "--reporter=append-only"],
    temporary,
    240_000,
  );

  const installed = globSync("node_modules/.pnpm/**/node_modules/@nyte-ai/*/package.json", {
    cwd: temporary,
  });

  assert.ok(installed.length >= names.length, "Expected installed SDK packages");

  for (const file of installed) {
    assert.ok(
      inside(temporary, realpathSync(join(temporary, file))),
      `Workspace/source link: ${file}`,
    );
    const manifest = JSON.parse(readFileSync(join(temporary, file), "utf8"));
    assert.deepEqual(
      manifest,
      packed.get(manifest.name),
      `Installed package differs from tarball: ${manifest.name}`,
    );
  }

  for (const name of names) {
    assert.ok(
      inside(temporary, realpathSync(join(temporary, "node_modules", name))),
      `Workspace/source link: ${name}`,
    );
  }

  const failures = [];

  async function verify(label, check) {
    try {
      await check();
    } catch (error) {
      failures.push(label);
      console.error(`FAIL ${label}:`, error);
    }
  }

  writeFileSync(join(temporary, "smoke.ts"), fixture);
  writeFileSync(
    join(temporary, "oauth.ts"),
    `import assert from "node:assert/strict";
import { loadAnthropicOAuth, loadOpenAICodexOAuth } from "@nyte-ai/ai";
globalThis.fetch = async () => { throw new Error("OAuth smoke must not use the network"); };
const outcomes = await Promise.allSettled([loadAnthropicOAuth(), loadOpenAICodexOAuth()]);
for (const outcome of outcomes) {
  if (outcome.status === "rejected") console.error(outcome.reason);
  else {
    assert.equal(typeof outcome.value.login, "function");
    assert.equal(typeof outcome.value.refresh, "function");
    assert.equal(typeof outcome.value.toAuth, "function");
  }
}
assert.ok(outcomes.every((outcome) => outcome.status === "fulfilled"), "Packed OAuth lazy loaders failed");
console.log("PASS OAuth lazy loads without login or network");
`,
  );
  environment.NYTE_HOME = join(temporary, "home");
  await verify("Node consumer", () => run("node", ["smoke.ts"], temporary));
  await verify("OAuth lazy loads", () => run("node", ["oauth.ts"], temporary));
  writeFileSync(
    join(temporary, "browser.ts"),
    `import { createNyteClient } from "@nyte-ai/client";\nexport const client = createNyteClient({ baseUrl: "https://example.invalid" });\n`,
  );
  await verify("browser bundle", async () => {
    const bundle = await build({
      entrypoints: [join(temporary, "browser.ts")],
      outdir: join(temporary, "browser-dist"),
      target: "browser",
      format: "esm",
      packages: "bundle",
    });

    for (const log of bundle.logs) console.error(String(log));
    assert.ok(bundle.success, "Browser client bundle failed");
    assert.ok(bundle.outputs.length > 0);

    for (const output of bundle.outputs) {
      const source = await output.text();
      assert.ok(
        !/\b(?:from\s*|import\s*\(|require\s*\()\s*["'](?:node:|bun:|@nyte-ai\/)/.test(source),
        "Browser bundle contains external SDK or runtime imports",
      );
    }

    console.log("PASS browser client bundle with packages bundled and no Node externals");
  });

  const compilerOptions = {
    target: "ES2025",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    lib: ["ES2025", "DOM", "DOM.Iterable"],
    types: ["node"],
    strict: true,
    noEmit: true,
    skipLibCheck: false,
  };

  const config = join(temporary, "tsconfig.json");
  const files = ["smoke.ts", "browser.ts", "oauth.ts"];
  writeFileSync(config, JSON.stringify({ compilerOptions, files }, null, 2));
  await verify("consumer tsc", async () => {
    const result = spawnSync("pnpm", ["exec", "tsc", "--project", config, "--pretty", "false"], {
      cwd: temporary,
      env: environment,
      encoding: "utf8",
      timeout: 120_000,
    });

    if (result.error) throw result.error;
    const errors = result.stdout.split("\n").filter((line) => /: error TS\d+:/.test(line));
    const isForeign = (line) => {
      const file = line.slice(0, line.indexOf("("));

      return file.includes("node_modules/") && !file.includes("/node_modules/@nyte-ai/");
    };

    const foreign = errors.filter(isForeign);
    const ours = errors.filter((line) => !isForeign(line));

    for (const line of foreign) console.warn(`Third-party declaration error, not ours: ${line}`);
    assert.equal(ours.length, 0, `Consumer or @nyte-ai type errors:\n${ours.join("\n")}`);
    assert.ok(
      errors.length > 0 || result.status === 0,
      `tsc failed without a diagnostic:\n${result.stdout}${result.stderr}`,
    );
    console.log(
      `PASS consumer tsc, strict declarations, ${String(foreign.length)} third-party declaration errors ignored`,
    );
  });
  assert.equal(failures.length, 0, `Failed checks: ${failures.join(", ")}`);
  console.log(
    `Verified ${names.length} packed SDK packages at ${release.version}. Nothing published.`,
  );
} catch (error) {
  console.error("SDK verification failed:", error);
  process.exitCode = 1;
} finally {
  if (temporary !== undefined) rmSync(temporary, { recursive: true, force: true });
}
