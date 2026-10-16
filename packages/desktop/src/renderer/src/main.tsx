import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./install-bridge.ts";
import "@nyte-ai/app/theme/boot.ts";
import "@nyte-ai/app/theme/focus-modality.ts";
import "@nyte-ai/app/theme/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory } from "@tanstack/react-router";
import { focusManager } from "@tanstack/react-query";
import {
  App,
  connectLocalHost,
  loadHostState,
  createAppRouter,
  startRendererStartup,
  startWindowTabs,
  windowTabRoute,
} from "@nyte-ai/app";
import { applyStartupTheme } from "@nyte-ai/app/theme/startup.ts";
import appIcon from "../../../build/icon-macos.svg";
import { AccountProvider } from "../../account/provider.tsx";

startWindowTabs(window.nyte.firstWindow);

export const router = createAppRouter({
  history: createMemoryHistory({ initialEntries: [windowTabRoute()] }),
});

const container = document.getElementById("root");

if (container === null) throw new Error("Missing #root");

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

// The startup shell in index.html owns the window until the first complete frame.
const startupShell = document.getElementById("startup");

const startupMessage = document.getElementById("startup-message");

const startupRetry = document.getElementById("startup-retry");

applyStartupTheme({ shell: startupShell, retry: startupRetry });

performance.mark("nyte:startup");

startRendererStartup({
  mountShell: () => {
    createRoot(container).render(
      <StrictMode>
        <AccountProvider>
          <App appIcon={appIcon} router={router} />
        </AccountProvider>
      </StrictMode>,
    );
  },
  loadResources: () =>
    Promise.all([
      loadHostState(),
      document.fonts.load('13px "Inter Variable"'),
      document.fonts.load('12px "JetBrains Mono Variable"'),
    ]).then(() => undefined),
  loadRouter: () => router.load(),
  connect: () => connectLocalHost().then(() => undefined),
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
