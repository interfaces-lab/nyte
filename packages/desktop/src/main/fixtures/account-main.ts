import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { app, BrowserWindow, safeStorage, shell } from "electron";
import type { WebContents } from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ACCOUNT_CHANNELS } from "../../account/protocol.ts";
import { ACCOUNT_HOST, ACCOUNT_SCHEMES } from "../../account/scheme.ts";
import { registerAccount } from "../account.ts";
import { AccountCancelled } from "../account-session.ts";
import { AccountStore } from "../account-store.ts";
import type { SecretCipher } from "../connect-store.ts";
import { registerRenderer } from "../renderer.ts";

const directory = process.argv[2];

assert.ok(directory);

app.setPath("userData", join(directory, "profile"));

app.setPath("sessionData", join(directory, "session"));

app.setAsDefaultProtocolClient = () => false;

app.on("window-all-closed", () => undefined);

const refuseKeychain = (): never => {
  throw new Error("Account tests must not call safeStorage");
};

safeStorage.isEncryptionAvailable = refuseKeychain;

safeStorage.isAsyncEncryptionAvailable = refuseKeychain;

safeStorage.encryptString = refuseKeychain;

safeStorage.encryptStringAsync = refuseKeychain;

safeStorage.decryptString = refuseKeychain;

safeStorage.decryptStringAsync = refuseKeychain;

const seal = (plain: string): string => `sealed:${Buffer.from(plain).toString("base64")}`;

/** Stands in for the OS keychain; every call is one the real app would make to it. */
const cipherCalls: string[] = [];

const cipher = {
  available: async () => {
    cipherCalls.push("available");

    return true;
  },
  seal: async (plain) => {
    cipherCalls.push("seal");

    return seal(plain);
  },
  open: async (sealed) => {
    cipherCalls.push("open");
    assert.ok(sealed.startsWith("sealed:"));

    return Buffer.from(sealed.slice("sealed:".length), "base64").toString();
  },
} satisfies SecretCipher;

const saved = join(directory, "profile", "account.json");

// Before registration, which must not wait: Clerk registers its scheme before `ready`.
writeFileSync(saved, JSON.stringify({ sealed: seal("client.zero"), label: "grace@example.com" }));

const store = new AccountStore({ path: saved, cipher });

