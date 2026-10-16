import "../../test/window-bridge.ts";
import { createRoot } from "react-dom/client";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import type { CanvasState } from "@nyte-ai/plugin/canvas/schema";
import { sizeChangedNotification } from "@nyte-ai/plugin/canvas/protocol";
import { preferences } from "../preferences/index.ts";
import "../theme/tokens.stylex.ts";
import { CanvasFrame } from "./canvas-frame.tsx";

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(what);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

const part = (code: string, runtime = 1): CanvasState => ({
  runtime,
  title: "Quarterly revenue",
  code,
  height: 240,
  error: null,
});

export async function run(): Promise<string> {
  applyDisplayMode("light");
  preferences.theme.set("light");
  const host = document.createElement("div");
  host.style.width = "640px";
  document.body.append(host);
  const root = createRoot(host);
  const reported: string[] = [];

  const draw = (state: CanvasState): void =>
    root.render(<CanvasFrame state={state} report={(message) => reported.push(message)} />);

  const box = (): HTMLElement | null => host.querySelector("figure > div");
  const frame = (): HTMLIFrameElement | null => host.querySelector("iframe");
  const height = (): number | undefined => box()?.getBoundingClientRect().height;

  const caption = (): string | undefined =>
    host.querySelector("figcaption")?.textContent ?? undefined;

  try {
    draw(part('{"height":400}'));
    await until(() => frame() !== null, "The frame did not mount");

    if (height() !== 240) return `The hint should size the box first, not ${String(height())}`;

    if (frame()?.getAttribute("sandbox") !== "allow-scripts") return "The frame is not sandboxed";

    if (frame()?.getAttribute("title") !== "Quarterly revenue") return "The frame has no title";
    await until(() => height() === 400, "The shell's reported height did not take");

    if (frame()?.style.colorScheme !== "light") return "The frame should take the light scheme";

    window.postMessage(sizeChangedNotification(900), "*");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    if (height() !== 400) return "A message from another source changed the height";

    draw(part('{"height":500,"error":"boom"}'));
    await until(() => height() === 500 && caption() === "boom", "The replace did not re-render");

    if (reported.join() !== "boom") return `Reported ${JSON.stringify(reported)}`;
    draw(part('{"height":500,"error":"boom"}'));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    if (reported.join() !== "boom") return "The same error was reported twice";

    preferences.theme.set("dark");
    await until(() => caption() === "context:dark", "The theme change did not reach the shell");

    if (frame()?.style.colorScheme !== "dark") return "The frame did not follow the scheme";

    draw(part("{}", 99));
    await until(() => frame() === null, "A too-new canvas should drop the frame");

    if (!host.textContent.includes("Update Nyte to see this canvas.")) return "No update notice";

    if (height() !== 240) return "The notice should hold the hinted box";

    return "passed";
  } finally {
    root.unmount();
    host.remove();
    preferences.theme.set("system");
  }
}
