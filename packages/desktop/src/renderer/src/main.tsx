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

import { loadLocalResources } from "./queries.ts";
import { router, settingsRoute } from "./router.tsx";
import { nyte } from "./nyte.ts";
import { shellActions } from "./chrome/shell-state.ts";
import { clientActionAvailable, clientActions } from "../../shared/client-actions.ts";

function render(): void {
  const root = document.getElementById("root");
  if (root === null) throw new Error("Missing #root");

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

performance.mark("nyte:startup");
void loadLocalResources()
  .then(() => router.load())
  .then(() => {
    performance.mark("nyte:resources-ready");
    render();
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
  })
  .catch(() => {
    const startup = document.getElementById("startup");
    if (startup !== null) startup.dataset["state"] = "error";
    const title = document.getElementById("startup-title");
    if (title !== null) title.textContent = "Nyte couldn’t open your workspace.";
    const status = document.getElementById("startup-status");
    if (status !== null) status.textContent = "Reload to try again.";
    document
      .getElementById("startup-retry")
      ?.addEventListener("click", () => window.location.reload(), { once: true });
  });
