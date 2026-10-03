import { app, ipcMain } from "electron";
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { createClerkBridge } from "@clerk/electron";
import { storage } from "@clerk/electron/storage";
import { AccountOperations } from "../account/operations.ts";
import { accountAnswer, accountReport } from "../account/policy.ts";
import { ACCOUNT_CHANNELS } from "../account/protocol.ts";
import type { AccountConfig } from "../account/protocol.ts";
import { ACCOUNT_HOST } from "../account/scheme.ts";
import type { accountScheme } from "../account/scheme.ts";
import type { AccountSession, AccountState } from "./account-session.ts";

const CLIENT_TOKEN_KEY = "__clerk_client_jwt";

export function registerAccount(options: {
  readonly publishableKey: string;
  readonly scheme: ReturnType<typeof accountScheme>;
  readonly window: (id?: number) => BrowserWindow | undefined;
  readonly onChange: () => void;
}): AccountSession {
  const tokens = storage();

  const bridge = createClerkBridge({
    storage: {
      getItem: (key) => (key === CLIENT_TOKEN_KEY ? tokens.getItem(key) : null),
      setItem: (key, value) => (key === CLIENT_TOKEN_KEY ? tokens.setItem(key, value) : undefined),
      removeItem: (key) => (key === CLIENT_TOKEN_KEY ? tokens.removeItem(key) : undefined),
    },
    manageSingleInstanceLock: false,
    renderer: { scheme: options.scheme, host: ACCOUNT_HOST },
  });

  if (!app.isPackaged && process.platform === "win32") {
    app.setAsDefaultProtocolClient(options.scheme, process.execPath, [app.getAppPath()]);
  }

  const operations = new AccountOperations();
  let pending: { readonly id: string; readonly window: BrowserWindow } | undefined;
  let state: AccountState = { kind: "signed_out" };

  const setState = (next: AccountState): void => {
    if (
      next.kind === state.kind &&
      (next.kind !== "signed_in" || (state.kind === "signed_in" && state.label === next.label))
    )
      return;
    state = next;
    options.onChange();
  };

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
        await tokens.removeItem(CLIENT_TOKEN_KEY);
        setState({ kind: "signed_out" });
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
