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
import { focusManager } from "@tanstack/react-query";
import { App } from "./app.tsx";
import { startRendererStartup } from "./startup.ts";

import { loadLocalResources } from "./queries.ts";
import { router } from "./router.tsx";

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

performance.mark("nyte:startup");

startRendererStartup({
  mountShell: () => {
    createRoot(container).render(
      <StrictMode>
        <App />
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
