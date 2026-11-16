import { Activity } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../../theme/tokens.stylex.ts";
import "../../theme/global.css";
import { Tray } from "./tray.tsx";

type Step = "close" | "hide" | "close+hide" | "show" | "focus-composer";

const CASES: readonly { readonly name: string; readonly steps: readonly Step[] }[] = [
  { name: "closed as its chat hides", steps: ["close+hide", "show"] },
  { name: "closed while its chat is hidden", steps: ["hide", "close", "show"] },
  { name: "left open while its chat is hidden", steps: ["focus-composer", "hide", "show"] },
];

async function until(done: () => boolean): Promise<void> {
  const deadline = performance.now() + 2_000;

  while (!done() && performance.now() < deadline)
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
}

async function play(steps: readonly Step[]): Promise<string> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let open = true;
  let hidden = false;

  const render = (): void =>
    flushSync(() =>
      root.render(
        <Activity mode={hidden ? "hidden" : "visible"}>
          <input aria-label="Composer" />
          <Tray open={open} label="Agents" focusKey="list">
            <p>Agents</p>
          </Tray>
        </Activity>,
      ),
    );

  render();

  for (const step of steps) {
    if (step === "focus-composer") container.querySelector("input")?.focus();
    open = open && step !== "close" && step !== "close+hide";
    hidden = step === "show" ? false : hidden || step === "hide" || step === "close+hide";
    render();

    if (hidden) await until(() => !container.contains(document.activeElement));
  }

  if (!open) await until(() => container.querySelector("section") === null);

  const tray = container.querySelector("section") === null ? "gone" : "shown";
  const focus = document.activeElement?.tagName.toLowerCase() ?? "none";
  flushSync(() => root.unmount());
  container.remove();

  return `${tray}, focus on ${focus}`;
}

export async function run(): Promise<string> {
  const results: Record<string, string> = {};

  for (const entry of CASES) results[entry.name] = await play(entry.steps);

  return JSON.stringify(results);
}
