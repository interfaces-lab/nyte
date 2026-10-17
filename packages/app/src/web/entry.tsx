/** The browser entry. The bridge goes in before `theme/boot.ts` or any screen reads it. */
import "./install.ts";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "../theme/boot.ts";
import "../theme/focus-modality.ts";
import "../theme/global.css";
import { createBrowserHistory } from "@tanstack/react-router";
import { focusManager } from "@tanstack/react-query";
import { StrictMode } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../app.tsx";
import { loadLocalResources } from "../queries.ts";
import { createAppRouter } from "../router.tsx";
import { connection as installedConnection, connectionProblem, hostChanged } from "../sdk.tsx";
import { forgetFirstFrame, recordFirstFrame, seedFirstFrame } from "../first-frame.ts";
import { startRendererStartup } from "../startup.ts";
import { StartupFailure } from "../startup-failure.tsx";
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

const container = document.getElementById("root");

if (container === null) throw new Error("Missing #root");

const pairing = readPairingRequest(new URL(location.href));

const router = createAppRouter({ history: createBrowserHistory() });

const root = createRoot(container);

/**
 * Mount the interface for `connection`, then run `open` under it: it installs
 * the connection when the shell mounted ahead of it, and does nothing when
 * the connection is already open.
 */
function mountApp(
  connection: Connection,
  mount: (shell: ReactNode) => void,
  open: () => Promise<void>,
): void {
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
    fonts: ['13px "Inter Variable"', '12px "JetBrains Mono Variable"'],
    router,
    mountShell: (mounted) => {
      mount(
        <StrictMode>
          <App appIcon="/icon.svg" router={router} />
          <AddFolderDialogHost />
        </StrictMode>,
      );
      mounted();
    },
    connect: () =>
      open()
        .then(loadLocalResources)
        .then(() => recordFirstFrame(connection.url, installedConnection().hostId)),
    showError: (retry) => {
      mount(
        <StartupFailure
          message={`Couldn’t open the workspace on ${displayAddress(connection)}.`}
          onRetry={retry}
        />,
      );
    },
  });
}

/** A connection that is already open: the last run's snapshot fills in while the host is read. */
function start(
  connection: Connection,
  mount: (shell: ReactNode) => void = (shell) => root.render(shell),
): void {
  seedFirstFrame(connection.url);
  mountApp(connection, mount, async () => undefined);
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

/**
 * A refused saved token never works again: a local or Tailscale token ends with
 * its share, and a removed device's token stays revoked, so it is forgotten.
 * Another host behind the address makes the last run's snapshot someone
 * else's, so it goes too.
 */
function refuse(connection: Connection, fromLink: boolean, cause: unknown): void {
  const refused = connectionProblem(cause).kind === "authentication";

  if (refused && !fromLink) forgetConnection();

  if (hostChanged(cause)) forgetFirstFrame();
  showConnectScreen(
    refused ? { url: connection.url, token: "" } : connection,
    connectFailure(cause),
  );
}

/**
 * A saved connection with a snapshot from the last run mounts at once and
 * connects underneath: the draft and the sidebar never wait for the network.
 * A refused token or another host's answer still leaves for the connect
 * screen; a network failure keeps the shell and offers a retry.
 */
async function resume(connection: Connection, fromLink: boolean): Promise<void> {
  if (fromLink) await releaseStoredAccountDevice(accountConfig);

  if (!fromLink && seedFirstFrame(connection.url)) {
    mountApp(
      connection,
      (shell) => root.render(shell),
      () =>
        connectAddress(connection, false).then(
          () => saveConnection(connection),
          (cause: unknown) => {
            const problem = connectionProblem(cause).kind;

            if (problem === "authentication" || hostChanged(cause))
              refuse(connection, false, cause);
            throw cause;
          },
        ),
    );

    return;
  }

  try {
    await connectAddress(connection, false);
  } catch (cause) {
    refuse(connection, fromLink, cause);

    return;
  }

  saveConnection(connection);
  start(connection);
}

const accountDevice =
  accountConfig === undefined ? undefined : readAccountDevice(sessionStorage, accountConfig);

const known = pairing ?? (accountDevice === undefined ? loadConnection() : undefined);

if (location.pathname === "/link" && accountConfig !== undefined) {
  root.render(<LinkScreen config={accountConfig} />);
} else if (known === undefined) showConnectScreen();
else void resume(known, pairing !== undefined);
