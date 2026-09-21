import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Tooltip } from "@nyte-ai/ui/tooltip";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@nyte-ai/ui/platform-tokens.css";
import "../../desktop/src/renderer/src/theme/global.css";
import "./tokens/palette.css";
import "./tokens/calendar.css";
import "./tokens/demo.css";
import { DesktopDemo } from "./shell/desktop-demo";
import { auditSurface } from "./shell/audit-state";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true });
  return () => observer.disconnect();
}

function snapshot() {
  return Array.from(
    document.documentElement.attributes,
    (attribute) => `${attribute.name}=${attribute.value}`,
  ).join("|");
}

function Demo() {
  const revision = useSyncExternalStore(subscribe, snapshot);
  const root = document.documentElement;
  return (
    <Tooltip.Provider delay={400}>
      <DesktopDemo
        sidebarVisible={root.dataset.labSidebar !== "false"}
        onSidebar={() => {
          root.dataset.labSidebar = root.dataset.labSidebar === "false" ? "true" : "false";
        }}
        surface={auditSurface(root.dataset.labSurface)}
        onSurface={(surface) => {
          root.dataset.labSurface = surface;
        }}
        grid={{
          columns: root.dataset.labColumns === "true",
          rows: root.dataset.labRows === "true",
          revision,
        }}
      />
    </Tooltip.Provider>
  );
}

document.addEventListener("keydown", (event) => {
  if (!event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === "Digit1" || event.code === "Digit2") {
    event.preventDefault();
    document.documentElement.dataset.labTokens = event.code === "Digit1" ? "nyte" : "calendar";
  }
});

const root = document.getElementById("root");
if (root === null) throw new Error("Missing demo root");
createRoot(root).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
