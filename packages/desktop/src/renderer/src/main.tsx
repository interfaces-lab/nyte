// Bundled faces: Inter with its optical-size axis for UI text, JetBrains Mono
// for code. tokens.css names both in its `--nyte-*-font-*` stacks.
import "@fontsource-variable/inter/standard.css";
import "@fontsource-variable/inter/standard-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@nyte-ai/ui/platform-tokens.css";
import "./theme/boot.ts";
import "./theme/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";

import { loadLocalResources } from "./queries.ts";
import { router } from "./router.tsx";

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
