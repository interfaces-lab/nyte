import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build, defaultClientConditions } from "vite";
import { deferredChunks, stylex } from "@nyte-ai/app/vite";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { defaultSecrets, openSecret, sealSecret } from "@nyte-ai/host";
import type { SecretsSource } from "@nyte-ai/host";
import { AccountOperations } from "./operations.ts";
import {
  rendererContentSecurityPolicy,
  accountAnswer,
  accountReport,
  resolveRendererFile,
  shellContentSecurityPolicy,
} from "../../shared/account/policy.ts";
import { accountScheme } from "../../shared/account/scheme.ts";
import { createSignInKeeper } from "./account-keeper.ts";
import { AccountCancelled } from "@nyte-ai/connect/host";
import { AccountStore } from "./account-store.ts";
import type { SecretSealer } from "./account-store.ts";
import { electronExecutable, isolatedElectronEnvironment } from "../fixtures/electron.ts";

const HOST = "clerk.example.com";

const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.c2lnbmF0dXJl";

function sequence(): () => string {
  let next = 0;

  return () => `op-${++next}`;
}

describe("account scheme", () => {
  test("each build registers its own callback scheme", () => {
    expect(accountScheme({ packaged: false, updateTest: false })).toBe("nyte-desktop-dev");
    expect(accountScheme({ packaged: false, updateTest: true })).toBe("nyte-desktop-dev");
    expect(accountScheme({ packaged: true, updateTest: false })).toBe("nyte-desktop");
    expect(accountScheme({ packaged: true, updateTest: true })).toBe("nyte-desktop-test");
  });
});

test("each content security policy allows only its own sources", () => {
  for (const row of [
    {
      name: "packaged renderer",
      policy: rendererContentSecurityPolicy({
        frontendApiHost: HOST,
        developmentOrigin: undefined,
        canvasOrigin: "nyte-desktop://canvas",
        mediaOrigin: "nyte-desktop://media",
      }),
      allows: [
        `script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' https://${HOST} `,
        "frame-src 'self' nyte-desktop://canvas ",
        "media-src 'self' blob: nyte-desktop://media;",
        `connect-src 'self' https://${HOST} `,
        "object-src 'none'",
        "frame-ancestors 'none'",
        " http://127.0.0.1:*",
      ],
      refuses: ["'unsafe-eval'", "telemetry", "ws://"],
    },
    {
      name: "development renderer",
      policy: rendererContentSecurityPolicy({
        frontendApiHost: HOST,
        developmentOrigin: "http://127.0.0.1:5174",
        canvasOrigin: "nyte-desktop-dev://canvas",
        mediaOrigin: "nyte-desktop-dev://media",
      }),
      allows: ["'unsafe-eval'", "ws://127.0.0.1:5174"],
      refuses: [],
    },
    {
      name: "account shell",
      policy: shellContentSecurityPolicy({ frameAncestor: "nyte-desktop://account" }),
      allows: [
        "default-src 'none';",
        "script-src 'self' blob:;",
        "connect-src 'none';",
        "frame-ancestors nyte-desktop://account;",
        "base-uri 'none';",
        "form-action 'none'",
      ],
      refuses: ["'unsafe-eval'", "http:", "https:"],
    },
  ]) {
    for (const source of row.allows) expect(row.policy, row.name).toContain(source);

    for (const source of row.refuses) expect(row.policy, row.name).not.toContain(source);
  }
});

