import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { app, BrowserWindow, safeStorage, shell } from "electron";
import type { WebContents } from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ACCOUNT_HOST, ACCOUNT_SCHEMES } from "../../account/scheme.ts";
import { registerAccount } from "../account.ts";
import { AccountCancelled } from "../account-session.ts";
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

let mode: "answer" | "hold" = "answer";

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><script>
window.commands = [];
window.nyteAccount.report({ kind: "signed_in", label: "ada@example.com" });
window.nyteAccount.onCommand((command) => {
  window.commands.push(command ?? null);
  if (command === undefined || ${JSON.stringify(mode)} === "hold") return;
  window.nyteAccount.answer(command.kind === "token"
    ? { id: command.id, kind: "token", token: "page.token.one" }
    : { id: command.id, kind: "signed_out" });
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
  });

  await app.whenReady();

  const preferences = {
    preload: join(directory, "out", "preload", "index.js"),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  };

  window = new BrowserWindow({ show: false, webPreferences: preferences });
  const contents = window.webContents;

  await window.loadURL(rendererUrl);
  const signal = new AbortController().signal;

  assert.equal(await account.requestSessionToken({ signal }), "page.token.one");
  assert.equal(await account.requestSessionToken({ signal }), "page.token.one");
  assert.deepEqual(account.state(), { kind: "signed_in", label: "ada@example.com" });
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert.equal(window.isDestroyed(), false);
  assert.equal(
    await contents.executeJavaScript("typeof window.__clerk_internal_electron"),
    "object",
  );

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
  const first = account.requestSessionToken({ signal });
  const firstId = await commandId(contents);
  const second = account.requestSessionToken({ signal });

  await assert.rejects(first, AccountCancelled);
  const secondId = await commandId(contents, firstId);
  const intruder = new BrowserWindow({ show: false, webPreferences: preferences });

  await intruder.loadURL(rendererUrl);
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

  mode = "hold";
  await window.loadURL(rendererUrl);
  const closed = account.requestSessionToken({ signal });

  await commandId(contents);
  window.close();
  await assert.rejects(closed, AccountCancelled);
  window = undefined;
  await account.close();
  server.close();
  await writeFile(join(directory, "result.txt"), "passed");
  app.exit(0);
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
