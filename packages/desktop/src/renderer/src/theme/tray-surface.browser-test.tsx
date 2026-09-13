import { createRoot } from "react-dom/client";
import "@nyte-ai/ui/platform-tokens.css";
import "./tokens.css";
import "./global.css";
import * as stylex from "@stylexjs/stylex";
import { trayStyles } from "./tray.stylex.ts";
import { composerStyles } from "../conversation/styles.stylex.ts";

/**
 * A tray has to read as a surface of its own. Its fill was the page's in dark
 * mode, so a hovered queued row was the only thing drawn and looked like a
 * loose grey bar under the header.
 */
function Dock() {
  return (
    <div id="dock" {...stylex.props(composerStyles.dock)}>
      <section id="tray" {...stylex.props(trayStyles.surface)}>
        <div {...stylex.props(trayStyles.header)}>1 Queued Message</div>
        <div {...stylex.props(trayStyles.list)}>
          <div id="row" {...stylex.props(composerStyles.queueRow)}>
            Queued text
          </div>
        </div>
      </section>
      <div id="composer" {...stylex.props(composerStyles.frame)} />
    </div>
  );
}

function fill(id: string): string {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing #${id}`);
  return getComputedStyle(element).backgroundColor;
}

export async function run(): Promise<string> {
  const host = document.createElement("div");
  document.body.append(host);
  createRoot(host).render(<Dock />);
  await new Promise((resolve) => setTimeout(resolve, 50));

  for (const theme of ["light", "dark"]) {
    document.documentElement.dataset["theme"] = theme;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const tray = fill("tray");
    if (tray === fill("dock")) return `${theme}: the tray is the page behind it (${tray})`;
    if (tray !== fill("composer")) {
      return `${theme}: the tray ${tray} and composer ${fill("composer")} are two surfaces`;
    }
    if (fill("row") === tray) return `${theme}: a resting row fills over its tray`;
  }
  return "passed";
}
