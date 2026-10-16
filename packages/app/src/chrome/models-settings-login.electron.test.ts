/**
 * Settings › Models driven by real clicks in Electron's Chromium, over the
 * recorded bridge in ./fixtures/login-harness-bridge.ts. Only the host IPC
 * and the clipboard are stood in for; React, the query cache, the attempt
 * store, and the toasts are the real ones.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { stylex } from "@nyte-ai/ui/stylex";
import electronExecutable from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { build } from "vite";
import { afterAll, beforeAll, beforeEach, test } from "vitest";
import type { ModelCatalogView, ModelInfo } from "@nyte-ai/sdk";
import type {
  HarnessFailures,
  HarnessStep,
  RecordedHostCall,
} from "./fixtures/login-harness-bridge.ts";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

type Catalog = Omit<ModelCatalogView, "generation">;

const model = (id: string, name: string): ModelInfo => ({
  ref: { provider: "github-copilot", id },
  name,
  reasoning: false,
  thinking: ["off"],
  fast: null,
  contextWindow: 128_000,
  compactAt: 100_000,
  maxOutput: 8_000,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

const copilot: Catalog["providers"][number] = {
  id: "github-copilot",
  name: "GitHub Copilot",
  credential: "missing",
  methods: [{ kind: "oauth" }],
  limits: [],
  models: [model("gpt", "GPT Fixture")],
};

const disconnected: Catalog = {
  default: { provider: "github-copilot", id: "gpt" },
  providers: [copilot],
};

/** What the host's catalog looks like once the credential is saved and discovery ran. */
const connected: Catalog = {
  ...disconnected,
  providers: [
    {
      ...copilot,
      credential: "verified",
      models: [model("gpt", "GPT Fixture"), model("claude", "Claude Fixture")],
    },
  ],
};

const deviceCode: HarnessStep = {
  kind: "open",
  url: "https://github.com/login/device",
  code: "ABCD-1234",
};

/** Playwright waits are bounded per step; the whole flow gets one budget. */
const TEST_TIMEOUT = 30_000;

let directory: string | undefined;

let application: ElectronApplication | undefined;

/** Assigned by beforeAll; every test runs after it or not at all. */
let page: Page;

const pageErrors: string[] = [];

/** Outside Electron the package resolves to the path of its executable. */
const executablePath = Value.Parse(Type.String(), electronExecutable);

/** The renderer half loads from file://, so its asset links must be relative. */
async function buildHarness(outDir: string): Promise<void> {
  await build({
    configFile: false,
    envDir: false,
    logLevel: "silent",
    build: {
      target: "node24",
      outDir,
      emptyOutDir: false,
      lib: {
        entry: join(fixtures, "login-harness-main.ts"),
        formats: ["cjs"],
        fileName: () => "main.cjs",
      },
      rollupOptions: { external: (id) => id === "electron" || id.startsWith("node:") },
    },
  });
  await build({
    configFile: false,
    envDir: false,
    logLevel: "silent",
    root: fixtures,
    base: "./",
    plugins: [stylex.vite({ devMode: "off", useCSSLayers: true })],
    resolve: {
      dedupe: ["react", "react-dom"],
    },
    build: {
      target: "chrome142",
      outDir,
      emptyOutDir: false,
      minify: false,
      rollupOptions: { input: join(fixtures, "login-harness.html") },
    },
  });
}

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "nyte-login-harness-"));
  directory = root;
  await Promise.all(["profile", "session", "home"].map((name) => mkdir(join(root, name))));
  await buildHarness(root);

  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
    ),
  );

  application = await _electron.launch({
    executablePath,
    args: [join(root, "main.cjs")],
    env: { ...inherited, HOME: join(root, "home"), NYTE_LOGIN_HARNESS_DIR: root, TMPDIR: root },
    timeout: 60_000,
  });
  page = await application.firstWindow();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
}, 180_000);

afterAll(async () => {
  await application?.close();

  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  pageErrors.length = 0;
  await page.reload();
  await page.locator("#root").waitFor();
  await catalogBecomes(disconnected);
  await page.getByRole("button", { name: "Connect Provider", exact: true }).waitFor();
});

async function catalogBecomes(catalog: Catalog): Promise<void> {
  await page.evaluate((next) => window.nyteLoginHarness.setCatalog(next), catalog);
}

function step(next: HarnessStep): Promise<void> {
  return page.evaluate((value) => window.nyteLoginHarness.step(value), next);
}

function recordedCalls(): Promise<RecordedHostCall[]> {
  return page.evaluate(() => [...window.nyteLoginHarness.calls]);
}

function setFailures(failures: Partial<HarnessFailures>): Promise<void> {
  return page.evaluate((next) => window.nyteLoginHarness.setFailures(next), failures);
}

async function startSignIn(): Promise<void> {
  await page.getByRole("button", { name: "Connect Provider", exact: true }).click();
  await page.getByText("Waiting for the browser").waitFor();
  const calls = await recordedCalls();
  const login = calls.find((call) => call.path === "models.login");
  assert.ok(login !== undefined, "clicking the button calls models.login");
  assert.deepEqual(login.input, {
    provider: "github-copilot",
    method: { kind: "oauth" },
    browser: "host",
  });
}

