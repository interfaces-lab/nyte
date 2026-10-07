// The bridge goes in before `theme/boot.ts` or any screen reads it.
import "./install.ts";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "../theme/boot.ts";
import "../theme/focus-modality.ts";
import "../theme/global.css";
import { create, props } from "@stylexjs/stylex";
import { createBrowserHistory } from "@tanstack/react-router";
import { focusManager } from "@tanstack/react-query";
import { StrictMode } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@nyte-ai/ui/button";
import { App } from "../app.tsx";
import { connectSessionDirectory, loadLocalResources } from "../queries.ts";
import { createAppRouter } from "../router.tsx";
import { serverConnectionProblem } from "../server-connection.ts";
import { startRendererStartup } from "../startup.ts";
import type { Connection } from "./bridge.ts";
import { AddFolderDialogHost } from "./add-folder.tsx";
import { connectAddress, connectFailure, ConnectScreen } from "./connect-screen.tsx";
import type { ConnectFailure } from "./connect-screen.tsx";
import { releaseStoredAccountDevice } from "./account-connection.ts";
import { readAccountDevice } from "./account-device.ts";
import { accountConfig } from "./account-config.ts";
import { AccountScreen } from "./account-screen.tsx";
import { LinkScreen } from "./link-screen.tsx";
import {
  displayAddress,
  forgetConnection,
  loadConnection,
  readPairingRequest,
  saveConnection,
} from "./connection.ts";

const styles = create({
  failure: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    height: "100%",
    overflowWrap: "anywhere",
  },
});

const container = document.getElementById("root");

if (container === null) throw new Error("Missing #root");

const pairing = readPairingRequest(new URL(location.href));

const router = createAppRouter({ history: createBrowserHistory() });

const root = createRoot(container);

function start(
  connection: Connection,
  mount: (shell: ReactNode) => void = (shell) => root.render(shell),
): void {
  // Directory changes are pushed; listen before the first snapshot is read so none slips between.
  connectSessionDirectory();

  focusManager.setEventListener((setFocused) => {
    const update = (): void => {
      setFocused(document.visibilityState !== "hidden" && document.hasFocus());
    };

    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    update();

    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  });

  performance.mark("nyte:startup");

  startRendererStartup({
    mountShell: () => {
      mount(
        <StrictMode>
          <App appIcon="/icon.svg" router={router} />
          <AddFolderDialogHost />
        </StrictMode>,
      );
    },
    loadResources: () =>
      Promise.all([
        loadLocalResources(),
        document.fonts.load('13px "Inter Variable"'),
        document.fonts.load('12px "JetBrains Mono Variable"'),
      ]).then(() => undefined),
    loadRouter: () => router.load(),
    showError: (retry) => {
      mount(
        <main {...props(styles.failure)}>
          <p role="alert">Couldn’t open the workspace on {displayAddress(connection)}.</p>
          <Button onClick={retry}>Try Again</Button>
        </main>,
      );
    },
    onReady: () => performance.mark("nyte:resources-ready"),
  });
}

function showConnectScreen(initial?: Connection, failure?: ConnectFailure): void {
  root.render(
    initial === undefined && accountConfig !== undefined ? (
      <AccountScreen config={accountConfig} onConnected={start} />
    ) : (
      <ConnectScreen
        initial={initial}
        failure={failure}
        onConnected={start}
        onBack={accountConfig === undefined ? undefined : () => showConnectScreen()}
      />
    ),
  );
}

async function resume(connection: Connection, fromLink: boolean): Promise<void> {
  if (fromLink) await releaseStoredAccountDevice(accountConfig);

  try {
    await connectAddress(connection, false);
  } catch (cause) {
    const refused = serverConnectionProblem(cause).kind === "authentication";

    // A refused saved token never works again: a local or Tailscale token ends
    // with its share, and a removed device's token stays revoked.
    if (refused && !fromLink) forgetConnection();
    showConnectScreen(
      refused ? { url: connection.url, token: "" } : connection,
      connectFailure(cause),
    );

    return;
  }

  saveConnection(connection);
  start(connection);
}

const accountDevice =
  accountConfig === undefined ? undefined : readAccountDevice(sessionStorage, accountConfig);

const known = pairing ?? (accountDevice === undefined ? loadConnection() : undefined);

// The link page approves a host for the account; it never connects this browser to one.
if (location.pathname === "/link" && accountConfig !== undefined) {
  root.render(<LinkScreen config={accountConfig} />);
} else if (known === undefined) showConnectScreen();
else void resume(known, pairing !== undefined);
