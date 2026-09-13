// Bundled faces: Inter with its optical-size axis for UI text, JetBrains Mono
// for code. tokens.css names both in its `--nyte-*-font-*` stacks.
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@nyte-ai/ui/platform-tokens.css";
import "./theme/boot.ts";
import "./theme/focus-modality.ts";
import "./theme/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { startRendererStartup } from "./startup.ts";

import { loadLocalResources } from "./queries.ts";
import { currentRouteSession, router, settingsRoute } from "./router.tsx";
import { warmThread } from "./live.ts";
import { nyte } from "./nyte.ts";
import { shellActions } from "./chrome/shell-state.ts";
import { clientActionAvailable, clientActions } from "../../shared/client-actions.ts";

const container = document.getElementById("root");
if (container === null) throw new Error("Missing #root");

// The startup shell in index.html owns the window until the first complete frame.
const startupShell = document.getElementById("startup");
const startupMessage = document.getElementById("startup-message");
const startupRetry = document.getElementById("startup-retry");

performance.mark("nyte:startup");
startRendererStartup({
  mountShell: () => {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  },
  loadResources: loadLocalResources,
  loadRouter: () => router.load(),
  // The last chat is the initial route; its snapshot is in the cache before the transcript mounts.
  warmInitialScreen: () => {
    const sessionId = currentRouteSession();
    return sessionId === undefined ? Promise.resolve() : warmThread(sessionId);
  },
  showError: (retry) => {
    startupShell?.setAttribute("data-state", "error");
    if (startupMessage !== null) startupMessage.textContent = "Couldn\u2019t open your workspace.";
    startupRetry?.addEventListener(
      "click",
      () => {
        startupShell?.setAttribute("data-state", "loading");
        retry();
      },
      { once: true },
    );
  },
  onReady: () => performance.mark("nyte:resources-ready"),
});

const stopMenuCommands = nyte.host.onMenuCommand((command) => {
  if (command.kind === "about") {
    shellActions.showAbout(command.info);
    return;
  }
  shellActions.showAbout(undefined);
  const stage = router.state.matches.some((match) => match.routeId === settingsRoute.id)
    ? "settings"
    : "workspace";
  if (!clientActionAvailable(clientActions.settings, stage)) return;
  void router.navigate({ to: "/settings/$section", params: { section: "general" } });
});
import.meta.hot?.dispose(stopMenuCommands);
