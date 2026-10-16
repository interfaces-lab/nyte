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
  createAppRouter,
  recordFirstFrame,
  seedFirstFrame,
  startRendererStartup,
  StartupFailure,
  startWindowTabs,
  windowTabRoute,
} from "@nyte-ai/app";
import appIcon from "../../../build/icon-macos.svg";
import { AccountProvider } from "../../account/provider.tsx";

startWindowTabs(window.nyte.firstWindow);

seedFirstFrame("local");

export const router = createAppRouter({
  history: createMemoryHistory({ initialEntries: [windowTabRoute()] }),
});

const container = document.getElementById("root");

if (container === null) throw new Error("Missing #root");

const root = createRoot(container);

/** Main keeps the window hidden until the interface has drawn its first frame. */
const firstFrame = new PerformanceObserver((list) => {
  if (list.getEntriesByName("nyte:shell-ready").length === 0) return;
  firstFrame.disconnect();
  window.nyte.windowPainted();
});

firstFrame.observe({ entryTypes: ["mark"] });

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
  mountShell: () => {
    root.render(
      <StrictMode>
        <AccountProvider>
          <App appIcon={appIcon} router={router} />
        </AccountProvider>
      </StrictMode>,
    );
  },
  connect: () =>
    connectLocalHost().then((connection) => recordFirstFrame("local", connection.hostId)),
  showError: (retry) => {
    root.render(<StartupFailure message="Couldn’t open your workspace." onRetry={retry} />);
    requestAnimationFrame(() => window.nyte.windowPainted());
  },
});
