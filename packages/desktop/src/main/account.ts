import { app, ipcMain } from "electron";
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { createClerkBridge } from "@clerk/electron";
import { Value } from "typebox/value";
import { AccountOperations } from "../account/operations.ts";
import { accountAnswer, accountReport } from "../account/policy.ts";
import { ACCOUNT_CHANNELS } from "../account/protocol.ts";
import type { AccountConfig } from "../account/protocol.ts";
import { ACCOUNT_HOST, signedInPage } from "../account/scheme.ts";
import type { accountScheme } from "../account/scheme.ts";
import type { AccountSession, AccountState } from "./account-session.ts";
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
  const { store } = options;
  let state: AccountState = { kind: "signed_out" };
  let clientToken: string | null = null;
  /** A restored token, sealed until Clerk first asks for it. */
  let sealed: string | undefined;
  let opening: Promise<void> | undefined;
  /** What this run last saved; undefined before then, when the file may hold a restored token. */
  let kept: { readonly signIn: Parameters<AccountStore["save"]>[0] } | undefined;

  /** Bring the store in line with memory: a sign-in once both token and address describe one. */
  const keep = (): void => {
    if (store === undefined || sealed !== undefined) return;

    const next = {
      signIn:
        clientToken !== null && state.kind === "signed_in"
          ? { token: clientToken, label: state.label }
          : undefined,
    };

    if (Value.Equal(kept, next)) return;
    kept = next;
    void store.save(next.signIn).catch(() => undefined);
  };

  const setState = (next: AccountState): void => {
    if (
      next.kind === state.kind &&
      (next.kind !== "signed_in" || (state.kind === "signed_in" && state.label === next.label))
    )
      return;
    state = next;
    keep();
    options.onChange();
  };

  const restoring = store?.load().then((saved) => {
    if (saved === undefined || clientToken !== null || state.kind !== "signed_out") return;
    sealed = saved.sealed;
    setState({ kind: "signed_in", label: saved.label });
  });

  /** Open the restored token. One the keychain will not open signs out and leaves the store. */
  const unseal = async (): Promise<void> => {
    const restored = sealed;

    if (store === undefined || restored === undefined) return;
    const opened = await store.open(restored);

    if (sealed !== restored) return;
    sealed = undefined;

    if (opened !== undefined) {
      clientToken = opened;

      return;
    }

    setState({ kind: "signed_out" });
    keep();
  };

  const bridge = createClerkBridge({
    storage: {
      getItem: async (key) => {
        if (key !== CLIENT_TOKEN_KEY) return null;
        await restoring;
        await (opening ??= unseal());

        return clientToken;
      },
      setItem: (key, value) => {
        if (key !== CLIENT_TOKEN_KEY) return;
        clientToken = value;
        sealed = undefined;
        keep();
      },
      removeItem: (key) => {
        if (key !== CLIENT_TOKEN_KEY) return;
        clientToken = null;
        sealed = undefined;
        keep();
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

    setState(report);
  });
  app.once("will-quit", () => {
    operations.cancel();
    bridge.cleanup();
  });

  return {
    requestSessionToken: ({ signal }) => serve(operations.requestToken(signal)),
    state: () => state,
    focus,
    async signOut() {
      const { id, result } = operations.requestSignOut();

      const timer = setTimeout(
        () => operations.fail(new Error("Signing out took too long. Try again."), id),
        20_000,
      );

      try {
        await serve({ id, result });
        clientToken = null;
        sealed = undefined;
        setState({ kind: "signed_out" });
        keep();
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
