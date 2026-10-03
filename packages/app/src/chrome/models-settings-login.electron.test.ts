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
import type {
  DesktopCatalog,
  DesktopModelOption,
  HostEvent,
  LoginOutcome,
  ProviderStatus,
} from "../bridge.ts";
import type { HarnessFailures, RecordedHostCall } from "./fixtures/login-harness-bridge.ts";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

const gpt: DesktopModelOption = {
  key: "github-copilot/gpt",
  provider: "github-copilot",
  id: "gpt",
  name: "GPT Fixture",
  contextWindow: 128_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  fastMode: { kind: "unavailable" },
  thinkingLevels: ["off"],
  hidden: false,
  listed: false,
};

const copilot: ProviderStatus = {
  id: "github-copilot",
  name: "GitHub Copilot",
  enabled: true,
  connection: { kind: "disconnected" },
  signIn: [{ kind: "browser", label: "Sign in with GitHub", subscription: "Copilot" }],
};

const disconnected: DesktopCatalog = {
  source: "local",
  providers: [copilot],
  models: [gpt],
  defaults: { model: { provider: "github-copilot", id: "gpt" }, thinkingLevel: "off", fast: false },
};

/** What the host's catalog looks like once the credential is saved and discovery ran. */
const connected: DesktopCatalog = {
  ...disconnected,
  providers: [{ ...copilot, connection: { kind: "oauth" } }],
  models: [
    { ...gpt, listed: true },
    { ...gpt, key: "github-copilot/claude", id: "claude", name: "Claude Fixture", listed: true },
  ],
};

const deviceCode = (attempt: string): HostEvent => ({
  kind: "login_progress",
  attempt,
  provider: "github-copilot",
  progress: {
    kind: "device_code",
    userCode: "ABCD-1234",
    verificationUri: "https://github.com/login/device",
    expiresInSeconds: 900,
    instructions: "GitHub will show OpenCode as the OAuth app.",
  },
});

/** Playwright waits are bounded per step; the whole flow gets one budget. */
const TEST_TIMEOUT = 30_000;

let directory: string | undefined;

let application: ElectronApplication | undefined;

/** Assigned by beforeAll; every test runs after it or not at all. */
let page: Page;

const pageErrors: string[] = [];

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
    // Loaded from file://, so asset links must be relative.
    base: "./",
    plugins: [stylex.vite({ devMode: "off", runtimeInjection: false, useCSSLayers: true })],
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
  // Outside Electron the package resolves to the path of its executable.
  const executablePath = Value.Parse(Type.String(), electronExecutable);
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

/** The host's catalog changed; the renderer must re-read it, as after any sign-in. */
async function catalogBecomes(catalog: DesktopCatalog): Promise<void> {
  await page.evaluate((next) => {
    window.nyteLoginHarness.setCatalog(next);
    window.nyteLoginHarness.emit({ kind: "catalog_changed" });
  }, catalog);
}

function emit(event: HostEvent): Promise<void> {
  return page.evaluate((next) => window.nyteLoginHarness.emit(next), event);
}

function settleLogin(outcome: LoginOutcome): Promise<void> {
  return page.evaluate((next) => window.nyteLoginHarness.resolveLogin(next), outcome);
}

function recordedCalls(): Promise<RecordedHostCall[]> {
  return page.evaluate(() => [...window.nyteLoginHarness.calls]);
}

function setFailures(failures: Partial<HarnessFailures>): Promise<void> {
  return page.evaluate((next) => window.nyteLoginHarness.setFailures(next), failures);
}

/** Start a connection and answer with the attempt ID the renderer chose. */
async function startSignIn(): Promise<string> {
  await page.getByRole("button", { name: "Connect Provider", exact: true }).click();
  await page.getByText("Waiting for the browser").waitFor();
  const calls = await recordedCalls();
  const login = calls.find((call) => call.path === "host.login");
  assert.ok(login !== undefined, "clicking the button calls host.login");
  const { attempt, provider, method } = login.input;
  assert.equal(provider, "github-copilot");
  assert.deepEqual(method, { kind: "browser" });
  assert.ok(attempt.length > 0, "host.login carries an attempt ID");

  return attempt;
}

