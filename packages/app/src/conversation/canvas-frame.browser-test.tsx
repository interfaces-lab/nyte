import "../../test/window-bridge.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { sizeChangedNotification } from "@nyte-ai/plugin/canvas/protocol";
import { preferences } from "../preferences/index.ts";
import "../theme/tokens.stylex.ts";
import { keys } from "../queries.ts";
import { CanvasFrame } from "./canvas-frame.tsx";
import type { DrawnCanvas } from "./canvas-frame.tsx";
import { mentionFile } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";
import { ReferenceOpenerProvider } from "./reference-opener.tsx";
import type { ReferenceOpener } from "./reference-opener.tsx";

declare global {
  interface Window {
    readonly rendererMouseClick: (payload: string) => void;
  }
}

function click(x: number, y: number): Promise<void> {
  return new Promise<void>((resolve) => {
    document.addEventListener("renderer-mouse-clicked", () => resolve(), { once: true });
    window.rendererMouseClick(JSON.stringify({ x, y, shift: false }));
  });
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(what);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

const part = (code: string, runtime = 1): DrawnCanvas => ({
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
  const client = new QueryClient();
  client.setQueryData(keys.mentionFiles, [
    mentionFile("/repo", { path: "src/ci.ts", kind: "file" }),
  ]);
  const opened: MessageReference[] = [];

  const opener: ReferenceOpener = (reference) =>
    reference.kind === "file" ? () => opened.push(reference) : undefined;

  const reported: string[] = [];

  const draw = (state: DrawnCanvas): void =>
    root.render(
      <QueryClientProvider client={client}>
        <ReferenceOpenerProvider value={opener}>
          <CanvasFrame state={state} report={(message) => reported.push(message)} remembered />
        </ReferenceOpenerProvider>
      </QueryClientProvider>,
    );

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
    flushSync(() => root.render(null));
    flushSync(() => draw(part('{"height":400}')));

    if (height() !== 400)
      return `A remount should paint at the reported height, not ${String(height())}`;

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

    draw(part('{"height":200,"link":"src/ci.ts:42"}'));
    await until(() => height() === 200, "The link canvas did not render");
    const bounds = frame()?.getBoundingClientRect();

    if (bounds === undefined) return "The link canvas has no frame";
    await click(bounds.x + 20, bounds.y + 20);
    await until(() => caption() === "link:ok", "The file link was not reported as opened");
    const target = opened[0];

    if (
      target?.kind !== "file" ||
      target.file.path !== "/repo/src/ci.ts" ||
      target.lines?.start !== 42
    )
      return `The link opened ${JSON.stringify(opened)}`;

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
