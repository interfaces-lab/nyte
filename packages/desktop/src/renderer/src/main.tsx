import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./install-bridge.ts";
import "@nyte-ai/app/theme/boot.ts";
import "@nyte-ai/app/theme/focus-modality.ts";
import "@nyte-ai/app/theme/global.css";
import { StrictMode, startTransition } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory } from "@tanstack/react-router";
import { focusManager } from "@tanstack/react-query";
import {
  App,
  connectLocalHost,
  createAppRouter,
  loadWindowHostState,
  startRendererStartup,
  startWindowTabs,
  windowTabRoute,
} from "@nyte-ai/app";
import { applyStartupTheme } from "@nyte-ai/app/theme/startup.ts";
import { useMountEffect } from "@nyte-ai/app/use-mount-effect.ts";
import appIcon from "../../../build/icon-macos.svg";
import { AccountProvider } from "../../account/provider.tsx";

// A reload restores this window's tabs at once; the first window of a launch adopts the saved strip.
const windowTabsReady = startWindowTabs();

export const router = createAppRouter({
  history: createMemoryHistory({ initialEntries: [windowTabRoute()] }),
});

const container = document.getElementById("root");

if (container === null) throw new Error("Missing #root");

const root = createRoot(container);

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

/** Calls `onMount` once its tree has committed. It sits outside StrictMode, which would call it twice. */
function Mounted({ onMount, children }: { onMount: () => void; children: ReactNode }): ReactNode {
  useMountEffect(onMount);

  return children;
}

/**
 * Renders the interface as a transition, which React renders in slices that yield to the
 * browser, so the shell's first mount is no long task. `mounted` runs once it has committed.
 */
function mountShell(mounted: () => void): void {
  startTransition(() =>
    root.render(
      <Mounted onMount={mounted}>
        <StrictMode>
          <AccountProvider>
            <App appIcon={appIcon} router={router} />
          </AccountProvider>
        </StrictMode>
      </Mounted>,
    ),
  );
}

performance.mark("nyte:startup");

startRendererStartup({
  mountShell,
  loadResources: () =>
    Promise.all([
      windowTabsReady.then(loadWindowHostState),
      document.fonts.load('13px "Inter Variable"'),
      document.fonts.load('12px "JetBrains Mono Variable"'),
    ]).then(() => undefined),
  loadRouter: () => {
    router.history.replace(windowTabRoute());

    return router.load();
  },
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
