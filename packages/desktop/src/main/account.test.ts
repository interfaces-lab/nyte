import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build, defaultClientConditions } from "vite";
import { stylex } from "@nyte-ai/app/vite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AccountOperations } from "../account/operations.ts";
import {
  rendererContentSecurityPolicy,
  checkedFrontendApiHost,
  accountAnswer,
  accountReport,
  resolveRendererFile,
} from "../account/policy.ts";
import { ACCOUNT_SCHEMES, accountScheme } from "../account/scheme.ts";
import { AccountCancelled } from "./account-session.ts";
import { AccountStore } from "./account-store.ts";

const HOST = "clerk.example.com";

const KEY = `pk_live_${Buffer.from(`${HOST}$`).toString("base64")}`;

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
    expect(ACCOUNT_SCHEMES.production).not.toBe(ACCOUNT_SCHEMES.updateTest);
  });
});

describe("account configuration", () => {
  test("accepts a key that encodes the configured Frontend API host", () => {
    expect(checkedFrontendApiHost({ publishableKey: KEY, frontendApiHost: HOST })).toBe(HOST);
  });

  test("refuses a key for another host, a malformed key, and a host with a scheme", () => {
    expect(() =>
      checkedFrontendApiHost({ publishableKey: KEY, frontendApiHost: "clerk.other.com" }),
    ).toThrow(/different Frontend API host/u);
    expect(() =>
      checkedFrontendApiHost({ publishableKey: "sk_live_abc", frontendApiHost: HOST }),
    ).toThrow(/malformed/u);
    expect(() =>
      checkedFrontendApiHost({ publishableKey: KEY, frontendApiHost: `https://${HOST}` }),
    ).toThrow(/bare host name/u);
  });

  test("the packaged policy names the Clerk host and nothing for development", () => {
    const policy = rendererContentSecurityPolicy({
      frontendApiHost: HOST,
      developmentOrigin: undefined,
    });

    expect(policy).toContain(
      `script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' https://${HOST} `,
    );
    expect(policy).toContain(`connect-src 'self' https://${HOST} `);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("telemetry");
    expect(policy).not.toContain("127.0.0.1");
  });

  test("the development policy adds the dev server's socket and eval", () => {
    const policy = rendererContentSecurityPolicy({
      frontendApiHost: HOST,
      developmentOrigin: "http://127.0.0.1:5174",
    });

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("ws://127.0.0.1:5174");
  });
});

describe("packaged renderer files", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "nyte-account-files-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("serves the page at its root and the built assets", () => {
    expect(resolveRendererFile(root, "nyte-desktop://account/")).toEqual({
      kind: "file",
      path: join(root, "index.html"),
      html: true,
    });
    expect(resolveRendererFile(root, "nyte-desktop://account/assets/account-1.js")).toEqual({
      kind: "file",
      path: join(root, "assets", "account-1.js"),
      html: false,
    });
  });

  test("refuses unknown pages, other hosts, and paths out of assets", () => {
    const refused = (url: string) => resolveRendererFile(root, url);

    expect(refused("nyte-desktop://account/account.html")).toEqual({
      kind: "refused",
      status: 404,
    });
    expect(refused("nyte-desktop://renderer/")).toEqual({ kind: "refused", status: 404 });
    expect(refused("nyte-desktop://account/assets/")).toEqual({ kind: "refused", status: 403 });
    // The URL parser already folds percent-encoded dot segments, which leaves the main page.
    expect(refused("nyte-desktop://account/assets/%2e%2e/account.html")).toEqual({
      kind: "refused",
      status: 404,
    });
    expect(refused("nyte-desktop://account/assets/..%2f..%2fpackage.json")).toEqual({
      kind: "refused",
      status: 403,
    });
    expect(refused("nyte-desktop://account/assets/%E0%A4%A")).toEqual({
      kind: "refused",
      status: 400,
    });
  });
});

describe("renderer messages", () => {
  test("accepts a JWT-shaped token answer and refuses anything else", () => {
    expect(accountAnswer.Check({ id: "op-1", kind: "token", token: JWT })).toBe(true);
    expect(accountAnswer.Check({ id: "op-1", kind: "token", token: "not a jwt" })).toBe(false);
    expect(accountAnswer.Check({ id: "op-1", kind: "token", token: JWT, extra: true })).toBe(false);
    expect(accountAnswer.Check({ id: "op-1", kind: "failed", reason: "anything" })).toBe(false);
    expect(accountAnswer.Check({ id: "", kind: "signed_out" })).toBe(false);
  });

  test("accepts the three reports with a bounded label", () => {
    expect(accountReport.Check({ kind: "signed_in", label: "ada@example.com" })).toBe(true);
    expect(accountReport.Check({ kind: "signed_out" })).toBe(true);
    expect(accountReport.Check({ kind: "unreachable" })).toBe(true);
    expect(accountReport.Check({ kind: "signed_in", label: "" })).toBe(false);
    expect(accountReport.Check({ kind: "signed_in", label: "x".repeat(321) })).toBe(false);
  });
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

test("a keychain that will not seal leaves no sign-in on disk", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-account-store-"));
  const path = join(directory, "account.json");
  const sealed: string[] = [];

  const store = new AccountStore({
    path,
    cipher: {
      available: async () => false,
      seal: async (plain) => {
        sealed.push(plain);

        return plain;
      },
      open: async (text) => text,
    },
  });

  try {
    await writeFile(path, JSON.stringify({ sealed: "older", label: "ada@example.com" }));
    await store.save({ token: "client.one", label: "ada@example.com" });
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(sealed).toEqual([]);
    expect(await store.open("older")).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sign-in uses the existing Nyte window, in real Electron", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-account-"));

  try {
    await Promise.all(["profile", "session", "home"].map((name) => mkdir(join(directory, name))));

    for (const entry of [
      { source: "./fixtures/account-main.ts", output: "main.cjs", outDir: directory },
      {
        source: "../preload/index.ts",
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
      plugins: [stylex.rollup({ devMode: "css-only", runtimeInjection: false })],
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      oxc: { jsx: { development: false } },
      resolve: { conditions: ["nyte-source", ...defaultClientConditions] },
      build: {
        outDir: directory,
        emptyOutDir: false,
        lib: {
          entry: fileURLToPath(new URL("./fixtures/account-renderer.tsx", import.meta.url)),
          formats: ["iife"],
          name: "accountFixture",
          fileName: () => "renderer.js",
        },
      },
    });

    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: "nyte-account-test", main: "main.cjs" }),
    );
    const require = createRequire(import.meta.url);
    const electronDirectory = dirname(require.resolve("electron/package.json"));

    const executable = join(
      electronDirectory,
      "dist",
      (await readFile(join(electronDirectory, "path.txt"), "utf8")).trim(),
    );

    await execute(
      executable,
      [directory, directory, "--use-mock-keychain", "--password-store=basic"],
      {
        cwd: directory,
        env: {
          HOME: join(directory, "home"),
          TMPDIR: directory,
          TMP: directory,
          TEMP: directory,
        },
        timeout: 60_000,
      },
    );
    expect(await readFile(join(directory, "result.txt"), "utf8")).toBe("passed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