describe("packaged renderer files", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "nyte-account-files-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("serves each page and asset from its own root and refuses the rest", () => {
    const packaged = { account: root, canvas: join(root, "shell") };
    const development = { account: undefined, canvas: join(root, "shell") };

    for (const row of [
      {
        roots: packaged,
        url: "nyte-desktop://account/",
        expected: { kind: "file", host: "account", path: join(root, "index.html"), html: true },
      },
      {
        roots: packaged,
        url: "nyte-desktop://account/assets/account-1.js",
        expected: {
          kind: "file",
          host: "account",
          path: join(root, "assets", "account-1.js"),
          html: false,
        },
      },
      {
        roots: development,
        url: "nyte-desktop-dev://canvas/index.html",
        expected: {
          kind: "file",
          host: "canvas",
          path: join(root, "shell", "index.html"),
          html: true,
        },
      },
      {
        roots: development,
        url: "nyte-desktop-dev://canvas/assets/main-1.js",
        expected: {
          kind: "file",
          host: "canvas",
          path: join(root, "shell", "assets", "main-1.js"),
          html: false,
        },
      },
      {
        roots: development,
        url: "nyte-desktop-dev://canvas/libraries/three.js",
        expected: {
          kind: "file",
          host: "canvas",
          path: join(root, "shell", "libraries", "three.js"),
          html: false,
        },
      },
      {
        roots: development,
        url: "nyte-desktop-dev://canvas/libraries/chunks/range-1.js",
        expected: {
          kind: "file",
          host: "canvas",
          path: join(root, "shell", "libraries", "chunks", "range-1.js"),
          html: false,
        },
      },
      {
        roots: development,
        url: "nyte-desktop-dev://account/",
        expected: { kind: "refused", status: 404 },
      },
      {
        roots: packaged,
        url: "nyte-desktop://account/account.html",
        expected: { kind: "refused", status: 404 },
      },
      {
        roots: packaged,
        url: "nyte-desktop://renderer/",
        expected: { kind: "refused", status: 404 },
      },
      {
        roots: packaged,
        url: "nyte-desktop://account/libraries/three.js",
        expected: { kind: "refused", status: 404 },
      },
      {
        roots: packaged,
        url: "nyte-desktop://canvas/libraries/..%2f..%2fpackage.json",
        expected: { kind: "refused", status: 403 },
      },
      {
        roots: packaged,
        url: "nyte-desktop://account/assets/",
        expected: { kind: "refused", status: 403 },
      },
      {
        roots: packaged,
        url: "nyte-desktop://account/assets/%2e%2e/account.html",
        expected: { kind: "refused", status: 404 },
      },
      {
        roots: packaged,
        url: "nyte-desktop://account/assets/..%2f..%2fpackage.json",
        expected: { kind: "refused", status: 403 },
      },
      {
        roots: packaged,
        url: "nyte-desktop://account/assets/%E0%A4%A",
        expected: { kind: "refused", status: 400 },
      },
    ])
      expect(resolveRendererFile(row.roots, row.url), row.url).toEqual(row.expected);
  });
});

test("renderer messages accept a JWT token answer and the three reports with a bounded label, and nothing else", () => {
  for (const row of [
    { check: accountAnswer, message: { id: "op-1", kind: "token", token: JWT }, valid: true },
    {
      check: accountAnswer,
      message: { id: "op-1", kind: "token", token: "not a jwt" },
      valid: false,
    },
    {
      check: accountAnswer,
      message: { id: "op-1", kind: "token", token: JWT, extra: true },
      valid: false,
    },
    {
      check: accountAnswer,
      message: { id: "op-1", kind: "failed", reason: "anything" },
      valid: false,
    },
    { check: accountAnswer, message: { id: "", kind: "signed_out" }, valid: false },
    { check: accountReport, message: { kind: "signed_in", label: "ada@example.com" }, valid: true },
    { check: accountReport, message: { kind: "signed_out" }, valid: true },
    { check: accountReport, message: { kind: "unreachable" }, valid: true },
    { check: accountReport, message: { kind: "signed_in", label: "" }, valid: false },
    { check: accountReport, message: { kind: "signed_in", label: "x".repeat(321) }, valid: false },
  ])
    expect(row.check.Check(row.message), JSON.stringify(row.message)).toBe(row.valid);
});