test(
  "signing in shows the emitted code, copies it, opens the link, and lands the connected catalog",
  async () => {
    const attempt = await startSignIn();
    await emit(deviceCode(attempt));
    const code = page.getByLabel("Device code");
    await code.waitFor();
    assert.equal(await code.textContent(), "ABCD-1234");
    await page.getByText("Waiting for approval").waitFor();
    await page.getByText(/Enter this code on/).waitFor();
    const instructions = page.getByText("GitHub will show OpenCode as the OAuth app.");
    await instructions.waitFor();
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

    await emit({
      kind: "login_progress",
      attempt,
      provider: "github-copilot",
      progress: { kind: "message", message: "Still waiting for GitHub" },
    });
    await page.getByText("Still waiting for GitHub").waitFor();
    assert.equal(await code.textContent(), "ABCD-1234", "a message never hides the code");
    assert.equal(await instructions.count(), 1, "a message never hides the instructions");

    // Approval: the host saves the credential, refreshes discovery, and emits
    // catalog_changed before the login call answers.
    await catalogBecomes(connected);
    await settleLogin({ kind: "connected", catalogRefreshed: true });
    await page.getByText("Connected to GitHub Copilot").waitFor();
    await page.getByRole("region", { name: "Connected providers" }).waitFor();
    await code.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "GitHub Copilot: Connected" }).click();
    await page.getByRole("menuitem", { name: "Disconnect Provider" }).waitFor();
    await page.keyboard.press("Escape");
    const defaultModel = page.getByRole("combobox", { name: "Default model" });
    await defaultModel.waitFor();
    assert.equal(await defaultModel.isDisabled(), false, "two listed models make it a choice");
    assert.match((await defaultModel.textContent()) ?? "", /GPT Fixture/);
    assert.deepEqual(pageErrors, []);
  },
  TEST_TIMEOUT,
);

test(
  "a connected sign-in whose discovery failed says so instead of claiming success",
  async () => {
    const attempt = await startSignIn();
    await emit(deviceCode(attempt));
    await catalogBecomes({ ...connected, models: [gpt] });
    await settleLogin({ kind: "connected", catalogRefreshed: false });
    await page.getByText(/model list couldn't be updated/).waitFor();
    await page.getByRole("region", { name: "Connected providers" }).waitFor();
    assert.deepEqual(pageErrors, []);
  },
  TEST_TIMEOUT,
);

test(
  "cancelling asks the host to stop the attempt and returns the row to its sign-in button",
  async () => {
    const attempt = await startSignIn();
    await emit(deviceCode(attempt));
    await page.getByLabel("Device code").waitFor();
    const cancel = page.getByRole("button", { name: "Cancel" });
    await cancel.click();
    await page.getByText("Cancelling").waitFor();
    assert.equal(await cancel.getAttribute("aria-busy"), "true");
    assert.equal(await cancel.evaluate((button) => button.matches(":disabled")), false);
    const cancels = (await recordedCalls()).filter((call) => call.path === "host.cancelLogin");
    assert.deepEqual(
      cancels.map((call) => call.input),
      [{ attempt }],
    );

    await settleLogin({ kind: "cancelled" });
    await page.getByRole("button", { name: "Connect Provider", exact: true }).waitFor();
    await page.getByRole("region", { name: "Popular providers" }).waitFor();
    await page.getByLabel("Device code").waitFor({ state: "detached" });
    assert.equal(
      await page.getByRole("region", { name: "Notifications" }).getByRole("listitem").count(),
      0,
    );
    assert.deepEqual(pageErrors, []);
  },
  TEST_TIMEOUT,
);

test(
  "a cancel the host refuses hands the button back, and open or copy failures say what to do",
  async () => {
    await setFailures({ cancel: true, open: true, clipboard: true });
    const attempt = await startSignIn();
    await emit(deviceCode(attempt));
    await page.getByLabel("Device code").waitFor();

    const cancel = page.getByRole("button", { name: "Cancel" });
    await cancel.click();
    await page.getByText(/Couldn't cancel the GitHub Copilot sign-in/).waitFor();
    await page.getByText("Waiting for approval").waitFor();
    assert.equal(await cancel.isDisabled(), false, "not stuck on Cancelling");

    await page.getByRole("link", { name: "github.com/login/device" }).click();
    await page.getByText(/Couldn't open github\.com/).waitFor();

    await page.getByRole("button", { name: "Copy Sign-In Code" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: /Couldn’t copy the code/ })
      .waitFor();
    assert.deepEqual(await page.evaluate(() => [...window.nyteLoginHarness.clipboard]), []);

    // The attempt is still alive: a later cancel that succeeds ends it.
    await setFailures({ cancel: false });
    await cancel.click();
    await settleLogin({ kind: "cancelled" });
    await page.getByRole("button", { name: "Connect Provider", exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);
  },
  TEST_TIMEOUT,
);

test(
  "a failed sign-in reports the failure and offers to try again",
  async () => {
    const attempt = await startSignIn();
    await emit(deviceCode(attempt));
    await page.evaluate(() => window.nyteLoginHarness.rejectLogin());
    await page.getByText(/Couldn't sign in to GitHub Copilot/).waitFor();
    await page.getByRole("button", { name: "Connect Provider", exact: true }).waitFor();
    await page.getByLabel("Device code").waitFor({ state: "detached" });
    assert.deepEqual(pageErrors, []);
  },
  TEST_TIMEOUT,
);