async function until(check: () => boolean | Promise<boolean>, message: string): Promise<void> {
  for (let attempt = 0; !(await check()); attempt += 1) {
    assert.ok(attempt < 250, message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

let mode: "answer" | "hold" = "answer";

const server = createServer((request, response) => {
  if (request.url === "/renderer.js") {
    void readFile(join(directory, "renderer.js")).then(
      (source) =>
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(source),
      () => response.writeHead(404).end(),
    );

    return;
  }

  if (request.url === "/lazy") {
    response
      .writeHead(200, { "content-type": "text/html" })
      .end('<!doctype html><body><script src="/renderer.js"></script>');

    return;
  }

  response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><script>
window.commands = [];
window.nyteAccount.report({ kind: "signed_in", label: "ada@example.com" });
const answer = (command) => {
  window.commands.push(command ?? null);
  if (command === undefined || ${JSON.stringify(mode)} === "hold") return;
  window.nyteAccount.answer(command.kind === "token"
    ? { id: command.id, kind: "token", token: "page.token.one" }
    : { id: command.id, kind: "signed_out" });
};
const stop = window.nyteAccount.onCommand((command) => {
  if (command === undefined) return;
  stop();
  window.nyteAccount.onCommand(answer);
});
</script>`);
});

async function commandId(contents: WebContents, except?: string): Promise<string> {
  const deadline = Date.now() + 10_000;

  for (;;) {
    const id = String(
      await contents.executeJavaScript("window.commands.filter(Boolean).at(-1)?.id ?? ''"),
    );

    if (id !== "" && id !== except) return id;

    if (Date.now() > deadline) throw new Error("Timed out waiting for an account command");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function run(): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  assert.ok(Value.Check(Type.Object({ port: Type.Number() }), address));
  const origin = `http://127.0.0.1:${address.port}`;

  process.env.ELECTRON_RENDERER_URL = origin;
  const scheme = ACCOUNT_SCHEMES.development;
  const rendererUrl = registerRenderer({ scheme, frontendApiHost: "clerk.example.com" });
  let window: BrowserWindow | undefined;

  const account = registerAccount({
    publishableKey: `pk_test_${Buffer.from("clerk.example.com$").toString("base64")}`,
    scheme,
    window: (id) =>
      window !== undefined && (id === undefined || id === window.webContents.id)
        ? window
        : undefined,
    onChange: () => undefined,
    store,
  });

  await until(() => account.state().kind === "signed_in", "Saved sign-in was not restored");
  assert.deepEqual(account.state(), { kind: "signed_in", label: "grace@example.com" });
  await app.whenReady();

  const preferences = {
    preload: join(directory, "out", "preload", "index.js"),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  };

  window = new BrowserWindow({ show: false, webPreferences: preferences });
  const contents = window.webContents;

  const signal = new AbortController().signal;
  let clerkRequests = 0;

  contents.session.webRequest.onBeforeRequest(
    { urls: ["https://clerk.example.com/*"] },
    (_details, callback) => {
      clerkRequests += 1;
      callback({ cancel: true });
    },
  );
  await window.loadURL(`${origin}/lazy`);
  const count = 'document.getElementById("count")?.textContent';

  await until(
    async () => (await contents.executeJavaScript(count)) === "0",
    "Renderer did not mount",
  );
  await contents.executeJavaScript('document.getElementById("count").click()');
  contents.send(ACCOUNT_CHANNELS.command, null);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(clerkRequests, 0);
  assert.equal(await contents.executeJavaScript(count), "1");
  assert.deepEqual(cipherCalls, []);
  const requested = account.requestSessionToken({ signal });
  const ended = assert.rejects(requested);

  await until(() => clerkRequests > 0, "Account command did not load Clerk");

  assert.equal(await contents.executeJavaScript(count), "1");
  await window.loadURL(rendererUrl);
  await ended;
  contents.session.webRequest.onBeforeRequest(null);

  assert.equal(await account.requestSessionToken({ signal }), "page.token.one");
  assert.equal(await account.requestSessionToken({ signal }), "page.token.one");
  assert.deepEqual(account.state(), { kind: "signed_in", label: "ada@example.com" });
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert.equal(window.isDestroyed(), false);
  assert.equal(
    await contents.executeJavaScript("typeof window.__clerk_internal_electron"),
    "object",
  );

  assert.deepEqual(
    await contents.executeJavaScript(`(async () => {
      const cache = window.__clerk_internal_electron.tokenCache;
      const key = "__clerk_client_jwt";
      const restored = await cache.getToken(key);
      await cache.saveToken(key, "client.one");
      const kept = await cache.getToken(key);
      await cache.clearToken(key);
      const cleared = await cache.getToken(key);
      await cache.saveToken(key, "client.two");
      return { restored, kept, cleared };
    })()`),
    { restored: "client.zero", kept: "client.one", cleared: null },
  );
  await until(
    async () =>
      Value.Equal(await store.load(), { sealed: seal("client.two"), label: "ada@example.com" }),
    "The new token was not sealed to disk",
  );
  assert.equal((await stat(saved)).mode & 0o777, 0o600);

  const redirectUrl = `${scheme}://${ACCOUNT_HOST}/`;

  assert.equal(
    await contents.executeJavaScript(
      "window.__clerk_internal_electron.oauthTransport.getRedirectUrl()",
    ),
    redirectUrl,
  );
  const openExternal = shell.openExternal.bind(shell);

  try {
    for (const delivery of ["open-url", "second-instance"] as const) {
      const callbackUrl = `${redirectUrl}?__clerk_status=complete`;

      shell.openExternal = async (url) => {
        assert.equal(url, "https://example.com/oauth");

        if (delivery === "open-url") {
          app.emit("open-url", { preventDefault: () => undefined }, callbackUrl);
        } else {
          app.emit("second-instance", {}, ["nyte", callbackUrl]);
        }
      };

      assert.deepEqual(
        await contents.executeJavaScript(
          'window.__clerk_internal_electron.oauthTransport.open("https://example.com/oauth")',
        ),
        { callbackUrl },
      );
    }
  } finally {
    shell.openExternal = openExternal;
  }

  assert.equal(
    await contents.executeJavaScript(`new Promise((resolve) => {
      document.addEventListener("securitypolicyviolation", (event) => resolve(event.effectiveDirective));
      fetch("http://localhost:9/blocked").catch(() => undefined);
    })`),
    "connect-src",
  );

  mode = "hold";
  await window.loadURL(rendererUrl);
  assert.equal(
    await contents.executeJavaScript(
      'window.__clerk_internal_electron.tokenCache.getToken("__clerk_client_jwt")',
    ),
    "client.two",
  );
  const first = account.requestSessionToken({ signal });
  const firstId = await commandId(contents);
  const second = account.requestSessionToken({ signal });

  await assert.rejects(first, AccountCancelled);
  const secondId = await commandId(contents, firstId);
  const intruder = new BrowserWindow({ show: false, webPreferences: preferences });

  await intruder.loadURL(rendererUrl);
  assert.equal(
    await intruder.webContents.executeJavaScript(
      'window.__clerk_internal_electron.tokenCache.getToken("__clerk_client_jwt")',
    ),
    "client.two",
  );
  assert.equal(
    await intruder.webContents.executeJavaScript(
      "window.nyteAccount.config().then(() => 'answered', () => 'refused')",
    ),
    "refused",
  );
  await intruder.webContents.executeJavaScript(
    `window.nyteAccount.answer({ id: ${JSON.stringify(secondId)}, kind: "token", token: "intruder.token.x" });`,
  );
  await contents.executeJavaScript(
    `window.nyteAccount.answer({ id: ${JSON.stringify(firstId)}, kind: "token", token: "stale.token.x" });
     window.nyteAccount.answer({ id: ${JSON.stringify(secondId)}, kind: "token", token: "page.token.two" });`,
  );
  assert.equal(await second, "page.token.two");
  intruder.destroy();

  const dismissed = account.requestSessionToken({ signal });
  const dismissal = assert.rejects(dismissed, AccountCancelled);
  const dismissedId = await commandId(contents, secondId);

  await contents.executeJavaScript(
    `window.nyteAccount.answer({ id: ${JSON.stringify(dismissedId)}, kind: "cancelled" });`,
  );
  await dismissal;
  assert.equal(window.isDestroyed(), false);
  assert.equal(BrowserWindow.getAllWindows().length, 1);

  const controller = new AbortController();
  const aborted = account.requestSessionToken({ signal: controller.signal });

  controller.abort();
  await assert.rejects(aborted, AccountCancelled);
  mode = "answer";
  await window.loadURL(rendererUrl);
  await account.signOut();
  assert.deepEqual(account.state(), { kind: "signed_out" });
  assert.equal(
    await contents.executeJavaScript(
      'window.__clerk_internal_electron.tokenCache.getToken("__clerk_client_jwt")',
    ),
    null,
  );
  await until(
    () =>
      stat(saved).then(
        () => false,
        () => true,
      ),
    "Sign-out left the token on disk",
  );

  mode = "hold";
  await window.loadURL(rendererUrl);
  const closed = account.requestSessionToken({ signal });

  await commandId(contents);
  window.close();
  await assert.rejects(closed, AccountCancelled);
  window = undefined;
  await account.close();
  assert.equal(cipherCalls.filter((call) => call === "open").length, 1);
  server.close();
  await writeFile(join(directory, "result.txt"), "passed");
  app.exit(0);
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