describe("account operations", () => {
  test("the current request's answer resolves it once", async () => {
    const operations = new AccountOperations(sequence());
    const { id, result } = operations.requestToken(new AbortController().signal);

    expect(operations.current()).toEqual({ id, kind: "token" });
    expect(operations.settle({ id, kind: "token", token: JWT })).toBe(true);
    await expect(result).resolves.toBe(JWT);
    expect(operations.current()).toBeUndefined();
    expect(operations.settle({ id, kind: "token", token: JWT })).toBe(false);
  });

  test("a newer request cancels the older, and the older answer is dropped", async () => {
    const operations = new AccountOperations(sequence());
    const first = operations.requestToken(new AbortController().signal);
    const second = operations.requestToken(new AbortController().signal);

    await expect(first.result).rejects.toBeInstanceOf(AccountCancelled);
    expect(operations.settle({ id: first.id, kind: "token", token: JWT })).toBe(false);
    expect(operations.current()).toEqual({ id: second.id, kind: "token" });
  });

  test("abort and close reject with AccountCancelled and drop late answers", async () => {
    const operations = new AccountOperations(sequence());
    const controller = new AbortController();
    const aborted = operations.requestToken(controller.signal);

    controller.abort();
    await expect(aborted.result).rejects.toBeInstanceOf(AccountCancelled);
    expect(operations.settle({ id: aborted.id, kind: "token", token: JWT })).toBe(false);

    const closed = operations.requestToken(new AbortController().signal);

    operations.cancel();
    await expect(closed.result).rejects.toBeInstanceOf(AccountCancelled);
    expect(operations.settle({ id: closed.id, kind: "token", token: JWT })).toBe(false);
  });

  test("an already-aborted signal never becomes the pending request", async () => {
    const operations = new AccountOperations(sequence());
    const controller = new AbortController();

    controller.abort();
    const { result } = operations.requestToken(controller.signal);

    await expect(result).rejects.toBeInstanceOf(AccountCancelled);
    expect(operations.current()).toBeUndefined();
  });

  test("an answer of the wrong kind leaves the request pending", async () => {
    const operations = new AccountOperations(sequence());
    const { id, result } = operations.requestSignOut();

    expect(operations.settle({ id, kind: "token", token: JWT })).toBe(false);
    expect(operations.settle({ id, kind: "signed_out" })).toBe(true);
    await expect(result).resolves.toBeUndefined();
  });

  test("a page failure rejects with main's text, not the page's", async () => {
    const operations = new AccountOperations(sequence());
    const { id, result } = operations.requestToken(new AbortController().signal);

    expect(operations.settle({ id, kind: "failed", reason: "impersonated" })).toBe(true);
    await expect(result).rejects.toThrow("An impersonated session can't link this Mac.");
  });

  test("fail with an id leaves a newer request alone", async () => {
    const operations = new AccountOperations(sequence());
    const signOut = operations.requestSignOut();
    const token = operations.requestToken(new AbortController().signal);

    await expect(signOut.result).rejects.toBeInstanceOf(AccountCancelled);
    operations.fail(new Error("timed out"), signOut.id);
    expect(operations.current()).toEqual({ id: token.id, kind: "token" });
  });
});

const execute = promisify(execFile);

function sealerFor(secrets: SecretsSource): SecretSealer {
  return {
    seal: (plain) => sealSecret(secrets, plain),
    open: (sealed) => openSecret(secrets, sealed),
  };
}