test(
  "signing in shows the code the flow opens with, copies it, opens the link, and lands the connected catalog",
  async () => {
    await startSignIn();
    await step(deviceCode);
    const code = page.getByLabel("Device code");
    await code.waitFor();
    assert.equal(await code.textContent(), "ABCD-1234");
    await page.getByText("Waiting for approval").waitFor();
    await page.getByText(/Enter this code on/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Cancel" }).count(), 1);

    await page.getByRole("button", { name: "Copy Sign-In Code" }).click();
    await page.getByRole("status").filter({ hasText: "Sign-in code copied" }).waitFor();
    assert.deepEqual(await page.evaluate(() => [...window.nyteLoginHarness.clipboard]), [
      "ABCD-1234",
    ]);

    await page.getByRole("link", { name: "github.com/login/device" }).click();
    const opened = (await recordedCalls()).filter((call) => call.path === "host.openExternal");
    assert.deepEqual(
      opened.map((call) => call.input),
      [{ url: "https://github.com/login/device" }],
    );

    await catalogBecomes(connected);
    await step({ kind: "done" });
    await page.getByText("Connected to GitHub Copilot").waitFor();
    await page.getByRole("region", { name: "Connected providers" }).waitFor();
    await code.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "GitHub Copilot: Connected" }).click();
    await page.getByRole("menuitem", { name: "Disconnect Provider" }).waitFor();
    await page.keyboard.press("Escape");
    assert.deepEqual(pageErrors, []);
  },
  TEST_TIMEOUT,
);

test(
  "cancelling drops the flow and returns the row to its sign-in button",
  async () => {
    await startSignIn();
    await step(deviceCode);
    await page.getByLabel("Device code").waitFor();
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Connect Provider", exact: true }).waitFor();
    await page.getByRole("region", { name: "Popular providers" }).waitFor();
    await page.getByLabel("Device code").waitFor({ state: "detached" });
    assert.ok((await recordedCalls()).some((call) => call.path === "models.login.cancel"));
    assert.equal(
      await page.getByRole("region", { name: "Notifications" }).getByRole("listitem").count(),
      0,
    );
    assert.deepEqual(pageErrors, []);
  },
  TEST_TIMEOUT,
);

test(
  "open or copy failures say what to do",
  async () => {
    await setFailures({ open: true, clipboard: true });
    await startSignIn();
    await step(deviceCode);
    await page.getByLabel("Device code").waitFor();

    await page.getByRole("link", { name: "github.com/login/device" }).click();
    await page.getByText(/Couldn't open github\.com/).waitFor();

    await page.getByRole("button", { name: "Copy Sign-In Code" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: /Couldn’t copy the code/ })
      .waitFor();
    assert.deepEqual(await page.evaluate(() => [...window.nyteLoginHarness.clipboard]), []);
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Connect Provider", exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);
  },
  TEST_TIMEOUT,
);

test(
  "a failed sign-in reports the failure and offers to try again",
  async () => {
    await startSignIn();
    await step(deviceCode);
    await step({ kind: "failed", reason: "denied" });
    await page.getByText(/Couldn't sign in to GitHub Copilot/).waitFor();
    await page.getByRole("button", { name: "Connect Provider", exact: true }).waitFor();
    await page.getByLabel("Device code").waitFor({ state: "detached" });
    assert.deepEqual(pageErrors, []);
  },
  TEST_TIMEOUT,
);

test(
  "a browser sign-in takes the default method, opens the page once, and sends the code it ends on",
  async () => {
    await startSignIn();
    await step({
      kind: "choose",
      message: "Select login method:",
      options: [
        { id: "browser", label: "Browser login" },
        { id: "copy_code", label: "Copy code login" },
      ],
    });
    await step({ kind: "open", url: "https://claude.ai/oauth/authorize" });
    await step({ kind: "paste", message: "Paste the code:", secret: false });

    await page.getByRole("textbox", { name: "Code or address" }).fill("code#state");
    await page.getByRole("button", { name: "Finish Sign-In" }).click();
    await page.getByText("Finishing sign-in…").waitFor();

    const calls = await recordedCalls();
    assert.deepEqual(
      calls.flatMap((call) => (call.path === "login.answer" ? [call.input] : [])),
      ["browser", "code#state"],
    );
    assert.deepEqual(
      calls.flatMap((call) => (call.path === "host.openExternal" ? [call.input] : [])),
      [{ url: "https://claude.ai/oauth/authorize" }],
    );
    assert.equal(await page.getByText("Select login method:").count(), 0);
    assert.equal(await page.getByText("Paste the code:").count(), 0);
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Connect Provider", exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);
  },
  TEST_TIMEOUT,
);

test(
  "a sign-in through a remote host says the browser is elsewhere",
  async () => {
    await page.evaluate(() =>
      window.nyteLoginHarness.setEndpoint(
        "https://connect.example/r/5f0c7d2e-3c1a-4b8e-9f6a-2d4e8c1b7a90",
      ),
    );
    await page.getByRole("button", { name: "Connect Provider", exact: true }).click();
    await page.getByText("Waiting for the browser").waitFor();
    const login = (await recordedCalls()).find((call) => call.path === "models.login");
    assert.ok(login !== undefined);
    assert.equal(login.input.browser, "elsewhere");
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Connect Provider", exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);
  },
  TEST_TIMEOUT,
);
