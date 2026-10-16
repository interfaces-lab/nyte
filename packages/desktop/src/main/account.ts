import { app, ipcMain } from "electron";
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { createClerkBridge } from "@clerk/electron";
import { AccountOperations } from "../account/operations.ts";
import { accountAnswer, accountReport } from "../account/policy.ts";
import { ACCOUNT_CHANNELS } from "../account/protocol.ts";
import type { AccountConfig } from "../account/protocol.ts";
import { ACCOUNT_HOST, signedInPage } from "../account/scheme.ts";
import type { accountScheme } from "../account/scheme.ts";
import { createSignInKeeper } from "./account-keeper.ts";
import type { AccountSession } from "./account-session.ts";
import type { AccountStore } from "./account-store.ts";

const CLIENT_TOKEN_KEY = "__clerk_client_jwt";

/**
 * `@clerk/electron` answers this with the bare deep link, which leaves the
 * browser tab on a page that never loads. Nyte answers with the hosted page
 * that opens the deep link instead. Internal to @clerk/electron 0.0.x.
 */
const OAUTH_REDIRECT_CHANNEL = "clerk:oauth-transport:get-redirect-url";

export function registerAccount(options: {
  readonly publishableKey: string;
  readonly scheme: ReturnType<typeof accountScheme>;
  readonly window: (id?: number) => BrowserWindow | undefined;
  readonly onChange: () => void;
  /** Keeps the sign-in across restarts. Without one, quitting signs out. */
  readonly store: AccountStore | undefined;
}): AccountSession {
  const signIn = createSignInKeeper(options.store, options.onChange);

  const bridge = createClerkBridge({
    storage: {
      getItem: (key) => (key === CLIENT_TOKEN_KEY ? signIn.readToken() : null),
      setItem: (key, value) => {
        if (key === CLIENT_TOKEN_KEY) signIn.writeToken(value);
      },
      removeItem: (key) => {
        if (key === CLIENT_TOKEN_KEY) signIn.writeToken(null);
      },
    },
    manageSingleInstanceLock: false,
    renderer: { scheme: options.scheme, host: ACCOUNT_HOST },
  });

  if (!app.isPackaged && process.platform === "win32") {
    app.setAsDefaultProtocolClient(options.scheme, process.execPath, [app.getAppPath()]);
  }

  const operations = new AccountOperations();
  let pending: { readonly id: string; readonly window: BrowserWindow } | undefined;

  const fromRenderer = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const contents = options.window(event.sender.id)?.webContents;

    return contents === event.sender && event.senderFrame === contents?.mainFrame;
  };

  const push = (): void => {
    pending?.window.webContents.send(ACCOUNT_CHANNELS.command, operations.current() ?? null);
  };

  const focus = (): void => {
    const window = pending?.window;

    if (window === undefined || window.isDestroyed()) return;

    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };

  const serve = async <T>({ id, result }: { readonly id: string; readonly result: Promise<T> }) => {
    void result.catch(() => undefined);
    const window = options.window();

    if (window === undefined || window.isDestroyed()) {
      operations.cancel(id);

      return result;
    }

    const current = { id, window };
    const contents = window.webContents;
    const cancel = (): void => operations.cancel(id);

    pending = current;
    window.once("closed", cancel);
    contents.once("render-process-gone", cancel);
    contents.once("did-navigate", cancel);
    push();
    focus();

    try {
      return await result;
    } finally {
      window.removeListener("closed", cancel);
      contents.removeListener("render-process-gone", cancel);
      contents.removeListener("did-navigate", cancel);

      if (pending === current) {
        if (!contents.isDestroyed()) contents.send(ACCOUNT_CHANNELS.command, null);
        pending = undefined;
      }
    }
  };

  ipcMain.handle(ACCOUNT_CHANNELS.config, (event): AccountConfig => {
    if (!fromRenderer(event)) throw new Error("Only Nyte windows read account configuration.");

    return { publishableKey: options.publishableKey };
  });
  ipcMain.removeHandler(OAUTH_REDIRECT_CHANNEL);
  ipcMain.handle(OAUTH_REDIRECT_CHANNEL, (event) => {
    if (!fromRenderer(event)) throw new Error("Only Nyte windows start a sign-in.");

    return signedInPage(options.scheme);
  });

  const returned = (url: string): void => {
    if (!url.startsWith(`${options.scheme}://${ACCOUNT_HOST}/`)) return;
    const contents = pending?.window.webContents;

    if (contents !== undefined && !contents.isDestroyed()) contents.send(ACCOUNT_CHANNELS.returned);
  };

  app.on("open-url", (_event, url) => returned(url));
  app.on("second-instance", (_event, argv) => argv.forEach(returned));
  ipcMain.on(ACCOUNT_CHANNELS.ready, (event) => {
    if (fromRenderer(event) && event.sender === pending?.window.webContents) push();
  });
  ipcMain.on(ACCOUNT_CHANNELS.answer, (event, value) => {
    if (!fromRenderer(event) || event.sender !== pending?.window.webContents) return;

    if (accountAnswer.Check(value)) operations.settle(value);
  });
  ipcMain.on(ACCOUNT_CHANNELS.report, (event, report) => {
    if (!fromRenderer(event)) return;

    if (!accountReport.Check(report)) return;

    if (report.kind === "unreachable") {
      if (event.sender === pending?.window.webContents) {
        operations.fail(new Error("Nyte can't reach the account service. Try again."));
      }

      return;
    }

    signIn.report(report);
  });
  app.once("will-quit", () => {
    operations.cancel();
    bridge.cleanup();
  });

  return {
    requestSessionToken: ({ signal }) => serve(operations.requestToken(signal)),
    state: signIn.state,
    focus,
    async signOut() {
      const { id, result } = operations.requestSignOut();

      const timer = setTimeout(
        () => operations.fail(new Error("Signing out took too long. Try again."), id),
        20_000,
      );

      try {
        await serve({ id, result });
        signIn.signOut();
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      operations.cancel();

      return Promise.resolve();
    },
  };
}