test("a secrets key that cannot be read keeps the saved sign-in", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-account-store-"));
  const path = join(directory, "account.json");

  const store = new AccountStore({
    path,
    sealer: sealerFor({
      key: async () => {
        throw new Error("No key.");
      },
    }),
  });

  try {
    const saved = JSON.stringify({ sealed: "older", label: "ada@example.com" });
    await writeFile(path, saved);
    await expect(store.save({ token: "client.one", label: "ada@example.com" })).rejects.toThrow(
      "No key.",
    );
    expect(await readFile(path, "utf8")).toBe(saved);
    await expect(store.open("older")).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a saved sign-in the keychain cannot open stays until this run signs in or out", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-account-store-"));
  const path = join(directory, "account.json");
  const saves: Array<Parameters<AccountStore["save"]>[0]> = [];

  class RecordingStore extends AccountStore {
    override save(signIn: Parameters<AccountStore["save"]>[0]): Promise<void> {
      saves.push(signIn);

      return super.save(signIn);
    }
  }

  const store = new RecordingStore({ path, sealer: sealerFor(defaultSecrets(directory)) });
  const saved = JSON.stringify({ sealed: "unopenable", label: "ada@example.com" });

  try {
    await writeFile(path, saved);
    const signIn = createSignInKeeper(store, () => undefined);

    expect(await signIn.readToken()).toBeNull();
    expect(signIn.state()).toEqual({ kind: "signed_out" });
    signIn.writeToken("client.fresh");
    signIn.writeToken(null);
    signIn.writeToken("client.fresh");
    expect(saves).toEqual([]);
    expect(await readFile(path, "utf8")).toBe(saved);

    signIn.report({ kind: "signed_in", label: "grace@example.com" });
    await vi.waitFor(async () => {
      const kept = await store.load();

      expect(kept?.label).toBe("grace@example.com");
      expect(await store.open(kept?.sealed ?? "")).toBe("client.fresh");
    });

    signIn.signOut();
    await vi.waitFor(async () => expect(await store.load()).toBeUndefined());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a saved sign-in loads at boot without the secrets key, which is read when the token is opened", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-account-store-"));
  const path = join(directory, "account.json");
  const file = defaultSecrets(directory);
  let reads = 0;

  const store = () =>
    new AccountStore({
      path,
      sealer: sealerFor({
        key: () => {
          reads += 1;

          return file.key();
        },
      }),
    });

  try {
    await store().save({ token: "client.one", label: "ada@example.com" });
    expect(await readFile(path, "utf8")).not.toContain("client.one");
    reads = 0;
    const booted = store();
    const saved = await booted.load();

    expect(saved?.label).toBe("ada@example.com");
    expect(reads).toBe(0);
    expect(await booted.open(saved?.sealed ?? "")).toBe("client.one");
    expect(reads).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sign-in uses the existing Nyte window, in real Electron", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-account-"));

  try {
    await Promise.all(["profile", "session", "home"].map((name) => mkdir(join(directory, name))));
    const sealed = await sealSecret({ key: async () => new Uint8Array(32).fill(7) }, "client.zero");
    await writeFile(
      join(directory, "profile", "account.json"),
      JSON.stringify({ sealed, label: "grace@example.com" }),
    );

    for (const entry of [
      { source: "../fixtures/account-main.ts", output: "main.cjs", outDir: directory },
      {
        source: "../../preload/index.ts",
        output: "index.js",
        outDir: join(directory, "out", "preload"),
      },
    ] as const) {
      await build({
        configFile: false,
        envDir: false,
        logLevel: "silent",
        resolve: {
          conditions: ["node"],
          mainFields: ["module", "main"],
        },
        build: {
          target: "node24",
          outDir: entry.outDir,
          emptyOutDir: false,
          minify: false,
          lib: {
            entry: fileURLToPath(new URL(entry.source, import.meta.url)),
            formats: ["cjs"],
            fileName: () => entry.output,
          },
          rollupOptions: {
            external: (id) =>
              id === "electron" || id.startsWith("node:") || builtinModules.includes(id),
            treeshake: { moduleSideEffects: false },
          },
        },
      });
    }

    await build({
      configFile: false,
      envDir: false,
      logLevel: "silent",
      plugins: [
        deferredChunks({
          account: {
            module: new URL("../../renderer/src/account/clerk.tsx", import.meta.url).href,
            packages: ["@clerk/"],
          },
        }),
        stylex.rollup({ devMode: "css-only" }),
      ],
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      oxc: { jsx: { development: false } },
      resolve: { conditions: ["nyte-source", ...defaultClientConditions] },
      build: {
        outDir: directory,
        emptyOutDir: false,
        manifest: true,
        lib: {
          entry: fileURLToPath(new URL("../fixtures/account-renderer.tsx", import.meta.url)),
          formats: ["es"],
          fileName: () => "renderer.js",
        },
      },
    });

    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: "nyte-account-test", main: "main.cjs" }),
    );

    await execute(
      electronExecutable,
      [directory, directory, "--use-mock-keychain", "--password-store=basic"],
      {
        cwd: directory,
        env: isolatedElectronEnvironment(directory),
        timeout: 60_000,
      },
    );
    expect(await readFile(join(directory, "result.txt"), "utf8")).toBe("passed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
