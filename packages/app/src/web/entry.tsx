// The bridge goes in before `theme/boot.ts` or any screen reads it.
import { webBridge } from "./install.ts";
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
import { createRoot } from "react-dom/client";
import { Button } from "@nyte-ai/ui/button";
import { App } from "../app.tsx";
import { connectSessionDirectory, loadLocalResources } from "../queries.ts";
import { createAppRouter } from "../router.tsx";
import { serverConnectionProblem } from "../server-connection.ts";
import { startRendererStartup } from "../startup.ts";
import type { Connection } from "./bridge.ts";
import { ConnectScreen } from "./connect-screen.tsx";
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
  },
});

const container = document.getElementById("root");

if (container === null) throw new Error("Missing #root");

const pairing = readPairingRequest(new URL(location.href));

const router = createAppRouter({ history: createBrowserHistory() });

const root = createRoot(container);

function start(connection: Connection): void {
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
      root.render(
        <StrictMode>
          <App appIcon="/icon.svg" router={router} />
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
      root.render(
        <main {...props(styles.failure)}>
          <p role="alert">Couldn’t open the workspace on {displayAddress(connection)}.</p>
          <Button onClick={retry}>Try Again</Button>
        </main>,
      );
    },
    onReady: () => performance.mark("nyte:resources-ready"),
  });
}

function showConnectScreen(initial?: Connection, problem?: string): void {
  root.render(<ConnectScreen initial={initial} problem={problem} onConnected={start} />);
}

async function resume(connection: Connection, fromLink: boolean): Promise<void> {
  try {
    await webBridge.connect(connection);
  } catch (cause) {
    const problem = serverConnectionProblem(cause);
    const refused = problem.kind === "authentication";

    // A refused saved token never works again: a local or Tailscale token ends
    // with its share, and a removed device's token stays revoked.
    if (refused && !fromLink) forgetConnection();
    showConnectScreen(refused ? { url: connection.url, token: "" } : connection, problem.message);

    return;
  }

  saveConnection(connection);
  start(connection);
}

const known = pairing ?? loadConnection();

if (known === undefined) showConnectScreen();
else void resume(known, pairing !== undefined);
