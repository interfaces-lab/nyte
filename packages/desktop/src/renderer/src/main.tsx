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

if (import.meta.env.DEV) {
  void import("react-grab");
}

function render(): void {
  const root = document.getElementById("root");
  if (root === null) throw new Error("Missing #root");

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

render();
