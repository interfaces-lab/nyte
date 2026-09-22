import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/opsz.css";
import "@nyte-ai/ui/platform-tokens.css";
import "../../../desktop/src/renderer/src/theme/tokens.css";
import "../tokens/antimetal.css";
import { Antimetal } from "./page";

const root = document.getElementById("root");

if (root === null) throw new Error("antimetal.html is missing #root");

document.documentElement.dataset.theme ??= "dark";

createRoot(root).render(
  <StrictMode>
    <Antimetal />
  </StrictMode>,
);
