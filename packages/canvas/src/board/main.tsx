import "./board.css";
import "../shell/fonts.css";
import "@nyte-ai/ui/styles/tokens.stylex";
import React from "react";
import { createRoot } from "react-dom/client";
import { applyDisplayMode, applyTint } from "@nyte-ai/ui/appearance";
import { BOARD_GLOBAL, readAppMessage } from "@nyte-ai/plugin/design/board-protocol";
import { Board } from "./board.tsx";
import { command, post, setView } from "./bridge.ts";
import { define, importStyle } from "./modules.ts";
import { boardJsxRuntime } from "./runtime.ts";
import { catchErrors, mountSheets, receive, setNight } from "./sheets.ts";

const HOST_RULES = [
  ":host { all: initial !important; display: block !important; position: fixed !important; inset: 0 !important; overflow: hidden !important; }",
  "[data-sheet-slot] { all: initial; display: block; position: absolute; }",
].join("\n");

const LAYERS = "@layer base, priority1, priority2, priority3, priority4, priority5, priority6;";

Object.defineProperty(globalThis, BOARD_GLOBAL, {
  value: { react: React, jsxRuntime: boardJsxRuntime, style: importStyle, define },
  writable: false,
  configurable: false,
});

const host = document.body.appendChild(document.createElement("div"));

host.id = "board";

const shadow = host.attachShadow({ mode: "open" });

const mount = shadow.appendChild(document.createElement("div"));

mount.dataset["chrome"] = "";

const chrome = new CSSStyleSheet();

chrome.replaceSync(
  [
    LAYERS,
    HOST_RULES,
    ...[...document.styleSheets]
      .filter((sheet) => sheet.ownerNode instanceof HTMLLinkElement)
      .flatMap((sheet) => [...sheet.cssRules])
      .filter((rule) => !(rule instanceof CSSFontFaceRule))
      .map((rule) => rule.cssText.replaceAll(":root", "[data-chrome]")),
  ].join("\n"),
);

shadow.adoptedStyleSheets = [chrome];

mountSheets(host);

catchErrors();

createRoot(mount).render(<Board host={host} />);

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent) return;
  const message = readAppMessage(event.data);

  if (message === undefined) return;

  switch (message.kind) {
    case "load":
      receive(message);

      return;
    case "chrome":
      applyDisplayMode(message.theme);

      for (const entry of Object.entries(message.variables)) {
        mount.style.setProperty(entry[0], entry[1]);
      }

      if (message.variables["--nyte-custom-chroma-scale"] !== undefined) applyTint();
      mount.className = document.documentElement.className;
      setView({ scheme: message.theme });

      return;
    case "theme":
      setNight(message.night);
      setView({ night: message.night });

      return;
    case "lights":
      setView({ lights: { you: message.you, agents: message.agents, follow: message.follow } });
      command(message);

      return;
    default:
      command(message);
  }
});

post({ kind: "ready" });
