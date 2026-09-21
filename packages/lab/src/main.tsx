import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./tokens/palette.css";
import "./shell/reset.css";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@nyte-ai/ui/platform-tokens.css";
import "../../desktop/src/renderer/src/theme/global.css";
import "./tokens/calendar.css";
import "./tokens/shadow.css";
import { App } from "./app";

/*
 * The appearance is set before the first paint so the custom properties are
 * already resolved when the shell mounts. The app reads this back as its
 * initial state rather than keeping a second copy of the default.
 */
document.documentElement.dataset.appearance = "dark";
document.documentElement.dataset.theme = "dark";
document.documentElement.dataset.labTokens = "nyte";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html is missing #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
